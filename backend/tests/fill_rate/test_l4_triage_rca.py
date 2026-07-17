from datetime import date
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.fill_rate.db import Base
import app.fill_rate.models  # noqa: F401
from app.fill_rate.models import DemandBaseline, DemandForecast, FillRateActionLog, GoodsReceipt, GoodsSent, InventorySnapshot, PurchaseOrder, SalesOrder
from app.fill_rate.rca_service import (
    ACTION_EXPEDITE_PO, ACTION_MANUAL_REVIEW, ACTION_RAISE_STO, ACTION_UPDATE_ERP_PARAMETERS,
    ACTION_UPDATE_INVENTORY_POLICIES, InvalidActionError, RcaNotResponsibleError, apply_recommendation,
    compare_periods, run_rca,
)
from app.fill_rate.triage_service import run_triage

FROM, TO = date(2024, 1, 1), date(2024, 1, 7)
DAYS = [date(2024, 1, d) for d in range(1, 8)]


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db_session:
        yield db_session
    await engine.dispose()


def _order(order_id, sku_code, day_index, qty):
    return SalesOrder(order_id=order_id, order_date=DAYS[day_index], day="D", sku_code=sku_code, sku_name=sku_code,
                       node="NODE-L4", requested_qty=qty)


def _snapshot(sku_code, snapshot_date, on_hand_before, shipped, on_hand_eod):
    return InventorySnapshot(snapshot_date=snapshot_date, day="D", sku_code=sku_code, sku_name=sku_code,
                              on_hand_before_shipment=on_hand_before, qty_shipped=shipped, on_hand_eod=on_hand_eod)


async def _seed_fully_filled(session, sku_code, qty=100):
    """7 fully-shipped orders, one per day - a clean, healthy sku."""
    for i in range(7):
        session.add(_order(f"ORD-{sku_code}-{i}", sku_code, i, qty))
    await session.flush()
    for i in range(7):
        session.add(GoodsSent(order_id=f"ORD-{sku_code}-{i}", shipped_qty=qty))
    await session.commit()


# ── Part A: Triage classification ────────────────────────────────────────────

async def test_triage_healthy_when_no_bad_outcome_and_no_flagged_driver(session):
    await _seed_fully_filled(session, "SKU-HEALTHY")
    rows = await run_triage(session, FROM, TO)
    row = next(r for r in rows if r["skuCode"] == "SKU-HEALTHY")
    assert row["status"] == "healthy"
    assert row["flaggedDrivers"] == []


async def test_triage_unexplained_when_bad_outcome_but_no_flagged_driver(session):
    for i in range(7):
        session.add(_order(f"ORD-UNEXP-{i}", "SKU-UNEXPLAINED", i, 100))
    await session.flush()
    for i in range(7):
        # day 3 only partially shipped -> backorder -> bad outcome, but demand is
        # flat (no variability) and no PO/forecast data exists -> no driver flags.
        shipped = 50 if i == 3 else 100
        session.add(GoodsSent(order_id=f"ORD-UNEXP-{i}", shipped_qty=shipped))
    await session.commit()

    rows = await run_triage(session, FROM, TO)
    row = next(r for r in rows if r["skuCode"] == "SKU-UNEXPLAINED")
    assert row["status"] == "unexplained"
    assert row["flaggedDrivers"] == []
    assert row["backorderRate"] > 0


async def test_triage_watch_when_flagged_driver_but_no_bad_outcome(session):
    qtys = [10, 200, 10, 200, 10, 200, 10]  # highly variable demand, cv > 0.5
    for i, qty in enumerate(qtys):
        session.add(_order(f"ORD-WATCH-{i}", "SKU-WATCH", i, qty))
    await session.flush()
    for i, qty in enumerate(qtys):
        session.add(GoodsSent(order_id=f"ORD-WATCH-{i}", shipped_qty=qty))  # fully shipped every time
    await session.commit()

    rows = await run_triage(session, FROM, TO)
    row = next(r for r in rows if r["skuCode"] == "SKU-WATCH")
    assert row["status"] == "watch"
    assert "demand_variability" in row["flaggedDrivers"]
    assert row["fillRate"] == 1.0


async def test_triage_responsible_when_bad_outcome_and_flagged_driver(session):
    qtys = [10, 200, 10, 200, 10, 200, 10]
    for i, qty in enumerate(qtys):
        session.add(_order(f"ORD-RESP-{i}", "SKU-RESP", i, qty))
    await session.flush()
    for i, qty in enumerate(qtys):
        shipped = qty if i != 1 else 0  # the spike day goes completely unserved
        session.add(GoodsSent(order_id=f"ORD-RESP-{i}", shipped_qty=shipped))
    await session.commit()

    rows = await run_triage(session, FROM, TO)
    row = next(r for r in rows if r["skuCode"] == "SKU-RESP")
    assert row["status"] == "responsible"
    assert "demand_variability" in row["flaggedDrivers"]
    assert row["stockoutRate"] > 0


# ── Part B: RCA recommendation logic (built from ALL flagged drivers, causal or
#    not, plus an independent structural-stockout check) ─────────────────────

async def test_rca_rejects_a_sku_triage_did_not_mark_responsible(session):
    await _seed_fully_filled(session, "SKU-HEALTHY")
    with pytest.raises(RcaNotResponsibleError):
        await run_rca(session, "SKU-HEALTHY", FROM, TO)


async def test_forecast_side_fires_even_when_buffer_adequate(session):
    """A demand-side driver (demand_variability) being flagged is now enough on its
    own to recommend the forecast-side actions - it no longer needs
    was_structurally_insufficient=True to fire (that's now an INDEPENDENT trigger,
    not a gate)."""
    qtys = [100, 100, 500, 100, 100, 100, 100]  # spike on day index 2
    for i, qty in enumerate(qtys):
        session.add(_order(f"ORD-SHOCK-{i}", "SKU-SHOCK", i, qty))
    await session.flush()
    for i, qty in enumerate(qtys):
        shipped = 400 if i == 2 else qty  # the spike day is the one that fails
        session.add(GoodsSent(order_id=f"ORD-SHOCK-{i}", shipped_qty=shipped))
    session.add(_snapshot("SKU-SHOCK", DAYS[0], on_hand_before=3000, shipped=100, on_hand_eod=2900))
    await session.commit()

    triage_rows = await run_triage(session, FROM, TO)
    assert next(r for r in triage_rows if r["skuCode"] == "SKU-SHOCK")["status"] == "responsible"

    rca = await run_rca(session, "SKU-SHOCK", FROM, TO)
    assert rca["step3"]["causalDrivers"] == ["demand_variability"]
    assert rca["step2"]["wasStructurallyInsufficient"] is False
    assert rca["primaryCause"] == "Forecast Side"
    assert rca["recommendation"] == [ACTION_UPDATE_ERP_PARAMETERS, ACTION_UPDATE_INVENTORY_POLICIES]
    reasons = rca["recommendationReasons"][ACTION_UPDATE_ERP_PARAMETERS]
    assert {"driver": "demand_variability", "wasCausal": True} in reasons
    assert not any(r["driver"] == "structural_stockout" for r in reasons)


async def test_supply_side_recommendation(session):
    session.add(_order("ORD-SUPPLY-0", "SKU-SUPPLY", 4, 100))  # fails on day index 4 (Jan 5)
    await session.flush()
    session.add(GoodsSent(order_id="ORD-SUPPLY-0", shipped_qty=0))  # full stockout
    # PO expected 2 days before the failure date -> within the 3-day causal window
    po = PurchaseOrder(po_number="PO-SUPPLY", sku_code="SKU-SUPPLY", node_code="NODE-L4", supplier_code="SUP-L4",
                        order_date=date(2023, 12, 20), ordered_qty=100, expected_date=date(2024, 1, 3))
    session.add(po)
    await session.flush()
    session.add(GoodsReceipt(purchase_order_id=po.id, received_qty=100, receipt_date=date(2024, 1, 6)))  # late
    await session.commit()

    triage_rows = await run_triage(session, FROM, TO)
    assert next(r for r in triage_rows if r["skuCode"] == "SKU-SUPPLY")["status"] == "responsible"

    rca = await run_rca(session, "SKU-SUPPLY", FROM, TO)
    assert "supplier_otd" in rca["step3"]["causalDrivers"]
    assert rca["primaryCause"] == "Supply Side"
    assert rca["recommendation"] == [ACTION_EXPEDITE_PO, ACTION_RAISE_STO]


async def test_sku2001_style_mixed_with_noncausal_supplier(session):
    """The exact bug this task fixes: a causal forecast-side driver PLUS a
    supplier_otd driver that's flagged but NOT causal for this specific event must
    still both contribute actions - "Mixed", not "Forecast Side" alone - since a
    non-causal-but-real supplier risk is still real, actionable evidence."""
    qtys = [100, 100, 500, 100, 100, 100, 100]  # spike on day index 2 (Jan 3)
    for i, qty in enumerate(qtys):
        session.add(_order(f"ORD-MIXNC-{i}", "SKU-MIXNC", i, qty))
    await session.flush()
    for i, qty in enumerate(qtys):
        shipped = 400 if i == 2 else qty  # the spike day is the one that fails
        session.add(GoodsSent(order_id=f"ORD-MIXNC-{i}", shipped_qty=shipped))
    # PO expected date is FAR from the failure date -> flagged (late) but noncausal.
    po = PurchaseOrder(po_number="PO-MIXNC", sku_code="SKU-MIXNC", node_code="NODE-L4", supplier_code="SUP-L4",
                        order_date=date(2023, 11, 1), ordered_qty=100, expected_date=date(2023, 12, 1))
    session.add(po)
    await session.flush()
    session.add(GoodsReceipt(purchase_order_id=po.id, received_qty=100, receipt_date=date(2023, 12, 10)))
    await session.commit()

    rca = await run_rca(session, "SKU-MIXNC", FROM, TO)
    assert rca["step3"]["causalDrivers"] == ["demand_variability"]
    assert "supplier_otd" in rca["step3"]["noncausalButRealDrivers"]
    assert rca["primaryCause"] == "Mixed"
    assert set(rca["recommendation"]) == {
        ACTION_UPDATE_ERP_PARAMETERS, ACTION_UPDATE_INVENTORY_POLICIES, ACTION_EXPEDITE_PO, ACTION_RAISE_STO,
    }
    assert {"driver": "demand_variability", "wasCausal": True} in rca["recommendationReasons"][ACTION_UPDATE_ERP_PARAMETERS]
    assert {"driver": "supplier_otd", "wasCausal": False} in rca["recommendationReasons"][ACTION_EXPEDITE_PO]


async def test_structural_stockout_alone_triggers_erp_update(session):
    """Only a supply-side driver is flagged, but starting on-hand is structurally
    insufficient - the ERP/inventory-policy actions must still fire, purely off the
    independent structural check, not off any forecast-side driver."""
    for i in range(7):
        session.add(_order(f"ORD-STRUCT-{i}", "SKU-STRUCT", i, 100))  # flat demand -> cv == 0, never flagged
    await session.flush()
    for i in range(7):
        shipped = 0 if i == 6 else 100
        session.add(GoodsSent(order_id=f"ORD-STRUCT-{i}", shipped_qty=shipped))
    po = PurchaseOrder(po_number="PO-STRUCT", sku_code="SKU-STRUCT", node_code="NODE-L4", supplier_code="SUP-L4",
                        order_date=date(2023, 12, 20), ordered_qty=100, expected_date=date(2024, 1, 3))
    session.add(po)
    await session.flush()
    session.add(GoodsReceipt(purchase_order_id=po.id, received_qty=100, receipt_date=date(2024, 1, 6)))  # late
    # Starting on-hand (10) is far below required_buffer (mean_demand 100 * 12.2).
    session.add(_snapshot("SKU-STRUCT", DAYS[0], on_hand_before=10, shipped=100, on_hand_eod=0))
    await session.commit()

    rca = await run_rca(session, "SKU-STRUCT", FROM, TO)
    assert rca["step3"]["causalDrivers"] == [] or "demand_variability" not in rca["step3"]["causalDrivers"]
    assert rca["step2"]["wasStructurallyInsufficient"] is True
    assert ACTION_UPDATE_ERP_PARAMETERS in rca["recommendation"]
    assert ACTION_UPDATE_INVENTORY_POLICIES in rca["recommendation"]
    # The ERP action's ONLY reason is the structural check - no forecast-side driver
    # was flagged at all, proving the structural trigger is independent.
    assert rca["recommendationReasons"][ACTION_UPDATE_ERP_PARAMETERS] == [
        {"driver": "structural_stockout", "wasCausal": True},
    ]
    assert ACTION_EXPEDITE_PO in rca["recommendation"]  # supplier_otd still contributes its own action


async def test_forecast_accuracy_alone_falls_back_to_supplier_action(session):
    """forecast_accuracy has no direct lever of its own - a SKU with ONLY
    forecast_accuracy + supplier_otd flagged (no demand_variability, no
    parameter_age) must land on "Supply Side" via supplier_otd, not
    "Manual review required"."""
    week_from, week_to = date(2026, 6, 1), date(2026, 6, 7)
    week_days = [date(2026, 6, d) for d in range(1, 8)]
    qtys = [150] * 7  # flat -> demand_variability never flags (cv == 0)
    for i, qty in enumerate(qtys):
        session.add(SalesOrder(order_id=f"ORD-FCONLY-{i}", order_date=week_days[i], day="D", sku_code="SKU-FCONLY",
                                sku_name="SKU-FCONLY", node="NODE-L4", requested_qty=qty))
    await session.flush()
    for i, qty in enumerate(qtys):
        shipped = 0 if i == 6 else qty
        session.add(GoodsSent(order_id=f"ORD-FCONLY-{i}", shipped_qty=shipped))
    # forecast (700/week = 100/day) vs. actual (150/day) -> accuracy 0.5 < 0.85 -> flagged.
    session.add(DemandForecast(sku_code="SKU-FCONLY", sku_name="SKU-FCONLY", node="NODE-L4",
                                week1_forecast=700, week2_forecast=700, week3_forecast=700, week4_forecast=700))
    po = PurchaseOrder(po_number="PO-FCONLY", sku_code="SKU-FCONLY", node_code="NODE-L4", supplier_code="SUP-L4",
                        order_date=date(2026, 5, 1), ordered_qty=100, expected_date=date(2026, 5, 10))
    session.add(po)
    await session.flush()
    session.add(GoodsReceipt(purchase_order_id=po.id, received_qty=100, receipt_date=date(2026, 5, 20)))  # late
    # Ample starting on-hand -> NOT structurally insufficient, so this test isolates
    # the driver-flag path only (no structural-check contamination).
    session.add(_snapshot("SKU-FCONLY", week_days[0], on_hand_before=5000, shipped=150, on_hand_eod=4850))
    await session.commit()

    rca = await run_rca(session, "SKU-FCONLY", week_from, week_to)
    assert "forecast_accuracy" in rca["step3"]["causalDrivers"] + rca["step3"]["noncausalButRealDrivers"]
    assert "demand_variability" not in rca["step3"]["causalDrivers"] + rca["step3"]["noncausalButRealDrivers"]
    assert "parameter_age" not in rca["step3"]["causalDrivers"] + rca["step3"]["noncausalButRealDrivers"]
    assert rca["step2"]["wasStructurallyInsufficient"] is False
    assert rca["primaryCause"] == "Supply Side"
    assert rca["recommendation"] == [ACTION_EXPEDITE_PO, ACTION_RAISE_STO]
    assert ACTION_UPDATE_ERP_PARAMETERS not in rca["recommendation"]


async def test_manual_review_only_when_truly_no_actionable_driver(session):
    """forecast_accuracy flagged alone, no PO at all, buffer adequate - NO
    actionable driver and no structural trigger -> genuinely "Manual review
    required", the only remaining path to it."""
    week_from, week_to = date(2026, 6, 1), date(2026, 6, 7)
    week_days = [date(2026, 6, d) for d in range(1, 8)]
    qtys = [150] * 7
    for i, qty in enumerate(qtys):
        session.add(SalesOrder(order_id=f"ORD-ONLYFC-{i}", order_date=week_days[i], day="D", sku_code="SKU-ONLYFC",
                                sku_name="SKU-ONLYFC", node="NODE-L4", requested_qty=qty))
    await session.flush()
    for i, qty in enumerate(qtys):
        shipped = 0 if i == 6 else qty
        session.add(GoodsSent(order_id=f"ORD-ONLYFC-{i}", shipped_qty=shipped))
    session.add(DemandForecast(sku_code="SKU-ONLYFC", sku_name="SKU-ONLYFC", node="NODE-L4",
                                week1_forecast=700, week2_forecast=700, week3_forecast=700, week4_forecast=700))
    session.add(_snapshot("SKU-ONLYFC", week_days[0], on_hand_before=5000, shipped=150, on_hand_eod=4850))
    await session.commit()

    triage_rows = await run_triage(session, week_from, week_to)
    assert next(r for r in triage_rows if r["skuCode"] == "SKU-ONLYFC")["status"] == "responsible"

    rca = await run_rca(session, "SKU-ONLYFC", week_from, week_to)
    all_flagged = rca["step3"]["causalDrivers"] + rca["step3"]["noncausalButRealDrivers"]
    assert all_flagged == ["forecast_accuracy"]
    assert rca["step2"]["wasStructurallyInsufficient"] is False
    assert rca["primaryCause"] == "Unresolved — insufficient evidence"
    assert rca["recommendation"] == [ACTION_MANUAL_REVIEW]
    assert rca["recommendationReasons"] == {}


async def test_forecast_side_with_structural_insufficiency(session):
    """parameter_age causal (always causal when flagged) AND starting on-hand WAS
    structurally insufficient -> "Forecast Side", with both ERP/inventory-policy
    actions recommended."""
    week_from, week_to = date(2026, 6, 1), date(2026, 6, 7)
    week_days = [date(2026, 6, d) for d in range(1, 8)]
    # Actual demand (150/day) runs well above the forecast's implied daily rate
    # (700/week = 100/day) so the fresh demand RMSE comes out well above the LOW
    # pre-seeded baseline below - demand itself stays perfectly flat (cv=0, so
    # demand_variability never confounds this as a second causal driver).
    qtys = [150, 150, 150, 150, 150, 150, 150]
    for i, qty in enumerate(qtys):
        session.add(SalesOrder(order_id=f"ORD-DRIFT-{i}", order_date=week_days[i], day="D", sku_code="SKU-DRIFT",
                                sku_name="SKU-DRIFT", node="NODE-L4", requested_qty=qty))
    await session.flush()
    for i, qty in enumerate(qtys):
        shipped = 0 if i == 6 else qty  # fails on the last day
        session.add(GoodsSent(order_id=f"ORD-DRIFT-{i}", shipped_qty=shipped))
    # Forecast row so Driver 1/5 can compute against the real Week-1 bucket.
    session.add(DemandForecast(sku_code="SKU-DRIFT", sku_name="SKU-DRIFT", node="NODE-L4",
                                week1_forecast=700, week2_forecast=700, week3_forecast=700, week4_forecast=700))
    # A LOW pre-existing baseline so the fresh RMSE drifts sharply above it (>15%).
    session.add(DemandBaseline(sku_code="SKU-DRIFT", baseline_rmse_d=1.0, computed_at=date(2026, 5, 25)))
    # Low starting on-hand so the buffer is structurally insufficient.
    session.add(_snapshot("SKU-DRIFT", week_days[0], on_hand_before=50, shipped=100, on_hand_eod=0))
    await session.commit()

    triage_rows = await run_triage(session, week_from, week_to)
    assert next(r for r in triage_rows if r["skuCode"] == "SKU-DRIFT")["status"] == "responsible"

    rca = await run_rca(session, "SKU-DRIFT", week_from, week_to)
    assert "parameter_age" in rca["step3"]["causalDrivers"]
    assert rca["step2"]["wasStructurallyInsufficient"] is True
    assert rca["primaryCause"] == "Forecast Side"
    assert rca["recommendation"] == [ACTION_UPDATE_ERP_PARAMETERS, ACTION_UPDATE_INVENTORY_POLICIES]


async def test_mixed_when_both_sides_present(session):
    """A demand spike (causal demand_variability) and a late PO (causal
    supplier_otd) both align with the SAME failure date -> "Mixed", with all 4
    actions recommended."""
    qtys = [100, 100, 100, 100, 500, 100, 100]  # spike on day index 4 (Jan 5)
    for i, qty in enumerate(qtys):
        session.add(_order(f"ORD-MIXED-{i}", "SKU-MIXED", i, qty))
    await session.flush()
    for i, qty in enumerate(qtys):
        shipped = 400 if i == 4 else qty  # the spike day is the one that fails
        session.add(GoodsSent(order_id=f"ORD-MIXED-{i}", shipped_qty=shipped))
    po = PurchaseOrder(po_number="PO-MIXED", sku_code="SKU-MIXED", node_code="NODE-L4", supplier_code="SUP-L4",
                        order_date=date(2023, 12, 20), ordered_qty=100, expected_date=date(2024, 1, 3))
    session.add(po)
    await session.flush()
    session.add(GoodsReceipt(purchase_order_id=po.id, received_qty=100, receipt_date=date(2024, 1, 6)))  # late
    await session.commit()

    triage_rows = await run_triage(session, FROM, TO)
    assert next(r for r in triage_rows if r["skuCode"] == "SKU-MIXED")["status"] == "responsible"

    rca = await run_rca(session, "SKU-MIXED", FROM, TO)
    assert "demand_variability" in rca["step3"]["causalDrivers"]
    assert "supplier_otd" in rca["step3"]["causalDrivers"]
    assert rca["primaryCause"] == "Mixed"
    assert set(rca["recommendation"]) == {
        ACTION_UPDATE_ERP_PARAMETERS, ACTION_UPDATE_INVENTORY_POLICIES, ACTION_EXPEDITE_PO, ACTION_RAISE_STO,
    }


# ── Part C: Action ────────────────────────────────────────────────────────────

async def test_apply_recommendation_updates_baseline_for_erp_parameters_action(session):
    week_from, week_to = date(2026, 6, 1), date(2026, 6, 7)
    week_days = [date(2026, 6, d) for d in range(1, 8)]
    qtys = [150] * 7
    for i, qty in enumerate(qtys):
        session.add(SalesOrder(order_id=f"ORD-APPLY-{i}", order_date=week_days[i], day="D", sku_code="SKU-APPLY",
                                sku_name="SKU-APPLY", node="NODE-L4", requested_qty=qty))
    await session.flush()
    for i, qty in enumerate(qtys):
        shipped = 0 if i == 6 else qty
        session.add(GoodsSent(order_id=f"ORD-APPLY-{i}", shipped_qty=shipped))
    session.add(DemandForecast(sku_code="SKU-APPLY", sku_name="SKU-APPLY", node="NODE-L4",
                                week1_forecast=700, week2_forecast=700, week3_forecast=700, week4_forecast=700))
    session.add(DemandBaseline(sku_code="SKU-APPLY", baseline_rmse_d=1.0, computed_at=date(2026, 5, 25)))
    session.add(_snapshot("SKU-APPLY", week_days[0], on_hand_before=50, shipped=100, on_hand_eod=0))
    await session.commit()

    result = await apply_recommendation(session, "SKU-APPLY", week_from, week_to, approved_by="tester@example.com")

    assert result["primaryCause"] == "Forecast Side"
    actions_by_name = {a["actionTaken"]: a for a in result["actions"]}
    erp_action = actions_by_name[ACTION_UPDATE_ERP_PARAMETERS]
    assert erp_action["oldBaseline"] == 1.0
    assert erp_action["newBaseline"] is not None and erp_action["newBaseline"] > 1.0
    assert erp_action["approvedBy"] == "tester@example.com"
    assert actions_by_name[ACTION_UPDATE_INVENTORY_POLICIES]["oldBaseline"] is None

    baseline = (await session.execute(
        select(DemandBaseline).where(DemandBaseline.sku_code == "SKU-APPLY")
    )).scalar_one()
    assert float(baseline.baseline_rmse_d) == erp_action["newBaseline"]

    logs = (await session.execute(
        select(FillRateActionLog).where(FillRateActionLog.sku_code == "SKU-APPLY")
    )).scalars().all()
    assert {log.action_taken for log in logs} == {ACTION_UPDATE_ERP_PARAMETERS, ACTION_UPDATE_INVENTORY_POLICIES}


async def test_apply_recommendation_non_erp_action_only_logs_no_mutation(session):
    session.add(_order("ORD-NOMUT-0", "SKU-NOMUT", 4, 100))
    await session.flush()
    session.add(GoodsSent(order_id="ORD-NOMUT-0", shipped_qty=0))
    po = PurchaseOrder(po_number="PO-NOMUT", sku_code="SKU-NOMUT", node_code="NODE-L4", supplier_code="SUP-L4",
                        order_date=date(2023, 12, 20), ordered_qty=100, expected_date=date(2024, 1, 3))
    session.add(po)
    await session.flush()
    session.add(GoodsReceipt(purchase_order_id=po.id, received_qty=100, receipt_date=date(2024, 1, 6)))
    await session.commit()

    result = await apply_recommendation(session, "SKU-NOMUT", FROM, TO, approved_by="tester@example.com")

    assert result["primaryCause"] == "Supply Side"
    assert {a["actionTaken"] for a in result["actions"]} == {ACTION_EXPEDITE_PO, ACTION_RAISE_STO}
    assert all(a["oldBaseline"] is None and a["newBaseline"] is None for a in result["actions"])

    logs = (await session.execute(
        select(FillRateActionLog).where(FillRateActionLog.sku_code == "SKU-NOMUT")
    )).scalars().all()
    assert all(log.old_baseline is None and log.new_baseline is None for log in logs)


async def test_apply_accepts_partial_action_list(session):
    """A "Mixed" sku recommends 4 actions - approving just 1 must log only that
    one, leave the DemandBaseline untouched (since ERP Parameters wasn't in the
    approved subset), and reject an action that isn't part of the real
    recommendation list."""
    qtys = [100, 100, 100, 100, 500, 100, 100]
    for i, qty in enumerate(qtys):
        session.add(_order(f"ORD-PARTIAL-{i}", "SKU-PARTIAL", i, qty))
    await session.flush()
    for i, qty in enumerate(qtys):
        shipped = 400 if i == 4 else qty
        session.add(GoodsSent(order_id=f"ORD-PARTIAL-{i}", shipped_qty=shipped))
    po = PurchaseOrder(po_number="PO-PARTIAL", sku_code="SKU-PARTIAL", node_code="NODE-L4", supplier_code="SUP-L4",
                        order_date=date(2023, 12, 20), ordered_qty=100, expected_date=date(2024, 1, 3))
    session.add(po)
    await session.flush()
    session.add(GoodsReceipt(purchase_order_id=po.id, received_qty=100, receipt_date=date(2024, 1, 6)))
    await session.commit()

    rca = await run_rca(session, "SKU-PARTIAL", FROM, TO)
    assert rca["primaryCause"] == "Mixed"

    result = await apply_recommendation(
        session, "SKU-PARTIAL", FROM, TO, approved_by="tester@example.com", actions=[ACTION_EXPEDITE_PO],
    )
    assert len(result["actions"]) == 1
    assert result["actions"][0]["actionTaken"] == ACTION_EXPEDITE_PO

    logs = (await session.execute(
        select(FillRateActionLog).where(FillRateActionLog.sku_code == "SKU-PARTIAL")
    )).scalars().all()
    assert len(logs) == 1
    assert logs[0].action_taken == ACTION_EXPEDITE_PO

    with pytest.raises(InvalidActionError):
        await apply_recommendation(
            session, "SKU-PARTIAL", FROM, TO, approved_by="tester@example.com", actions=["Not A Real Action"],
        )


# ── Part D: Measurement ───────────────────────────────────────────────────────

async def test_compare_periods_computes_before_after_delta(session):
    before_days = [date(2024, 1, d) for d in range(1, 4)]
    after_days = [date(2024, 2, d) for d in range(1, 4)]
    for i, d in enumerate(before_days):
        session.add(SalesOrder(order_id=f"ORD-BEFORE-{i}", order_date=d, day="D", sku_code="SKU-MEAS",
                                sku_name="SKU-MEAS", node="NODE-L4", requested_qty=100))
    for i, d in enumerate(after_days):
        session.add(SalesOrder(order_id=f"ORD-AFTER-{i}", order_date=d, day="D", sku_code="SKU-MEAS",
                                sku_name="SKU-MEAS", node="NODE-L4", requested_qty=100))
    await session.flush()
    for i in range(3):
        session.add(GoodsSent(order_id=f"ORD-BEFORE-{i}", shipped_qty=50))  # 0% fill before
        session.add(GoodsSent(order_id=f"ORD-AFTER-{i}", shipped_qty=100))  # 100% fill after
    await session.commit()

    result = await compare_periods(
        session, "SKU-MEAS", before_days[0], before_days[-1], after_days[0], after_days[-1],
    )
    assert result["beforeFillRate"] == 0.0
    assert result["afterFillRate"] == 1.0
    assert result["delta"] == 1.0
    assert result["improved"] is True
