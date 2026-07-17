"""Phase 6.1: simulation-backed policy-TYPE recommendation + governance
engine (supersedes the original Phase 5 Part B pure business-rule picker).

WHY this changed: the original engine picked exactly one candidate type via
business rules (Demand Volatility / Classification / Review Cadence / Cost of
Monitoring) and never checked whether that candidate actually simulated to a
strong Robustness Score. That produced unconvincing results (a "suggested"
policy could score LOWER than "current") and skewed variety (one type
dominating regardless of real fit). The fix: actually run the Monte Carlo
simulator (app/simulation/policy_simulator.py) against every applicable
candidate and let the SIMULATED Robustness Score decide, not the rule alone.

Decision flow per SKU/node (evaluate_sku_node):
  1. Simulate the CURRENT policy -> current Robustness Score.
  2. If current >= 80: done, no_change_needed - alternatives are not even
     simulated (nothing would be surfaced regardless, and this SKU already
     doesn't need the compute).
  3. Otherwise, simulate every OTHER policy type (policy_service.POLICY_TYPES
     minus current - up to 4 more Monte Carlo runs) and take the
     highest-scoring one as the best alternative.
  4. Governance tier from (current score, best alternative score) - see
     robustness_service.determine_governance_action for the exact 4-way
     rule, including the new no_better_alternative_found state (current is
     below 80 but nothing simulates meaningfully better - an honest, useful
     signal in its own right, not the same as no_change_needed).

The business-rule factors (Demand Volatility, Classification, Review
Cadence, Cost of Monitoring - see build_context/build_reasoning) are kept as
real, computed NARRATIVE context in the reasoning text - they no longer
decide the outcome, since only the simulator can prove a policy performs
better than another.

Compute cost: evaluate_sku_node does 1 simulation when current already
scores >=80, or up to 5 when it doesn't (current + 4 alternatives) - this is
the "up to 4x more simulation work" the spec calls out. Because a
network-wide sweep (refresh_recommendations, called by
POST /policy/recommendations/refresh) can therefore take real, non-trivial
time across ~100+ SKU/node pairs, it is a deliberate, explicit POST-then-GET
action (same shape as POST /simulation/run + GET /simulation/results
already use elsewhere in this app) - never triggered implicitly by the cheap
GET /policy/recommendations read.
"""
import math
from datetime import date, datetime, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import DemandObservation, LeadTimeObservation, PolicyRecommendation, PolicySnapshot, Sku, SkuCostProfile
from app.services import robustness_service
from app.services.policy_service import POLICY_TYPES, initial_on_hand, latest_batch, policy_params_for_type, sku_node_pairs
from app.simulation.policy_simulator import simulate_policy
from app.simulation.random_generator import DEFAULT_SEED

DEMAND_TREND_WINDOW_DAYS = 56  # matches variability_service.DEMAND_ROLLING_WINDOW_DAYS

# Mirrors simulation_service.DEFAULT_N_RUNS/DEFAULT_HORIZON_DAYS - kept as a
# separate copy rather than importing simulation_service, which imports THIS
# module (would be a circular import).
DEFAULT_N_RUNS = 200
DEFAULT_HORIZON_DAYS = 30

POLICY_TYPE_LABELS = {
    "s_S": "(s, S) - Reorder-Point, Order-Up-To",
    "s_Q": "(s, Q) - Reorder-Point, Fixed Quantity",
    "R_S": "(R, S) - Periodic Review, Order-Up-To",
    "R_s_S": "(R, s, S) - Periodic Review with Threshold",
    "base_stock": "Base-Stock Policy",
}


async def cost_percentiles(session: AsyncSession) -> dict:
    values = sorted(float(v) for v in (await session.scalars(select(SkuCostProfile.unit_cost))).all())
    if not values:
        return {"median": 0.0, "p90": 0.0}

    def pct(p: float) -> float:
        k = (len(values) - 1) * p
        f = int(k)
        c = min(f + 1, len(values) - 1)
        if f == c:
            return values[f]
        return values[f] + (values[c] - values[f]) * (k - f)

    return {"median": pct(0.5), "p90": pct(0.9)}


async def volatility_percentiles(session: AsyncSession) -> dict:
    """Tercile bands (p33/p67) of RMSE_D/ADD_rolling across every SKU/node's
    LATEST PolicySnapshot - the network's own real demand-volatility
    distribution, so "high"/"low" volatility is relative to what this data
    actually contains rather than a fixed absolute coefficient-of-variation
    cutoff (a fixed 20% cutoff was found, via this engine's own live output,
    to never fire against this dataset's real ~4-15% CV range)."""
    rows = (await session.scalars(select(PolicySnapshot).order_by(PolicySnapshot.computed_at.desc()))).all()
    latest_by_pair: dict[tuple[str, str], PolicySnapshot] = {}
    for row in rows:
        key = (row.sku_code, row.node_code)
        if key not in latest_by_pair:
            latest_by_pair[key] = row
    ratios = sorted(
        float(s.rmse_d) / float(s.add_rolling) for s in latest_by_pair.values() if float(s.add_rolling) > 0
    )
    if not ratios:
        return {"p33": 0.0, "p67": 0.0}

    def pct(p: float) -> float:
        k = (len(ratios) - 1) * p
        f = int(k)
        c = min(f + 1, len(ratios) - 1)
        if f == c:
            return ratios[f]
        return ratios[f] + (ratios[c] - ratios[f]) * (k - f)

    return {"p33": pct(1 / 3), "p67": pct(2 / 3)}


async def demand_error_trend(session: AsyncSession, sku_code: str, node_code: str, as_of: date) -> dict | None:
    """Splits the trailing demand-observation window in half and computes
    RMSE_D for each half, to express a real forecast-error TREND (not just
    the current rolling RMSE_D) in recommendation reasoning."""
    window_start = as_of - timedelta(days=DEMAND_TREND_WINDOW_DAYS)
    rows = (await session.scalars(
        select(DemandObservation).where(
            DemandObservation.sku_code == sku_code, DemandObservation.node_code == node_code,
            DemandObservation.observed_date > window_start, DemandObservation.observed_date <= as_of,
        ).order_by(DemandObservation.observed_date)
    )).all()
    if len(rows) < 4:
        return None
    mid = len(rows) // 2
    older, recent = rows[:mid], rows[mid:]

    def rmse(group):
        errors = [float(r.actual_qty) - float(r.forecast_qty) for r in group]
        return math.sqrt(sum(e * e for e in errors) / len(errors))

    older_rmse, recent_rmse = rmse(older), rmse(recent)
    pct_change = ((recent_rmse - older_rmse) / older_rmse * 100) if older_rmse > 0 else 0.0
    return {"older_rmse": older_rmse, "recent_rmse": recent_rmse, "pct_change": pct_change}


async def average_order_spacing_days(session: AsyncSession, sku_code: str, node_code: str) -> float | None:
    """Real average gap (days) between consecutive LeadTimeObservation order
    dates for this SKU/node - the "Review Cadence Feasibility" factor."""
    rows = (await session.scalars(
        select(LeadTimeObservation.order_date).where(
            LeadTimeObservation.sku_code == sku_code, LeadTimeObservation.node_code == node_code,
        ).order_by(LeadTimeObservation.order_date)
    )).all()
    if len(rows) < 2:
        return None
    gaps = [(rows[i + 1] - rows[i]).days for i in range(len(rows) - 1)]
    return sum(gaps) / len(gaps)


def _direction_word(pct_change: float) -> str:
    if pct_change > 0:
        return "risen"
    if pct_change < 0:
        return "fallen"
    return "stayed flat"


async def build_context(session: AsyncSession, sku_code: str, node_code: str, as_of: date) -> dict | None:
    """Everything needed to (a) simulate the current policy and every
    candidate alternative, and (b) narrate the real business-rule factors in
    the final reasoning text - but no longer picks a "suggested" type itself;
    only evaluate_sku_node's simulated scores do that now."""
    snapshot = (await session.scalars(
        select(PolicySnapshot).where(PolicySnapshot.sku_code == sku_code, PolicySnapshot.node_code == node_code)
        .order_by(PolicySnapshot.computed_at.desc())
    )).first()
    cost = (await session.scalars(select(SkuCostProfile).where(SkuCostProfile.sku_code == sku_code))).first()
    sku = (await session.scalars(select(Sku).where(Sku.sku_code == sku_code))).first()
    if snapshot is None or cost is None or sku is None:
        return None

    computed = {
        "add_rolling": float(snapshot.add_rolling), "rmse_d": float(snapshot.rmse_d),
        "l_actual": float(snapshot.l_actual), "review_period_days": float(snapshot.review_period_days),
        "safety_stock": float(snapshot.safety_stock), "enhanced_rop": float(snapshot.enhanced_rop),
        "final_max": float(snapshot.final_max), "eoq": float(snapshot.eoq),
    }
    current_policy_type = snapshot.policy_type
    current_params = policy_params_for_type(current_policy_type, computed)
    # Safety stock remains an explicit planner-facing parameter for policies
    # with a reorder threshold.  It is derived by the existing policy formula
    # (not a new simulation input) and carried in the JSON display/audit
    # payload alongside the parameters that actually trigger orders.
    if current_policy_type in {"s_S", "s_Q", "R_s_S", "base_stock"}:
        current_params["safetyStock"] = computed["safety_stock"]

    volatility_ratio = (computed["rmse_d"] / computed["add_rolling"]) if computed["add_rolling"] > 0 else 0.0
    classification = sku.classification
    unit_cost = float(cost.unit_cost)

    trend = await demand_error_trend(session, sku_code, node_code, as_of)
    cadence_days = await average_order_spacing_days(session, sku_code, node_code)

    return {
        "snapshot": snapshot, "cost": cost, "sku": sku, "computed": computed,
        "current_policy_type": current_policy_type, "current_params": current_params,
        "volatility_ratio": volatility_ratio, "classification": classification, "unit_cost": unit_cost,
        "trend": trend, "cadence_days": cadence_days,
    }


def build_reasoning(*, classification: str | None, volatility_ratio: float, volatility_p33: float,
                     volatility_p67: float, trend: dict | None, cadence_days: float | None, unit_cost: float,
                     median_cost: float, p90_cost: float, current_policy_type: str, current_score: float,
                     governance_action: str, suggested_policy_type: str | None = None,
                     suggested_score: float | None = None) -> str:
    parts = []
    classification_label = classification or "unclassified"
    if trend is not None:
        direction = _direction_word(trend["pct_change"])
        parts.append(
            f"Demand forecast error (RMSE_D) has {direction} {abs(trend['pct_change']):.0f}% over the trailing "
            f"window (from {trend['older_rmse']:.0f} to {trend['recent_rmse']:.0f}), and this SKU's classification "
            f"is {classification_label}."
        )
    else:
        parts.append(f"This SKU's classification is {classification_label}.")
    volatility_band = (
        "the top third of this network's SKUs" if volatility_ratio >= volatility_p67 else
        "the bottom third of this network's SKUs" if volatility_ratio <= volatility_p33 else
        "the middle third of this network's SKUs"
    )
    parts.append(
        f"Demand volatility (RMSE_D / ADD_rolling) is {volatility_ratio * 100:.1f}%, in {volatility_band} "
        f"(bottom-third cutoff {volatility_p33 * 100:.1f}%, top-third cutoff {volatility_p67 * 100:.1f}%)."
    )
    if cadence_days is not None:
        parts.append(f"Observed order cadence averages {cadence_days:.1f} days between deliveries.")
    value_position = (
        "at or above the network's 90th percentile" if unit_cost >= p90_cost else
        "above the network median" if unit_cost >= median_cost else
        "at or below the network median"
    )
    parts.append(f"Unit cost is {unit_cost:,.0f}, {value_position} (median {median_cost:,.0f}, p90 {p90_cost:,.0f}).")

    parts.append(
        f"Simulating {POLICY_TYPE_LABELS[current_policy_type]} against {DEFAULT_N_RUNS} randomized demand/lead-time "
        f"trajectories gives it a Robustness Score of {current_score:.0f}/100."
    )
    if governance_action == "no_change_needed":
        parts.append("That is a robust score - no policy-type change recommended.")
    elif governance_action == "suggest_pending_approval":
        parts.append(
            f"Simulating every other applicable policy type found {POLICY_TYPE_LABELS[suggested_policy_type]} "
            f"scores meaningfully higher ({suggested_score:.0f}/100) - recommending a switch, pending your approval."
        )
    elif governance_action == "no_better_alternative_found":
        parts.append(
            "Simulating every other applicable policy type found nothing that scores both >=80 and higher than "
            "the current policy - this may indicate a capacity or structural constraint rather than a "
            "policy-type issue, not a gap in the search."
        )
    elif governance_action == "auto_changed":
        parts.append(
            f"This score is below the auto-governance threshold, so the system automatically switched to the "
            f"best-scoring alternative found, {POLICY_TYPE_LABELS[suggested_policy_type]} ({suggested_score:.0f}/100)."
        )
    return " ".join(parts)


async def evaluate_sku_node(session: AsyncSession, *, sku_code: str, node_code: str, seed: int, n_runs: int,
                             horizon_days: int, as_of: date, requested_at: datetime, cost_percentiles: dict,
                             vol_percentiles: dict, apply_mutations: bool) -> dict | None:
    """The core Phase 6.1 decision function for one SKU/node - see module
    docstring for the full flow. apply_mutations=False for ad-hoc/exploratory
    callers (e.g. a custom-seed POST /simulation/run) that should NOT
    silently mutate the live policy; apply_mutations=True only for the
    official network-wide refresh_recommendations pass below."""
    context = await build_context(session, sku_code, node_code, as_of)
    if context is None:
        return None
    snapshot, cost = context["snapshot"], context["cost"]

    batch = await latest_batch(session, sku_code, node_code)
    days_to_expiry = float((batch.expiry_date - as_of).days) if batch is not None else None
    on_hand_qty = await initial_on_hand(session, sku_code, node_code)
    holding_cost_per_unit = float(cost.unit_cost) * float(cost.holding_cost_pct)
    shortage_penalty_per_unit = float(cost.shortage_penalty_per_unit)
    expiry_penalty_per_unit = float(cost.expiry_penalty_per_unit)
    target_service_level = float(snapshot.service_level)
    rmse_lt = float(snapshot.rmse_lt)

    def _simulate(policy_type: str, params: dict) -> dict:
        metrics = simulate_policy(
            seed=seed, n_runs=n_runs, policy_type=policy_type, params=params,
            initial_on_hand=on_hand_qty, horizon_days=horizon_days,
            holding_cost_per_unit=holding_cost_per_unit, shortage_penalty_per_unit=shortage_penalty_per_unit,
            expiry_penalty_per_unit=expiry_penalty_per_unit, days_to_expiry=days_to_expiry,
            add_rolling=context["computed"]["add_rolling"], rmse_d=context["computed"]["rmse_d"],
            l_actual=context["computed"]["l_actual"], rmse_lt=rmse_lt,
        )
        scores = robustness_service.compute_robustness_score(
            service_level_achieved=metrics["service_level_achieved"], target_service_level=target_service_level,
            stockout_rate=metrics["stockout_rate"], mean_total_cost=metrics["mean_total_cost"],
            std_total_cost=metrics["std_total_cost"], expiry_loss_rate=metrics["expiry_loss_rate"],
            avg_ending_inventory=metrics["avg_ending_inventory"], std_ending_inventory=metrics["std_ending_inventory"],
        )
        return {"policy_type": policy_type, "params": params, "metrics": metrics, "scores": scores}

    current_policy_type = context["current_policy_type"]
    current_params = context["current_params"]
    current_result = _simulate(current_policy_type, current_params)
    current_score = current_result["scores"]["composite_score"]
    sims_run = 1

    best_alt = None
    if current_score < robustness_service.GOVERNANCE_APPROVAL_THRESHOLD:
        for candidate_type in POLICY_TYPES:
            if candidate_type == current_policy_type:
                continue
            candidate_params = policy_params_for_type(candidate_type, context["computed"])
            if candidate_type in {"s_S", "s_Q", "R_s_S", "base_stock"}:
                candidate_params["safetyStock"] = context["computed"]["safety_stock"]
            candidate_result = _simulate(candidate_type, candidate_params)
            sims_run += 1
            # Selection criterion is the HIGHEST simulated Robustness Score
            # among every other applicable policy type - not lowest cost, not
            # a separate feasibility gate. determine_governance_action below
            # is what decides whether this best-scoring candidate actually
            # clears the >=80-and-beats-current bar worth surfacing.
            if best_alt is None or candidate_result["scores"]["composite_score"] > best_alt["scores"]["composite_score"]:
                best_alt = candidate_result

    best_alt_score = best_alt["scores"]["composite_score"] if best_alt is not None else None
    action = robustness_service.determine_governance_action(current_score, best_alt_score)
    # Only surface a suggestion for the tiers that actually have one -
    # suggest_pending_approval (best_alt already verified to clear both bars
    # by determine_governance_action) or auto_changed (applies best_alt
    # regardless of whether IT clears 80, since some action is mandated at
    # that tier). no_change_needed and no_better_alternative_found never
    # show a suggestion, even though best_alt may be non-None internally.
    suggested_result = best_alt if action in ("suggest_pending_approval", "auto_changed") else None

    audit = None
    if apply_mutations and action == "auto_changed" and suggested_result is not None:
        audit = await robustness_service.apply_auto_change(
            session, sku_code=sku_code, node_code=node_code,
            old_policy_type=current_policy_type, old_params=current_params,
            new_policy_type=suggested_result["policy_type"], new_params=suggested_result["params"],
            composite_score=current_score, changed_at=requested_at,
        )

    reasoning = build_reasoning(
        classification=context["classification"], volatility_ratio=context["volatility_ratio"],
        volatility_p33=vol_percentiles["p33"], volatility_p67=vol_percentiles["p67"],
        trend=context["trend"], cadence_days=context["cadence_days"], unit_cost=context["unit_cost"],
        median_cost=cost_percentiles["median"], p90_cost=cost_percentiles["p90"],
        current_policy_type=current_policy_type, current_score=current_score, governance_action=action,
        suggested_policy_type=suggested_result["policy_type"] if suggested_result else None,
        suggested_score=suggested_result["scores"]["composite_score"] if suggested_result else None,
    )

    return {
        "sku_code": sku_code, "node_code": node_code,
        "current_policy_type": current_policy_type, "current_params": current_params,
        "current_result": current_result, "suggested_result": suggested_result,
        "governance_action": action, "reasoning": reasoning, "sims_run": sims_run, "audit": audit,
    }


async def refresh_recommendations(session: AsyncSession, sku_code: str | None, node_code: str | None,
                                   computed_at: datetime, seed: int | None = None, n_runs: int | None = None,
                                   horizon_days: int | None = None) -> tuple[list[PolicyRecommendation], dict, int]:
    """The network-wide (or single-pair) evaluation pass - upserts one row
    per SKU/node (not append-only), same "mutation piling up on every read"
    fix this project has applied before, just now backed by real simulation
    rather than a cheap business rule. Returns (rows, tier_counts,
    total_simulations_run) so the caller (POST /policy/recommendations/refresh)
    can report real compute-time/tier evidence, not just the rows."""
    seed = seed if seed is not None else DEFAULT_SEED
    n_runs = n_runs or DEFAULT_N_RUNS
    horizon_days = horizon_days or DEFAULT_HORIZON_DAYS
    as_of = computed_at.date() if isinstance(computed_at, datetime) else date.today()

    percentiles = await cost_percentiles(session)
    vol_percentiles = await volatility_percentiles(session)
    pairs = [(sku_code, node_code)] if sku_code and node_code else await sku_node_pairs(session)

    recs: list[PolicyRecommendation] = []
    tier_counts = {"no_change_needed": 0, "suggest_pending_approval": 0, "no_better_alternative_found": 0, "auto_changed": 0}
    total_sims = 0

    for sc, nc in pairs:
        existing = (await session.scalars(
            select(PolicyRecommendation).where(PolicyRecommendation.sku_code == sc, PolicyRecommendation.node_code == nc)
        )).first()
        # Showcase/demo rows (app/seed/demo_robustness_showcase.py) are
        # deliberately never touched by the real pipeline - skip both the
        # simulation and the write entirely so a network-wide refresh can
        # never overwrite or conflict with a demo card. recs/tier_counts
        # intentionally do not include this pair for this pass.
        if existing is not None and existing.is_demo_seed:
            continue

        result = await evaluate_sku_node(
            session, sku_code=sc, node_code=nc, seed=seed, n_runs=n_runs, horizon_days=horizon_days,
            as_of=as_of, requested_at=computed_at, cost_percentiles=percentiles, vol_percentiles=vol_percentiles,
            apply_mutations=True,
        )
        if result is None:
            continue
        total_sims += result["sims_run"]
        tier_counts[result["governance_action"]] += 1

        if existing is None:
            existing = PolicyRecommendation(sku_code=sc, node_code=nc)
            session.add(existing)

        current = result["current_result"]
        suggested = result["suggested_result"]
        existing.computed_at = computed_at
        existing.current_policy_type = result["current_policy_type"]
        existing.current_params = result["current_params"]
        existing.reasoning = result["reasoning"]
        existing.governance_action = result["governance_action"]
        existing.current_composite_score = round(current["scores"]["composite_score"], 2)
        existing.current_service_stability = round(current["scores"]["service_stability"], 2)
        existing.current_stockout_resilience = round(current["scores"]["stockout_resilience"], 2)
        existing.current_cost_stability = round(current["scores"]["cost_stability"], 2)
        existing.current_expiry_robustness = round(current["scores"]["expiry_robustness"], 2)
        existing.current_inventory_stability = round(current["scores"]["inventory_stability"], 2)
        existing.current_service_level_achieved = round(current["metrics"]["service_level_achieved"], 4)
        existing.current_total_cost = round(current["metrics"]["mean_total_cost"], 2)
        existing.current_total_holding_cost = round(current["metrics"]["total_holding_cost"], 2)
        existing.current_total_shortage_cost = round(current["metrics"]["total_shortage_cost"], 2)

        if suggested is not None:
            existing.suggested_policy_type = suggested["policy_type"]
            existing.suggested_params = suggested["params"]
            existing.suggested_composite_score = round(suggested["scores"]["composite_score"], 2)
            existing.suggested_service_stability = round(suggested["scores"]["service_stability"], 2)
            existing.suggested_stockout_resilience = round(suggested["scores"]["stockout_resilience"], 2)
            existing.suggested_cost_stability = round(suggested["scores"]["cost_stability"], 2)
            existing.suggested_expiry_robustness = round(suggested["scores"]["expiry_robustness"], 2)
            existing.suggested_inventory_stability = round(suggested["scores"]["inventory_stability"], 2)
            existing.suggested_service_level_achieved = round(suggested["metrics"]["service_level_achieved"], 4)
            existing.suggested_total_cost = round(suggested["metrics"]["mean_total_cost"], 2)
            existing.suggested_total_holding_cost = round(suggested["metrics"]["total_holding_cost"], 2)
            existing.suggested_total_shortage_cost = round(suggested["metrics"]["total_shortage_cost"], 2)
        else:
            existing.suggested_policy_type = None
            existing.suggested_params = None
            existing.suggested_composite_score = None
            existing.suggested_service_stability = None
            existing.suggested_stockout_resilience = None
            existing.suggested_cost_stability = None
            existing.suggested_expiry_robustness = None
            existing.suggested_inventory_stability = None
            existing.suggested_service_level_achieved = None
            existing.suggested_total_cost = None
            existing.suggested_total_holding_cost = None
            existing.suggested_total_shortage_cost = None

        recs.append(existing)

    await session.commit()
    for rec in recs:
        await session.refresh(rec)
    return recs, tier_counts, total_sims
