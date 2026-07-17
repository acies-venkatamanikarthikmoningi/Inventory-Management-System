"""Phase 4 MEIO optimization: builds a scenario-based multi-period Pyomo MIP
per (SKU, node) over a short horizon, solves it via app/optimization's
solver-neutral adapter, and persists the run + recommendations for
reproducibility.

Modeling choices, stated explicitly (not hidden simplifications):
- Two-stage stochastic programming, not full multi-stage: only period-0
  decisions (order_qty/order_active/transfer_qty) are non-anticipative
  (identical across scenarios, since a planner must commit to "today's" plan
  before knowing which scenario materializes); periods 1..H-1 are
  scenario-dependent recourse.
- Demand per scenario is constant across periods within that scenario
  (deterministic scenario set perturbing Phase 3's real ADD_rolling/RMSE_D/
  RMSE_LT/L_actual through the actual safety_stock()/reorder_point()
  functions - see app/optimization/scenarios.py) - not a time series and not
  true Monte Carlo (that is Phase 5's job, per the task's own instruction).
- The Safety-Stock service-level floor is enforced as a hard constraint on
  the "baseline" scenario only, once the system has had at least one
  lead-time to react (t >= lead_periods), and is capped at the node's real
  Phase 1 warehouse capacity when capacity is the binding constraint - the
  same "capacity can win" behavior Phase 3 already documented, not new.
- Batch/shelf-life feasibility and transfer conservation are both checked
  against each (sku, node)'s single governing (freshest) Batch, the same
  convention app/services/policy_service.latest_batch already uses - not
  full multi-batch FEFO tracking inside the solver itself (a stated scope
  reduction: real FEFO sequencing is Phase 2's job at the pick-face level;
  the optimizer decides node-level positioning, not batch-level picking).
- Expiry is only modeled where a real Batch's known remaining shelf life
  falls inside the requested horizon; freshly-ordered replenishment is not
  itself shelf-life-tracked within the horizon.
"""
import uuid
from datetime import date, datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import pyomo.environ as pyo
from app.models import (
    InventoryPosition, Lane, Node, OptimizationRecommendation, OptimizationRun,
    PolicySnapshot, SkuCostProfile,
)
from app.optimization.scenarios import SCENARIOS, scenario_policy
from app.optimization.solver_adapter import solve_model
from app.services.exceptions_service import MIN_SHELF_LIFE_FRACTION
from app.services.policy_service import latest_batch, sku_node_pairs

DEFAULT_HORIZON_DAYS = 10
BIG_M = 1_000_000.0
SCENARIO_PROBABILITY = {sc["name"]: sc["probability"] for sc in SCENARIOS}


def _lead_periods(days: float) -> int:
    return max(1, round(days))


async def default_sku_codes(session: AsyncSession, limit: int = 12) -> list[str]:
    """Default to SKUs stocked at 2+ nodes - the ones with an actual cross-node
    imbalance for the optimizer to act on - capped for solve-time tractability."""
    pairs = await sku_node_pairs(session)
    by_sku: dict[str, set[str]] = {}
    for sku_code, node_code in pairs:
        by_sku.setdefault(sku_code, set()).add(node_code)
    multi = sorted(sku for sku, nodes in by_sku.items() if len(nodes) >= 2)
    return multi[:limit]


async def gather_context(session: AsyncSession, sku_codes: list[str], node_codes: list[str], horizon_days: int, as_of: date) -> dict:
    ij_pairs: list[tuple[str, str]] = []
    snapshots: dict[tuple[str, str], PolicySnapshot] = {}
    initial_on_hand: dict[tuple[str, str], float] = {}
    expire_period: dict[tuple[str, str], int | None] = {}
    batch_by_pair: dict[tuple[str, str], object] = {}
    dropped_pairs: list[tuple[str, str]] = []

    for sku_code in sku_codes:
        for node_code in node_codes:
            snapshot = (await session.scalars(
                select(PolicySnapshot)
                .where(PolicySnapshot.sku_code == sku_code, PolicySnapshot.node_code == node_code)
                .order_by(PolicySnapshot.computed_at.desc())
            )).first()
            if snapshot is None:
                dropped_pairs.append((sku_code, node_code))
                continue
            on_hand_rows = (await session.scalars(
                select(InventoryPosition.available).where(
                    InventoryPosition.sku_code == sku_code, InventoryPosition.node_code == node_code
                )
            )).all()
            if not on_hand_rows:
                dropped_pairs.append((sku_code, node_code))
                continue

            batch = await latest_batch(session, sku_code, node_code)
            days_to_expiry = (batch.expiry_date - as_of).days if batch is not None else None

            ij_pairs.append((sku_code, node_code))
            snapshots[(sku_code, node_code)] = snapshot
            initial_on_hand[(sku_code, node_code)] = float(sum(on_hand_rows))
            batch_by_pair[(sku_code, node_code)] = batch
            expire_period[(sku_code, node_code)] = (
                days_to_expiry if days_to_expiry is not None and 0 <= days_to_expiry < horizon_days else None
            )

    cost_profiles: dict[str, SkuCostProfile] = {}
    for sku_code in {sc for sc, _ in ij_pairs}:
        cost = (await session.scalars(select(SkuCostProfile).where(SkuCostProfile.sku_code == sku_code))).first()
        if cost is not None:
            cost_profiles[sku_code] = cost
    before_cost_filter = len(ij_pairs)
    ij_pairs = [(i, j) for (i, j) in ij_pairs if i in cost_profiles]
    if len(ij_pairs) < before_cost_filter:
        dropped_pairs.extend([(i, j) for (i, j) in initial_on_hand if i not in cost_profiles])
    ij_pairs_set = set(ij_pairs)

    lanes = (await session.scalars(select(Lane))).all()
    relevant_lanes = [lane for lane in lanes if lane.source_node_code in node_codes and lane.dest_node_code in node_codes]
    transit_periods = {(lane.source_node_code, lane.dest_node_code): _lead_periods(float(lane.transit_days)) for lane in relevant_lanes}
    transfer_cost = {(lane.source_node_code, lane.dest_node_code): float(lane.cost_per_unit) for lane in relevant_lanes}

    demand: dict[tuple, float] = {}
    lead_periods: dict[tuple, int] = {}
    ss_baseline: dict[tuple[str, str], float] = {}
    for (i, j) in ij_pairs:
        snapshot = snapshots[(i, j)]
        for scenario in SCENARIOS:
            perturbed = scenario_policy(snapshot, scenario)
            demand[(i, j, scenario["name"])] = perturbed["add"]
            lead_periods[(i, j, scenario["name"])] = _lead_periods(perturbed["l_actual"])
            if scenario["name"] == "baseline":
                ss_baseline[(i, j)] = perturbed["safety_stock"]

    feasible_transfer: set[tuple[str, str, str]] = set()
    for (i, j) in ij_pairs:
        batch = batch_by_pair.get((i, j))
        if batch is None:
            continue
        total_life_days = (batch.expiry_date - batch.mfg_date).days
        if total_life_days <= 0:
            continue
        for lane in relevant_lanes:
            if lane.source_node_code != j:
                continue
            dst = lane.dest_node_code
            if (i, dst) not in ij_pairs_set:
                continue
            remaining_after_transit = (batch.expiry_date - as_of).days - float(lane.transit_days)
            if (remaining_after_transit / total_life_days) >= MIN_SHELF_LIFE_FRACTION:
                feasible_transfer.add((i, j, dst))

    capacity = {(i, j): float(snapshots[(i, j)].warehouse_capacity_qty) for (i, j) in ij_pairs}

    return {
        "ij_pairs": ij_pairs, "capacity": capacity, "initial_on_hand": initial_on_hand,
        "expire_period": expire_period, "cost_profiles": cost_profiles,
        "transit_periods": transit_periods, "transfer_cost": transfer_cost,
        "demand": demand, "lead_periods": lead_periods, "ss_baseline": ss_baseline,
        "feasible_transfer": feasible_transfer, "dropped_pairs": dropped_pairs,
    }


def build_model(ctx: dict, horizon_days: int) -> pyo.ConcreteModel:
    ij_pairs = ctx["ij_pairs"]
    if not ij_pairs:
        raise ValueError("No SKU/node pair in the requested set has both a policy snapshot and current inventory.")

    model = pyo.ConcreteModel()
    model.T = pyo.RangeSet(0, horizon_days - 1)
    model.S = pyo.Set(initialize=[sc["name"] for sc in SCENARIOS])
    model.IJ = pyo.Set(dimen=2, initialize=ij_pairs)

    xfer_keys = sorted(ctx["feasible_transfer"])
    model.XFER = pyo.Set(dimen=3, initialize=xfer_keys)

    expire_keys = [(i, j) for (i, j) in ij_pairs if ctx["expire_period"].get((i, j)) is not None]
    model.EXPIRE = pyo.Set(dimen=2, initialize=expire_keys)
    expire_keys_set = set(expire_keys)

    model.on_hand = pyo.Var(model.IJ, model.T, model.S, domain=pyo.NonNegativeReals)
    model.backorder = pyo.Var(model.IJ, model.T, model.S, domain=pyo.NonNegativeReals)
    model.demand_served = pyo.Var(model.IJ, model.T, model.S, domain=pyo.NonNegativeReals)
    model.order_qty = pyo.Var(model.IJ, model.T, model.S, domain=pyo.NonNegativeReals)
    model.order_active = pyo.Var(model.IJ, model.T, model.S, domain=pyo.Binary)
    model.transfer_qty = pyo.Var(model.XFER, model.T, model.S, domain=pyo.NonNegativeReals)
    model.expired_qty = pyo.Var(model.EXPIRE, model.S, domain=pyo.NonNegativeReals)

    def _in_transfers(mdl, i, j, t, s):
        total = 0
        for (fi, fr, dst) in xfer_keys:
            if fi != i or dst != j:
                continue
            delay = ctx["transit_periods"][(fr, dst)]
            if t - delay >= 0:
                total = total + mdl.transfer_qty[fi, fr, dst, t - delay, s]
        return total

    def _out_transfers(mdl, i, j, t, s):
        total = 0
        for (fi, fr, dst) in xfer_keys:
            if fi != i or fr != j:
                continue
            total = total + mdl.transfer_qty[fi, fr, dst, t, s]
        return total

    def balance_rule(mdl, i, j, t, s):
        lead = ctx["lead_periods"][(i, j, s)]
        start = ctx["initial_on_hand"][(i, j)] if t == 0 else mdl.on_hand[i, j, t - 1, s]
        arrivals = mdl.order_qty[i, j, t - lead, s] if t - lead >= 0 else 0
        transfers_in = _in_transfers(mdl, i, j, t, s)
        transfers_out = _out_transfers(mdl, i, j, t, s)
        expired = mdl.expired_qty[i, j, s] if (i, j) in expire_keys_set and ctx["expire_period"][(i, j)] == t else 0
        return mdl.on_hand[i, j, t, s] == start + arrivals + transfers_in - transfers_out - mdl.demand_served[i, j, t, s] - expired
    model.balance = pyo.Constraint(model.IJ, model.T, model.S, rule=balance_rule)

    def backorder_rule(mdl, i, j, t, s):
        prev = 0 if t == 0 else mdl.backorder[i, j, t - 1, s]
        return mdl.backorder[i, j, t, s] == prev + ctx["demand"][(i, j, s)] - mdl.demand_served[i, j, t, s]
    model.backorder_balance = pyo.Constraint(model.IJ, model.T, model.S, rule=backorder_rule)

    def served_le_pressure_rule(mdl, i, j, t, s):
        prev = 0 if t == 0 else mdl.backorder[i, j, t - 1, s]
        return mdl.demand_served[i, j, t, s] <= prev + ctx["demand"][(i, j, s)]
    model.served_le_pressure = pyo.Constraint(model.IJ, model.T, model.S, rule=served_le_pressure_rule)

    def served_le_supply_rule(mdl, i, j, t, s):
        lead = ctx["lead_periods"][(i, j, s)]
        start = ctx["initial_on_hand"][(i, j)] if t == 0 else mdl.on_hand[i, j, t - 1, s]
        arrivals = mdl.order_qty[i, j, t - lead, s] if t - lead >= 0 else 0
        transfers_in = _in_transfers(mdl, i, j, t, s)
        transfers_out = _out_transfers(mdl, i, j, t, s)
        return mdl.demand_served[i, j, t, s] <= start + arrivals + transfers_in - transfers_out
    model.served_le_supply = pyo.Constraint(model.IJ, model.T, model.S, rule=served_le_supply_rule)

    def capacity_rule(mdl, i, j, t, s):
        return mdl.on_hand[i, j, t, s] <= ctx["capacity"][(i, j)]
    model.capacity = pyo.Constraint(model.IJ, model.T, model.S, rule=capacity_rule)

    def moq_lower_rule(mdl, i, j, t, s):
        moq = float(ctx["cost_profiles"][i].moq_units)
        return mdl.order_qty[i, j, t, s] >= moq * mdl.order_active[i, j, t, s]
    model.moq_lower = pyo.Constraint(model.IJ, model.T, model.S, rule=moq_lower_rule)

    def activation_upper_rule(mdl, i, j, t, s):
        return mdl.order_qty[i, j, t, s] <= BIG_M * mdl.order_active[i, j, t, s]
    model.activation_upper = pyo.Constraint(model.IJ, model.T, model.S, rule=activation_upper_rule)

    def service_level_floor_rule(mdl, i, j, t):
        lead = ctx["lead_periods"][(i, j, "baseline")]
        if t < lead:
            return pyo.Constraint.Skip
        floor = min(ctx["ss_baseline"][(i, j)], ctx["capacity"][(i, j)])
        return mdl.on_hand[i, j, t, "baseline"] >= floor
    model.service_level_floor = pyo.Constraint(model.IJ, model.T, rule=service_level_floor_rule)

    def expire_forces_zero_rule(mdl, i, j, s):
        t_star = ctx["expire_period"][(i, j)]
        return mdl.on_hand[i, j, t_star, s] == 0
    model.expire_forces_zero = pyo.Constraint(model.EXPIRE, model.S, rule=expire_forces_zero_rule)

    def non_anticipativity_order_rule(mdl, i, j, s):
        return mdl.order_qty[i, j, 0, s] == mdl.order_qty[i, j, 0, "baseline"]
    model.non_anticipativity_order = pyo.Constraint(model.IJ, model.S, rule=non_anticipativity_order_rule)

    def non_anticipativity_active_rule(mdl, i, j, s):
        return mdl.order_active[i, j, 0, s] == mdl.order_active[i, j, 0, "baseline"]
    model.non_anticipativity_active = pyo.Constraint(model.IJ, model.S, rule=non_anticipativity_active_rule)

    def non_anticipativity_transfer_rule(mdl, i, fr, dst, s):
        return mdl.transfer_qty[i, fr, dst, 0, s] == mdl.transfer_qty[i, fr, dst, 0, "baseline"]
    model.non_anticipativity_transfer = pyo.Constraint(model.XFER, model.S, rule=non_anticipativity_transfer_rule)

    def objective_rule(mdl):
        total = 0
        for (i, j) in ij_pairs:
            cost = ctx["cost_profiles"][i]
            holding = float(cost.unit_cost) * float(cost.holding_cost_pct)
            shortage_penalty = float(cost.shortage_penalty_per_unit)
            expiry_penalty = float(cost.expiry_penalty_per_unit)
            unit_cost = float(cost.unit_cost)
            fixed_order_cost = float(cost.ordering_cost)
            for t in model.T:
                for s in model.S:
                    p = SCENARIO_PROBABILITY[s]
                    total = total + p * (
                        holding * mdl.on_hand[i, j, t, s]
                        + shortage_penalty * mdl.backorder[i, j, t, s]
                        + unit_cost * mdl.order_qty[i, j, t, s]
                        + fixed_order_cost * mdl.order_active[i, j, t, s]
                    )
                    if (i, j) in expire_keys_set and ctx["expire_period"][(i, j)] == t:
                        total = total + p * expiry_penalty * mdl.expired_qty[i, j, s]
        for (i, fr, dst) in xfer_keys:
            cost_per_unit = ctx["transfer_cost"][(fr, dst)]
            for t in model.T:
                for s in model.S:
                    total = total + SCENARIO_PROBABILITY[s] * cost_per_unit * mdl.transfer_qty[i, fr, dst, t, s]
        return total
    model.OBJ = pyo.Objective(rule=objective_rule, sense=pyo.minimize)

    return model


def recompute_objective_from_solution(model: pyo.ConcreteModel, ctx: dict, horizon_days: int) -> float:
    """Independently re-derives total cost from the SOLVED variable values
    (not the Pyomo expression tree) - used to verify the reported objective
    is internally consistent with the returned solution."""
    total = 0.0
    for (i, j) in ctx["ij_pairs"]:
        cost = ctx["cost_profiles"][i]
        holding = float(cost.unit_cost) * float(cost.holding_cost_pct)
        shortage_penalty = float(cost.shortage_penalty_per_unit)
        expiry_penalty = float(cost.expiry_penalty_per_unit)
        unit_cost = float(cost.unit_cost)
        fixed_order_cost = float(cost.ordering_cost)
        for t in range(horizon_days):
            for scenario in SCENARIOS:
                s = scenario["name"]
                p = SCENARIO_PROBABILITY[s]
                total += p * (
                    holding * pyo.value(model.on_hand[i, j, t, s])
                    + shortage_penalty * pyo.value(model.backorder[i, j, t, s])
                    + unit_cost * pyo.value(model.order_qty[i, j, t, s])
                    + fixed_order_cost * pyo.value(model.order_active[i, j, t, s])
                )
                if ctx["expire_period"].get((i, j)) == t:
                    total += p * expiry_penalty * pyo.value(model.expired_qty[i, j, s])
    for (i, fr, dst) in ctx["feasible_transfer"]:
        cost_per_unit = ctx["transfer_cost"][(fr, dst)]
        for t in range(horizon_days):
            for scenario in SCENARIOS:
                s = scenario["name"]
                total += SCENARIO_PROBABILITY[s] * cost_per_unit * pyo.value(model.transfer_qty[i, fr, dst, t, s])
    return total


def extract_recommendations(model: pyo.ConcreteModel, ctx: dict, horizon_days: int, run_id) -> list[OptimizationRecommendation]:
    recs: list[OptimizationRecommendation] = []
    for (i, j) in ctx["ij_pairs"]:
        for t in range(horizon_days):
            for scenario in SCENARIOS:
                s = scenario["name"]
                qty = pyo.value(model.order_qty[i, j, t, s])
                if qty and qty > 0.5:
                    recs.append(OptimizationRecommendation(
                        run_id=run_id, recommendation_type="REPLENISH", sku_code=i, node_code=j,
                        source_node_code=None, period_index=t, scenario_name=s, quantity=round(qty, 3),
                    ))
    for (i, fr, dst) in sorted(ctx["feasible_transfer"]):
        for t in range(horizon_days):
            for scenario in SCENARIOS:
                s = scenario["name"]
                qty = pyo.value(model.transfer_qty[i, fr, dst, t, s])
                if qty and qty > 0.5:
                    recs.append(OptimizationRecommendation(
                        run_id=run_id, recommendation_type="TRANSFER", sku_code=i, node_code=dst,
                        source_node_code=fr, period_index=t, scenario_name=s, quantity=round(qty, 3),
                    ))
    return recs


async def run_optimization(session: AsyncSession, sku_codes: list[str] | None, node_codes: list[str] | None,
                            horizon_days: int | None, requested_at: datetime, time_limit_seconds: int = 60) -> OptimizationRun:
    as_of = requested_at.date()
    if not node_codes:
        node_codes = [n.node_code for n in (await session.scalars(select(Node).order_by(Node.node_code))).all()]
    if not sku_codes:
        sku_codes = await default_sku_codes(session)
    horizon_days = horizon_days or DEFAULT_HORIZON_DAYS

    ctx = await gather_context(session, sku_codes, node_codes, horizon_days, as_of)

    run = OptimizationRun(
        requested_at=requested_at, node_codes=node_codes, sku_codes=sku_codes,
        horizon_days=horizon_days, scenario_set=SCENARIOS,
        solver_status="pending", objective_value=None, solve_seconds=0, detail="",
    )

    if not ctx["ij_pairs"]:
        run.solver_status = "infeasible"
        run.detail = "No SKU/node pair in the requested set has both a policy snapshot and current inventory."
        session.add(run)
        await session.commit()
        await session.refresh(run)
        return run

    model = build_model(ctx, horizon_days)
    result = solve_model(model, time_limit_seconds=time_limit_seconds)

    dropped_note = f" Dropped {len(ctx['dropped_pairs'])} SKU/node pair(s) lacking policy or inventory data." if ctx["dropped_pairs"] else ""
    run.solver_status = result.status
    run.objective_value = round(result.objective_value, 2) if result.objective_value is not None else None
    run.solve_seconds = round(result.solve_seconds, 3)
    run.detail = (result.detail + dropped_note).strip()
    session.add(run)
    await session.commit()
    await session.refresh(run)

    if result.status in ("optimal", "feasible"):
        recommendations = extract_recommendations(model, ctx, horizon_days, run.id)
        session.add_all(recommendations)
        await session.commit()

    return run


async def get_recommendations(session: AsyncSession, run_id: str | None):
    if run_id:
        run = await session.get(OptimizationRun, uuid.UUID(run_id))
    else:
        run = (await session.scalars(select(OptimizationRun).order_by(OptimizationRun.requested_at.desc()))).first()
    if run is None:
        return None, []
    recs = (await session.scalars(
        select(OptimizationRecommendation).where(OptimizationRecommendation.run_id == run.id)
        .order_by(OptimizationRecommendation.period_index, OptimizationRecommendation.scenario_name)
    )).all()
    return run, recs
