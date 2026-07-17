import math
from datetime import date
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Batch, Bin, BinType, InventoryPosition, PolicySnapshot, Sku, SkuCostProfile, Zone
from app.services.exceptions_service import MIN_SHELF_LIFE_FRACTION
from app.services.statistics import inverse_normal_cdf
from app.services.variability_service import demand_variability, lead_time_variability

# Mirrors src/utils/uomDisplay.js's CASES_PER_PALLET so warehouse capacity (in pallets, from
# Phase 1's BinType model) converts to the same unit the demand/policy figures are tracked in.
CASES_PER_PALLET = 40

REVIEW_PERIOD_DAYS = 7.0

SERVICE_LEVEL_BY_CLASSIFICATION = {
    "Fast Moving": 0.98,
    "Medium Moving": 0.95,
    "Slow Moving": 0.90,
}
DEFAULT_SERVICE_LEVEL = 0.95


def service_level_for_classification(classification: str | None) -> float:
    return SERVICE_LEVEL_BY_CLASSIFICATION.get(classification, DEFAULT_SERVICE_LEVEL)


# --- Phase 6 Part A: classification-driven initial policy-type assignment.
# A RULE (classification -> type), not a per-SKU lookup table - evaluated
# fresh from each SKU's real classification field every time a policy is
# (re)computed. Fast Moving keeps continuous-review (s,S) (fits
# high-velocity SKUs); Medium Moving gets (s,Q) (fixed order quantity,
# moderate monitoring overhead); Slow Moving gets (R,S) (periodic review -
# continuous monitoring isn't worth the overhead for low-velocity SKUs).
# Unclassified SKUs fall back to DEFAULT_POLICY_TYPE, the system's original
# baseline. Only the initial TYPE assignment changes here - every type's
# parameters still come from policy_params_for_type()'s existing formulas.
CLASSIFICATION_POLICY_TYPE = {
    "Fast Moving": "s_S",
    "Medium Moving": "s_Q",
    "Slow Moving": "R_S",
}


def initial_policy_type_for_classification(classification: str | None) -> str:
    return CLASSIFICATION_POLICY_TYPE.get(classification, DEFAULT_POLICY_TYPE)


def z_score_for_service_level(service_level: float) -> float:
    return inverse_normal_cdf(service_level)


def safety_stock(z: float, review_period_days: float, lead_time_days: float, rmse_d: float, add_rolling: float, rmse_lt: float) -> float:
    """SS = Z * sqrt((R + L) * RMSE_D^2 + ADD^2 * RMSE_LT^2).

    RMSE_D/RMSE_LT measure forecast/lead-time ERROR, not raw variability - a highly
    variable but accurately-forecast SKU should not be over-buffered.
    """
    risk_horizon = review_period_days + lead_time_days
    variance = risk_horizon * (rmse_d ** 2) + (add_rolling ** 2) * (rmse_lt ** 2)
    return z * math.sqrt(max(variance, 0.0))


def reorder_point(add_rolling: float, l_actual: float, fill_rate: float, safety_stock_value: float,
                   total_shelf_life_days: float, min_shelf_life_required_days: float) -> dict:
    """3-step enhanced ROP: fill-rate-corrected base ROP, capped by consumable shelf life."""
    base_rop = (add_rolling * l_actual) / fill_rate + safety_stock_value
    max_holdable_stock = max(total_shelf_life_days - min_shelf_life_required_days, 0.0) * add_rolling
    enhanced_rop = min(base_rop, max_holdable_stock)
    return {"base_rop": base_rop, "max_holdable_stock": max_holdable_stock, "enhanced_rop": enhanced_rop}


def economic_order_quantity(annual_demand: float, ordering_cost: float, holding_cost_per_unit: float) -> float:
    if holding_cost_per_unit <= 0:
        return 0.0
    return math.sqrt((2 * annual_demand * ordering_cost) / holding_cost_per_unit)


def max_replenishment_capacity(rop: float, eoq: float, warehouse_capacity_qty: float,
                                total_shelf_life_days: float, add_rolling: float) -> dict:
    """MAX = ROP + EOQ (target cycle stock), capped by warehouse capacity and by
    what can be consumed within shelf life before it expires."""
    raw_max = rop + eoq
    shelf_life_capacity_qty = total_shelf_life_days * add_rolling
    final_max = min(raw_max, warehouse_capacity_qty, shelf_life_capacity_qty)
    return {"raw_max": raw_max, "shelf_life_capacity_qty": shelf_life_capacity_qty, "final_max": final_max}


# --- Phase 5 Part A: multiple named policy types, extending (not replacing)
# the (s,S) formulas above. Every type reuses s=enhanced_rop / S=final_max /
# EOQ exactly as already computed - no separate re-derivation of the pieces
# that are shared across types.
POLICY_TYPES = ["s_S", "s_Q", "R_S", "R_s_S", "base_stock"]
DEFAULT_POLICY_TYPE = "s_S"  # the only type this system has used until now


def periodic_review_order_up_to(add_rolling: float, review_period_days: float, lead_time_days: float,
                                 safety_stock_value: float) -> float:
    """S = ADD_rolling * (R + L) + SS - the standard periodic-review
    order-up-to level. Uses R+L, not just L: the buffer must cover the full
    gap until the NEXT review, not just the supplier lead time - this is the
    key difference from (s,S)'s continuous-review Max."""
    return add_rolling * (review_period_days + lead_time_days) + safety_stock_value


def policy_params_for_type(policy_type: str, computed: dict) -> dict:
    """Given one compute_policy() result dict, derive policy_type's concrete
    parameters:
      s_S       - s=Enhanced ROP, S=Enhanced MAX (existing formulas, unchanged)
      s_Q       - s=Enhanced ROP, Q=EOQ (already computed for MAX, reused directly)
      R_S       - R=review_period_days, S=periodic_review_order_up_to(...)
      R_s_S     - R=review_period_days, s=Enhanced ROP, S=periodic_review_order_up_to(...)
      base_stock- S=Enhanced MAX, s=S minus one day of ADD_rolling (replace
                  almost immediately on consumption)
    """
    s = computed["enhanced_rop"]
    S = computed["final_max"]
    if policy_type == "s_S":
        return {"s": s, "S": S}
    if policy_type == "s_Q":
        return {"s": s, "Q": computed["eoq"]}
    if policy_type in ("R_S", "R_s_S"):
        review_up_to = periodic_review_order_up_to(
            computed["add_rolling"], computed["review_period_days"], computed["l_actual"], computed["safety_stock"],
        )
        if policy_type == "R_S":
            return {"R": computed["review_period_days"], "S": review_up_to}
        return {"R": computed["review_period_days"], "s": s, "S": review_up_to}
    if policy_type == "base_stock":
        return {"s": max(S - computed["add_rolling"], 0.0), "S": S}
    raise ValueError(f"Unknown policy_type: {policy_type}")


async def warehouse_capacity_qty(session: AsyncSession, sku_code: str, node_code: str) -> float:
    """Sum of pallet capacity (converted to cases) across the distinct bins this
    SKU currently occupies at this node - reuses Phase 1's Bin/BinType capacity data."""
    query = (select(BinType.bin_pallet_capacity)
        .join(Bin, Bin.type_code == BinType.type_code)
        .join(InventoryPosition, InventoryPosition.bin_code == Bin.bin_code)
        .where(InventoryPosition.sku_code == sku_code, InventoryPosition.node_code == node_code)
        .distinct())
    capacities = (await session.scalars(query)).all()
    return sum(capacities) * CASES_PER_PALLET


async def latest_batch(session: AsyncSession, sku_code: str, node_code: str) -> Batch | None:
    return (await session.scalars(
        select(Batch)
        .where(Batch.sku_code == sku_code, Batch.node_code == node_code)
        .order_by(Batch.expiry_date.desc())
    )).first()


async def compute_policy(session: AsyncSession, sku_code: str, node_code: str, as_of: date | None = None) -> dict | None:
    as_of = as_of or date.today()

    demand = await demand_variability(session, sku_code, node_code, as_of)
    lead_time = await lead_time_variability(session, sku_code, node_code, as_of)
    cost = (await session.scalars(select(SkuCostProfile).where(SkuCostProfile.sku_code == sku_code))).first()
    if not (demand and lead_time and cost):
        return None

    sku = (await session.scalars(select(Sku).where(Sku.sku_code == sku_code))).first()
    batch = await latest_batch(session, sku_code, node_code)
    total_shelf_life_days = float((batch.expiry_date - batch.mfg_date).days) if batch else 0.0
    min_shelf_life_required_days = total_shelf_life_days * MIN_SHELF_LIFE_FRACTION

    service_level = service_level_for_classification(sku.classification if sku else None)
    z = z_score_for_service_level(service_level)

    ss = safety_stock(z, REVIEW_PERIOD_DAYS, lead_time["l_actual"], demand["rmse_d"], demand["add_rolling"], lead_time["rmse_lt"])
    rop = reorder_point(demand["add_rolling"], lead_time["l_actual"], lead_time["fill_rate"], ss,
                         total_shelf_life_days, min_shelf_life_required_days)

    annual_demand = demand["add_rolling"] * 365
    holding_cost_per_unit = float(cost.unit_cost) * float(cost.holding_cost_pct)
    eoq = economic_order_quantity(annual_demand, float(cost.ordering_cost), holding_cost_per_unit)

    capacity_qty = await warehouse_capacity_qty(session, sku_code, node_code)
    max_result = max_replenishment_capacity(rop["enhanced_rop"], eoq, capacity_qty, total_shelf_life_days, demand["add_rolling"])

    return {
        "sku_code": sku_code, "node_code": node_code, "computed_at_source": as_of,
        "review_period_days": REVIEW_PERIOD_DAYS, "service_level": service_level, "z_score": z,
        "add_rolling": demand["add_rolling"], "rmse_d": demand["rmse_d"],
        "l_actual": lead_time["l_actual"], "rmse_lt": lead_time["rmse_lt"], "fill_rate": lead_time["fill_rate"],
        "safety_stock": ss,
        "base_rop": rop["base_rop"], "total_shelf_life_days": total_shelf_life_days,
        "min_shelf_life_required_days": min_shelf_life_required_days,
        "max_holdable_stock": rop["max_holdable_stock"], "enhanced_rop": rop["enhanced_rop"],
        "eoq": eoq, "raw_max": max_result["raw_max"], "warehouse_capacity_qty": capacity_qty,
        "shelf_life_capacity_qty": max_result["shelf_life_capacity_qty"], "final_max": max_result["final_max"],
        "policy_type": initial_policy_type_for_classification(sku.classification if sku else None),
    }


async def sku_node_pairs(session: AsyncSession) -> list[tuple[str, str]]:
    rows = (await session.execute(select(InventoryPosition.sku_code, InventoryPosition.node_code).distinct())).all()
    return [(sku_code, node_code) for sku_code, node_code in rows]


async def initial_on_hand(session: AsyncSession, sku_code: str, node_code: str) -> float:
    """Shared by simulation_service and policy_recommendation_service's
    evaluate_sku_node - both need the same real starting on-hand quantity for
    a Monte Carlo run, so this lives here rather than being duplicated."""
    rows = (await session.scalars(
        select(InventoryPosition.available).where(
            InventoryPosition.sku_code == sku_code, InventoryPosition.node_code == node_code
        )
    )).all()
    return float(sum(rows))


async def refresh_policy(session: AsyncSession, sku_code: str | None, node_code: str | None, computed_at, as_of: date | None = None) -> list[PolicySnapshot]:
    pairs = [(sku_code, node_code)] if sku_code and node_code else await sku_node_pairs(session)
    snapshots = []
    for sc, nc in pairs:
        result = await compute_policy(session, sc, nc, as_of)
        if result is None:
            continue
        snapshot = PolicySnapshot(
            sku_code=result["sku_code"], node_code=result["node_code"], computed_at=computed_at,
            review_period_days=result["review_period_days"], service_level=result["service_level"], z_score=result["z_score"],
            add_rolling=result["add_rolling"], rmse_d=result["rmse_d"], l_actual=result["l_actual"],
            rmse_lt=result["rmse_lt"], fill_rate=result["fill_rate"], safety_stock=result["safety_stock"],
            base_rop=result["base_rop"], total_shelf_life_days=result["total_shelf_life_days"],
            min_shelf_life_required_days=result["min_shelf_life_required_days"],
            max_holdable_stock=result["max_holdable_stock"], enhanced_rop=result["enhanced_rop"],
            eoq=result["eoq"], raw_max=result["raw_max"], warehouse_capacity_qty=result["warehouse_capacity_qty"],
            shelf_life_capacity_qty=result["shelf_life_capacity_qty"], final_max=result["final_max"],
            policy_type=result["policy_type"],
        )
        session.add(snapshot)
        snapshots.append(snapshot)
    await session.commit()
    for snapshot in snapshots:
        await session.refresh(snapshot)
    return snapshots


async def apply_policy_type_change(session: AsyncSession, sku_code: str, node_code: str,
                                    new_policy_type: str, changed_at) -> PolicySnapshot | None:
    """Creates a new PolicySnapshot row (the same append-only audit-trail
    pattern refresh_policy already uses - latest computed_at wins) carrying
    the SAME underlying computed SS/ROP/MAX/EOQ/etc values as the latest
    snapshot, just re-labeled under new_policy_type. This becomes the new
    "current" policy for every future query. Used by Phase 6's governance
    auto-apply and human-approval paths - callers are responsible for
    writing a PolicyChangeAuditLog row alongside this and committing.
    Does not commit; flushes so the returned row has real column values."""
    latest = (await session.scalars(
        select(PolicySnapshot).where(PolicySnapshot.sku_code == sku_code, PolicySnapshot.node_code == node_code)
        .order_by(PolicySnapshot.computed_at.desc())
    )).first()
    if latest is None:
        return None
    new_snapshot = PolicySnapshot(
        sku_code=sku_code, node_code=node_code, computed_at=changed_at,
        review_period_days=latest.review_period_days, service_level=latest.service_level, z_score=latest.z_score,
        add_rolling=latest.add_rolling, rmse_d=latest.rmse_d, l_actual=latest.l_actual,
        rmse_lt=latest.rmse_lt, fill_rate=latest.fill_rate, safety_stock=latest.safety_stock,
        base_rop=latest.base_rop, total_shelf_life_days=latest.total_shelf_life_days,
        min_shelf_life_required_days=latest.min_shelf_life_required_days,
        max_holdable_stock=latest.max_holdable_stock, enhanced_rop=latest.enhanced_rop,
        eoq=latest.eoq, raw_max=latest.raw_max, warehouse_capacity_qty=latest.warehouse_capacity_qty,
        shelf_life_capacity_qty=latest.shelf_life_capacity_qty, final_max=latest.final_max,
        policy_type=new_policy_type,
    )
    session.add(new_snapshot)
    await session.flush()
    return new_snapshot


_METRICS = [
    ("Safety Stock", lambda s: float(s.safety_stock)),
    ("Reorder Point", lambda s: float(s.enhanced_rop)),
    ("Maximum Stock Level", lambda s: float(s.final_max)),
]


def _metric_explanation(metric: str, previous, current, prev_value: float, curr_value: float) -> str:
    direction = "increased" if curr_value >= prev_value else "decreased"
    return (
        f"{metric} {direction} from {prev_value:,.0f} to {curr_value:,.0f} as the trailing inputs shifted: "
        f"avg daily demand {float(previous.add_rolling):.0f} -> {float(current.add_rolling):.0f}/day, "
        f"demand forecast error (RMSE) {float(previous.rmse_d):.0f} -> {float(current.rmse_d):.0f}, "
        f"actual lead time {float(previous.l_actual):.1f} -> {float(current.l_actual):.1f} days, "
        f"supplier fill rate {float(previous.fill_rate) * 100:.0f}% -> {float(current.fill_rate) * 100:.0f}%."
    )


async def policy_drift(session: AsyncSession) -> list[dict]:
    """Compares each SKU/node's two most recent snapshots and produces one drift
    item per metric (SS/ROP/MAX), replacing the previously-hardcoded mock array."""
    rows = (await session.scalars(select(PolicySnapshot).order_by(PolicySnapshot.computed_at.desc()))).all()
    by_pair: dict[tuple[str, str], list[PolicySnapshot]] = {}
    for row in rows:
        by_pair.setdefault((row.sku_code, row.node_code), []).append(row)

    skus_by_code = {sku.sku_code: sku for sku in (await session.scalars(select(Sku))).all()}
    costs_by_sku = {cost.sku_code: cost for cost in (await session.scalars(select(SkuCostProfile))).all()}

    items = []
    for (sku_code, node_code), snapshots in by_pair.items():
        if len(snapshots) < 2:
            continue
        current, previous = snapshots[0], snapshots[1]
        sku_name = skus_by_code[sku_code].description if sku_code in skus_by_code else sku_code
        cost = costs_by_sku.get(sku_code)
        for metric, extractor in _METRICS:
            prev_value = extractor(previous)
            curr_value = extractor(current)
            if prev_value == 0:
                continue
            drift_pct = ((curr_value - prev_value) / prev_value) * 100
            delta_qty = curr_value - prev_value
            impact = [{"label": "Inventory change", "value": f"{'+' if delta_qty >= 0 else ''}{delta_qty:,.0f} units"}]
            if cost is not None:
                annual_cost_delta = delta_qty * float(cost.unit_cost) * float(cost.holding_cost_pct)
                impact.append({"label": "Estimated holding cost impact (annualized)", "value": f"{'+' if annual_cost_delta >= 0 else '-'}{abs(annual_cost_delta):,.0f}"})
            items.append({
                "skuCode": sku_code, "skuName": sku_name, "node": node_code, "metric": metric,
                "previousValue": prev_value, "currentValue": curr_value,
                "driftPct": drift_pct, "driftDirection": "up" if drift_pct >= 0 else "down",
                "previousComputedAt": previous.computed_at, "currentComputedAt": current.computed_at,
                "evidence": [
                    {"label": "Avg daily demand", "fromValue": f"{float(previous.add_rolling):.0f}/day", "toValue": f"{float(current.add_rolling):.0f}/day"},
                    {"label": "Demand forecast error (RMSE)", "fromValue": f"{float(previous.rmse_d):.0f}", "toValue": f"{float(current.rmse_d):.0f}"},
                    {"label": "Actual lead time", "fromValue": f"{float(previous.l_actual):.1f} days", "toValue": f"{float(current.l_actual):.1f} days"},
                    {"label": "Supplier fill rate", "fromValue": f"{float(previous.fill_rate) * 100:.0f}%", "toValue": f"{float(current.fill_rate) * 100:.0f}%"},
                ],
                "explanation": _metric_explanation(metric, previous, current, prev_value, curr_value),
                "impact": impact,
            })
    items.sort(key=lambda i: abs(i["driftPct"]), reverse=True)
    return items
