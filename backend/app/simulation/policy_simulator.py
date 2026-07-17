"""Phase 5 Monte Carlo policy simulator.

Answers a different question than Phase 4's MEIO model: not "what is the
mathematically optimal plan" but "if I actually run this POLICY (a type plus
its concrete parameters) against many random, realistic demand/lead-time
outcomes, how robust is it - on average and in the tails?"

Demand is drawn from Normal(ADD_rolling, RMSE_D) and lead time from
Normal(L_actual, RMSE_LT) - Phase 3's REAL computed variability inputs, not
invented parameters - clipped to non-negative (see random_generator.py).
Each simulated day's inventory balance reuses
app/services/inventory_balance.one_period_step(), the SAME relationship
Phase 4's Pyomo constraints encode, so simulation and optimization can't
silently disagree about basic mechanics.

Five policy types are supported (policy_service.POLICY_TYPES), sharing the
same day-by-day balance bookkeeping - only the trigger (when to check) and
order-quantity (how much to order) logic differs per type:
  s_S       - continuous review (checked every day); order up to S when
              inventory position <= s.
  s_Q       - continuous review; order a FIXED quantity Q when inventory
              position <= s (not "top up to S").
  R_S       - periodic review (checked only every R days); order up to S
              UNCONDITIONALLY at every review (no threshold).
  R_s_S     - periodic review; order up to S only if inventory position <= s
              at that review - otherwise skip the cycle entirely.
  base_stock- continuous review with s very close to S (see
              policy_service.policy_params_for_type), i.e. replace almost
              immediately on consumption.

Phase 6 addition: expiry within a trajectory reuses the SAME single-
governing-batch simplification Phase 4's MIP already uses (see
optimization_service.py's expire_period/expire_forces_zero) - not a new
expiry rule. If the SKU/node's real current batch's remaining shelf life
(days_to_expiry) falls inside the simulated horizon, whatever on-hand stock
remains on that exact day is written off (one-shot, matching Phase 4's
convention); freshly-ordered replenishment is not itself shelf-life-tracked
within the horizon, the same stated scope reduction as Phase 4.

Each trajectory's per-run outcome (service_level, stockout_occurred,
total_cost, expiry_loss_qty, ending_inventory) is kept in memory only long
enough for simulate_policy() to compute the aggregate statistics
(means/std-devs/rates) Phase 6's robustness_service.py scores need - the
raw N-row array itself is never persisted (200+ rows per SKU/node/policy
would bloat storage fast), only the aggregates are.
"""
import math
import random
from app.services.inventory_balance import one_period_step
from app.simulation.random_generator import draw_nonnegative_gaussian

CONTINUOUS_REVIEW_TYPES = {"s_S", "s_Q", "base_stock"}
PERIODIC_REVIEW_TYPES = {"R_S", "R_s_S"}


def _is_review_day(policy_type: str, params: dict, day: int) -> bool:
    if policy_type in CONTINUOUS_REVIEW_TYPES:
        return True
    review_period = max(1, round(params["R"]))
    return day % review_period == 0


def _decide_order_qty(policy_type: str, params: dict, inventory_position: float) -> float:
    if policy_type == "s_Q":
        return params["Q"] if inventory_position <= params["s"] else 0.0
    if policy_type == "R_S":
        return max(params["S"] - inventory_position, 0.0)  # unconditional at each review
    if policy_type in ("s_S", "R_s_S", "base_stock"):
        if inventory_position <= params["s"]:
            return max(params["S"] - inventory_position, 0.0)
        return 0.0
    raise ValueError(f"Unknown policy_type: {policy_type}")


def simulate_one_trajectory(rng: random.Random, *, policy_type: str, params: dict, add_rolling: float,
                             rmse_d: float, l_actual: float, rmse_lt: float, initial_on_hand: float,
                             horizon_days: int, holding_cost_per_unit: float, shortage_penalty_per_unit: float,
                             expiry_penalty_per_unit: float = 0.0, days_to_expiry: float | None = None) -> dict:
    on_hand = initial_on_hand
    backorder = 0.0
    pipeline: list[tuple[int, float]] = []  # (arrival_day, qty) - orders in transit
    stockout_days = 0
    total_holding_cost = 0.0
    total_shortage_cost = 0.0
    total_expiry_cost = 0.0
    expiry_loss_qty = 0.0
    worst_shortage = 0.0
    expire_day = int(days_to_expiry) if days_to_expiry is not None and 0 <= days_to_expiry < horizon_days else None

    for day in range(horizon_days):
        demand = draw_nonnegative_gaussian(rng, add_rolling, rmse_d)
        lead_time_days = max(1, round(draw_nonnegative_gaussian(rng, l_actual, rmse_lt)))

        arrivals_today = sum(qty for arrival_day, qty in pipeline if arrival_day == day)
        in_transit = sum(qty for arrival_day, qty in pipeline if arrival_day > day)
        inventory_position = on_hand + in_transit - backorder

        if _is_review_day(policy_type, params, day):
            order_qty = _decide_order_qty(policy_type, params, inventory_position)
            if order_qty > 0:
                pipeline.append((day + lead_time_days, order_qty))

        expired_today = on_hand if expire_day is not None and day == expire_day else 0.0

        step = one_period_step(
            start=on_hand, arrivals=arrivals_today, transfers_in=0.0, transfers_out=0.0,
            demand=demand, prev_backorder=backorder, expired=expired_today,
        )
        on_hand = step["on_hand"]
        backorder = step["backorder"]

        if backorder > 1e-9:
            stockout_days += 1
            worst_shortage = max(worst_shortage, backorder)
        if expired_today > 0:
            expiry_loss_qty += expired_today
            total_expiry_cost += expired_today * expiry_penalty_per_unit
        total_holding_cost += on_hand * holding_cost_per_unit
        total_shortage_cost += backorder * shortage_penalty_per_unit

    return {
        "ending_inventory": on_hand,
        "service_level": 1.0 - (stockout_days / horizon_days),
        "stockout_occurred": stockout_days > 0,
        "holding_cost": total_holding_cost,
        "shortage_cost": total_shortage_cost,
        "expiry_cost": total_expiry_cost,
        "total_cost": total_holding_cost + total_shortage_cost + total_expiry_cost,
        "shortage_qty": worst_shortage,
        "expiry_loss_qty": expiry_loss_qty,
    }


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _std(values: list[float]) -> float:
    if not values:
        return 0.0
    m = _mean(values)
    return math.sqrt(sum((v - m) ** 2 for v in values) / len(values))


def _percentile(sorted_values: list[float], p: float) -> float:
    if not sorted_values:
        return 0.0
    k = (len(sorted_values) - 1) * p
    f = int(k)
    c = min(f + 1, len(sorted_values) - 1)
    if f == c:
        return sorted_values[f]
    return sorted_values[f] + (sorted_values[c] - sorted_values[f]) * (k - f)


def simulate_policy(*, seed: int, n_runs: int, policy_type: str, params: dict, add_rolling: float, rmse_d: float,
                     l_actual: float, rmse_lt: float, initial_on_hand: float, horizon_days: int,
                     holding_cost_per_unit: float, shortage_penalty_per_unit: float,
                     expiry_penalty_per_unit: float = 0.0, days_to_expiry: float | None = None) -> dict:
    """Runs n_runs independent trajectories from ONE seeded RNG stream (not
    re-seeded per trajectory), so the same seed always reproduces the exact
    same sequence of draws end to end - see random_generator.make_rng."""
    from app.simulation.random_generator import make_rng
    rng = make_rng(seed)
    trajectories = [
        simulate_one_trajectory(
            rng, policy_type=policy_type, params=params, add_rolling=add_rolling, rmse_d=rmse_d,
            l_actual=l_actual, rmse_lt=rmse_lt, initial_on_hand=initial_on_hand, horizon_days=horizon_days,
            holding_cost_per_unit=holding_cost_per_unit, shortage_penalty_per_unit=shortage_penalty_per_unit,
            expiry_penalty_per_unit=expiry_penalty_per_unit, days_to_expiry=days_to_expiry,
        )
        for _ in range(n_runs)
    ]
    # Aggregate statistics computed HERE, while the full per-trajectory array
    # is still in scope - robustness_service.compute_robustness_score() only
    # ever sees these summaries, never the raw N-row array itself.
    service_levels = [t["service_level"] for t in trajectories]
    ending_invs = [t["ending_inventory"] for t in trajectories]
    holding_costs = [t["holding_cost"] for t in trajectories]
    shortage_costs = [t["shortage_cost"] for t in trajectories]
    total_costs = [t["total_cost"] for t in trajectories]
    shortage_qtys = sorted(t["shortage_qty"] for t in trajectories)
    stockout_count = sum(1 for t in trajectories if t["stockout_occurred"])
    expiry_count = sum(1 for t in trajectories if t["expiry_loss_qty"] > 0)

    return {
        "service_level_achieved": _mean(service_levels),
        "avg_ending_inventory": _mean(ending_invs),
        "std_ending_inventory": _std(ending_invs),
        "total_holding_cost": _mean(holding_costs),
        "total_shortage_cost": _mean(shortage_costs),
        "mean_total_cost": _mean(total_costs),
        "std_total_cost": _std(total_costs),
        "p95_shortage_qty": _percentile(shortage_qtys, 0.95),
        "stockout_rate": stockout_count / n_runs,
        "expiry_loss_rate": expiry_count / n_runs,
    }
