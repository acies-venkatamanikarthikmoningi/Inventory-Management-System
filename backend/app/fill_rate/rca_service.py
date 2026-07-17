"""L4 RCA (5-step engine), L5 Action, and Measurement - the final layer of the Fill
Rate use case, sitting entirely on top of L1 (compute_fill_rate), L2
(compute_stockout_backorder_rates via _joined_fill_rate_rows), and L3
(screen_all_drivers, compute_demand_variability). No metric already computed by
those layers is recomputed here.
"""
from datetime import datetime, timedelta, timezone
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.fill_rate.models import DemandBaseline, FillRateActionLog, InventorySnapshot, PurchaseOrder, SalesOrder
from app.fill_rate.service import _joined_fill_rate_rows, compute_demand_variability, compute_fill_rate, screen_all_drivers
from app.fill_rate.triage_service import flagged_driver_names, run_triage

# Fixed reference value for how many days of demand a healthy on-hand position
# should cover - NOT pulled from a live policy config, since this isolated module
# has no cross-database access to the main app's real Phase-3/Phase-5 safety-stock
# policy data (see the module's isolation requirement in docs/implementation-status.md).
RISK_HORIZON_DAYS = 12.2

# Every action any primary_cause can ever recommend, and what applying it means:
# "Update ERP Parameters" is the only one with a real data mutation (refreshes
# DemandBaseline to L3's fresh rmse_d); the rest are acknowledgment-only log
# entries - see apply_recommendation.
ACTION_UPDATE_ERP_PARAMETERS = "Update ERP Parameters"
ACTION_UPDATE_INVENTORY_POLICIES = "Update Inventory Policies"
ACTION_EXPEDITE_PO = "Expedite PO"
ACTION_RAISE_STO = "Raise STO"
ACTION_MANUAL_REVIEW = "Manual review required"


class RcaNotResponsibleError(ValueError):
    """Raised when RCA is requested for a sku/period Triage did not mark
    "responsible" - RCA must never silently run on a non-flagged SKU."""


class InvalidActionError(ValueError):
    """Raised when apply_recommendation is asked to approve an action that isn't
    actually part of this sku/period's RCA recommendation list."""


async def _service_loss_attribution(session: AsyncSession, sku_code: str, date_from, date_to):
    """Step 1. Reuses _joined_fill_rate_rows - the SAME LEFT JOIN L1/L2 use - rather
    than re-joining SalesOrder+GoodsSent."""
    rows = await _joined_fill_rate_rows(session, sku_code=sku_code, date_from=date_from, date_to=date_to)
    unserved_rows = [r for r in rows if r["shippedQty"] == 0 or r["shippedQty"] < r["requestedQty"]]
    unserved_units = sum(r["requestedQty"] - r["shippedQty"] for r in unserved_rows)
    failure_dates = sorted({r["orderDate"] for r in unserved_rows})
    return unserved_units, failure_dates


async def _stockout_driver_analysis(session: AsyncSession, sku_code: str, date_from, date_to):
    """Step 2. mean_demand comes from L3's compute_demand_variability - its
    already-computed mean, not recomputed here."""
    starting_on_hand = (await session.execute(
        select(InventorySnapshot.on_hand_before_shipment)
        .where(
            InventorySnapshot.sku_code == sku_code,
            InventorySnapshot.snapshot_date >= date_from,
            InventorySnapshot.snapshot_date <= date_to,
        )
        .order_by(InventorySnapshot.snapshot_date.asc())
        .limit(1)
    )).scalar_one_or_none()
    starting_on_hand = float(starting_on_hand) if starting_on_hand is not None else 0.0

    demand_variability = await compute_demand_variability(session, sku_code, date_from, date_to)
    mean_demand = demand_variability.get("meanDemand")
    if mean_demand is None:
        return starting_on_hand, None, None

    required_buffer = mean_demand * RISK_HORIZON_DAYS
    was_structurally_insufficient = starting_on_hand < required_buffer
    return starting_on_hand, required_buffer, was_structurally_insufficient


async def _daily_demand_by_date(session: AsyncSession, sku_code: str, date_from, date_to) -> dict:
    stmt = (
        select(SalesOrder.order_date, func.sum(SalesOrder.requested_qty))
        .where(SalesOrder.sku_code == sku_code, SalesOrder.order_date >= date_from, SalesOrder.order_date <= date_to)
        .group_by(SalesOrder.order_date)
    )
    return {d: float(v) for d, v in (await session.execute(stmt)).all()}


async def _forecast_vs_supply_attribution(
    session: AsyncSession, sku_code: str, date_from, date_to, driver_row: dict, mean_demand: float | None,
    failure_dates: list,
):
    """Step 3. driver_row is this sku's row from screen_all_drivers - not
    recomputed. Returns (causal_drivers, noncausal_but_real_drivers), both lists of
    the snake_case driver names."""
    flagged = flagged_driver_names(driver_row)
    causal_drivers: list[str] = []
    noncausal_but_real_drivers: list[str] = []

    if not failure_dates:
        # No unserved orders at all in Step 1 - there's nothing to time-align a
        # driver against, so no flagged driver can be proven causal here (this is
        # unreachable for a Triage-"responsible" sku, since a bad outcome always
        # implies at least one unserved order/failure date; kept as a conservative
        # fallback rather than blindly labeling every flagged driver causal).
        return [], flagged

    min_failure_date = min(failure_dates)

    po = (await session.execute(
        select(PurchaseOrder).where(PurchaseOrder.sku_code == sku_code)
    )).scalars().first()

    high_demand_dates = []
    if mean_demand is not None:
        daily_demand = await _daily_demand_by_date(session, sku_code, date_from, date_to)
        high_demand_dates = [d for d, qty in daily_demand.items() if qty > mean_demand * 1.3]

    for name in flagged:
        if name in ("supplier_otd", "lead_time_variability"):
            if po is not None and po.expected_date is not None and (
                min_failure_date - timedelta(days=3) <= po.expected_date <= min_failure_date
            ):
                causal_drivers.append(name)
            else:
                noncausal_but_real_drivers.append(name)
        elif name in ("demand_variability", "forecast_accuracy"):
            is_causal = any(
                min_failure_date - timedelta(days=1) <= d <= min_failure_date for d in high_demand_dates
            )
            if is_causal:
                causal_drivers.append(name)
            else:
                noncausal_but_real_drivers.append(name)
        elif name == "parameter_age":
            causal_drivers.append(name)

    return causal_drivers, noncausal_but_real_drivers


def _build_recommendation(
    causal_drivers: list[str], noncausal_but_real_drivers: list[str], was_structurally_insufficient: bool | None,
) -> tuple[str, list[str], dict[str, list[dict]]]:
    """Builds the recommendation from EVERY flagged driver (causal AND
    noncausal-but-real), plus an independent structural-stockout check - not from
    causal_drivers alone. A driver being flagged but not proven causal for THIS
    event is still real, actionable evidence (e.g. a supplier with a genuine OTD
    problem is worth expediting even if this particular stockout traces to
    something else) - only forecast_accuracy contributes no action by itself, since
    it has no direct lever on its own; it only matters via co-occurring drivers,
    already covered by the checks below.

    Returns (primary_cause, recommendation, reasons) where reasons maps each
    recommended action to the list of {"driver", "wasCausal"} entries that
    triggered it, so the frontend can show WHY - e.g. "addressing a non-causal but
    real supplier risk" vs. "addressing the confirmed root cause" - not just the
    action name.
    """
    all_flagged = causal_drivers + noncausal_but_real_drivers
    causal_set = set(causal_drivers)
    actions: set[str] = set()
    reasons: dict[str, list[dict]] = {}

    def add_reason(action: str, driver: str, was_causal: bool | None) -> None:
        actions.add(action)
        reasons.setdefault(action, []).append({"driver": driver, "wasCausal": was_causal})

    # Forecast-side actionable drivers.
    for driver in ("demand_variability", "parameter_age"):
        if driver in all_flagged:
            add_reason(ACTION_UPDATE_ERP_PARAMETERS, driver, driver in causal_set)
            add_reason(ACTION_UPDATE_INVENTORY_POLICIES, driver, driver in causal_set)

    # Independent structural check - fires regardless of WHICH side caused it.
    if was_structurally_insufficient:
        add_reason(ACTION_UPDATE_ERP_PARAMETERS, "structural_stockout", True)
        add_reason(ACTION_UPDATE_INVENTORY_POLICIES, "structural_stockout", True)

    # Supply-side actionable drivers.
    for driver in ("supplier_otd", "lead_time_variability"):
        if driver in all_flagged:
            add_reason(ACTION_EXPEDITE_PO, driver, driver in causal_set)
            add_reason(ACTION_RAISE_STO, driver, driver in causal_set)

    # forecast_accuracy alone contributes NO action - deliberately not checked here.

    if not actions:
        return "Unresolved — insufficient evidence", [ACTION_MANUAL_REVIEW], {}

    has_forecast_actions = ACTION_UPDATE_ERP_PARAMETERS in actions
    has_supply_actions = ACTION_EXPEDITE_PO in actions
    if has_forecast_actions and has_supply_actions:
        primary_cause = "Mixed"
    elif has_forecast_actions:
        primary_cause = "Forecast Side"
    else:
        primary_cause = "Supply Side"

    return primary_cause, sorted(actions), reasons


async def run_rca(session: AsyncSession, sku_code: str, date_from, date_to) -> dict:
    """The 5-step RCA engine. Only ever runs for a sku/period Triage marked
    "responsible" - raises RcaNotResponsibleError otherwise (never silently)."""
    triage_rows = await run_triage(session, date_from, date_to)
    triage_row = next((r for r in triage_rows if r["skuCode"] == sku_code), None)
    if triage_row is None or triage_row["status"] != "responsible":
        actual = triage_row["status"] if triage_row else "not present in this period's SalesOrder"
        raise RcaNotResponsibleError(
            f"RCA is only available for SKUs Triage marked 'responsible' for this period. "
            f"{sku_code}'s actual status is '{actual}'."
        )

    driver_rows = await screen_all_drivers(session, date_from, date_to)
    driver_row = next(r for r in driver_rows if r["skuCode"] == sku_code)

    # Step 1
    unserved_units, failure_dates = await _service_loss_attribution(session, sku_code, date_from, date_to)

    # Step 2
    starting_on_hand, required_buffer, was_structurally_insufficient = await _stockout_driver_analysis(
        session, sku_code, date_from, date_to,
    )
    demand_variability = await compute_demand_variability(session, sku_code, date_from, date_to)
    mean_demand = demand_variability.get("meanDemand")

    # Step 3
    causal_drivers, noncausal_but_real_drivers = await _forecast_vs_supply_attribution(
        session, sku_code, date_from, date_to, driver_row, mean_demand, failure_dates,
    )

    # Step 4
    gap_pct = None
    if required_buffer:
        gap_pct = (required_buffer - starting_on_hand) / required_buffer

    # Step 5 - reuses L3's Parameter Age result, not recomputed
    parameter_age = driver_row["parameterAge"]
    is_stale = bool(parameter_age.get("flag"))
    drift_pct = parameter_age.get("driftPct")
    fresh_rmse_d = parameter_age.get("rmseD")

    primary_cause, recommendation, recommendation_reasons = _build_recommendation(
        causal_drivers, noncausal_but_real_drivers, was_structurally_insufficient,
    )

    return {
        "skuCode": sku_code,
        "step1": {"unservedUnits": unserved_units},
        "step2": {
            "startingOnHand": starting_on_hand,
            "requiredBuffer": required_buffer,
            "wasStructurallyInsufficient": was_structurally_insufficient,
        },
        "step3": {"causalDrivers": causal_drivers, "noncausalButRealDrivers": noncausal_but_real_drivers},
        "step4": {"gapPct": round(gap_pct, 4) if gap_pct is not None else None},
        "step5": {"isStale": is_stale, "driftPct": drift_pct, "freshRmseD": fresh_rmse_d},
        "primaryCause": primary_cause,
        "recommendation": recommendation,
        "recommendationReasons": recommendation_reasons,
    }


async def apply_recommendation(
    session: AsyncSession, sku_code: str, date_from, date_to, approved_by: str, actions: list[str] | None = None,
) -> dict:
    """Part C - applies (or, for every action but ACTION_UPDATE_ERP_PARAMETERS,
    simply logs) the RCA recommendation. actions=None approves every action RCA
    recommended for this sku/period; a caller may instead pass a SUBSET of that
    list (e.g. a "Mixed" cause recommends 4 actions - a user might only want to
    approve 2 right now) - anything not in the real recommendation list is
    rejected via InvalidActionError, never silently accepted. One FillRateActionLog
    row is written per approved action, since only ACTION_UPDATE_ERP_PARAMETERS
    carries a real mutation and the two should never be blurred into one row."""
    rca_result = await run_rca(session, sku_code, date_from, date_to)
    primary_cause = rca_result["primaryCause"]
    recommended = rca_result["recommendation"]
    approved_at = datetime.now(timezone.utc).replace(tzinfo=None)

    actions_to_apply = recommended if actions is None else actions
    invalid = [a for a in actions_to_apply if a not in recommended]
    if invalid:
        raise InvalidActionError(
            f"{', '.join(invalid)} - not part of {sku_code}'s current recommendation ({', '.join(recommended)})."
        )

    logged_actions = []
    for action in actions_to_apply:
        old_baseline = None
        new_baseline = None

        if action == ACTION_UPDATE_ERP_PARAMETERS:
            fresh_rmse_d = rca_result["step5"]["freshRmseD"]
            baseline = (await session.execute(
                select(DemandBaseline).where(DemandBaseline.sku_code == sku_code)
            )).scalar_one_or_none()
            if baseline is not None and fresh_rmse_d is not None:
                old_baseline = float(baseline.baseline_rmse_d)
                new_baseline = fresh_rmse_d
                baseline.baseline_rmse_d = fresh_rmse_d
                baseline.computed_at = approved_at

        log = FillRateActionLog(
            sku_code=sku_code,
            primary_cause=primary_cause,
            old_baseline=old_baseline,
            new_baseline=new_baseline,
            action_taken=action,
            approved_by=approved_by,
            approved_at=approved_at,
        )
        session.add(log)
        logged_actions.append(log)

    await session.commit()
    for log in logged_actions:
        await session.refresh(log)

    return {
        "skuCode": sku_code,
        "primaryCause": primary_cause,
        "actions": [
            {
                "id": str(log.id),
                "actionTaken": log.action_taken,
                "oldBaseline": float(log.old_baseline) if log.old_baseline is not None else None,
                "newBaseline": float(log.new_baseline) if log.new_baseline is not None else None,
                "approvedBy": log.approved_by,
                "approvedAt": log.approved_at,
            }
            for log in logged_actions
        ],
    }


async def compare_periods(
    session: AsyncSession, sku_code: str, before_date_from, before_date_to, after_date_from, after_date_to,
) -> dict:
    """Part D - Measurement. Reuses compute_fill_rate for both periods; no fill-rate
    math lives here."""
    before = await compute_fill_rate(session, sku_code=sku_code, date_from=before_date_from, date_to=before_date_to)
    after = await compute_fill_rate(session, sku_code=sku_code, date_from=after_date_from, date_to=after_date_to)
    return {
        "skuCode": sku_code,
        "beforeFillRate": before["fillRate"],
        "afterFillRate": after["fillRate"],
        "delta": round(after["fillRate"] - before["fillRate"], 4),
        "improved": after["fillRate"] > before["fillRate"],
    }
