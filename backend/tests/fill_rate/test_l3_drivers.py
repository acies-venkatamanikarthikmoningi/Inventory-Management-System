from datetime import date, datetime
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
import app.fill_rate.service as service
from app.fill_rate.db import Base
import app.fill_rate.models  # noqa: F401
from app.fill_rate.models import (
    DemandForecast, GoodsReceipt, GoodsSent, LeadTimeBaseline, PurchaseOrder, SalesOrder,
)
from app.fill_rate.seed import (
    DEMAND_FORECAST_FILE, GOODS_RECEIPT_FILE, GOODS_SENT_FILE, ORDER_FILE, PURCHASE_ORDER_FILE,
    _read_demand_forecast, _read_goods_receipts, _read_goods_sent, _read_orders, _read_purchase_orders,
)

WEEK1_FROM, WEEK1_TO = date(2026, 6, 1), date(2026, 6, 7)
WEEK2_FROM, WEEK2_TO = date(2026, 6, 8), date(2026, 6, 14)


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db_session:
        yield db_session
    await engine.dispose()


def _sales_order(order_id, sku_code, order_date, qty, node="NODE-L3"):
    return SalesOrder(order_id=order_id, order_date=order_date, day="Mon", sku_code=sku_code,
                       sku_name=sku_code, node=node, requested_qty=qty)


def _demand_forecast(sku_code, week1=1000, week2=1000, week3=1000, week4=1000):
    return DemandForecast(sku_code=sku_code, sku_name=sku_code, node="NODE-L3",
                           week1_forecast=week1, week2_forecast=week2, week3_forecast=week3, week4_forecast=week4)


async def _seed_po_receipt(session, sku_code, po_number, order_date, expected_date, receipt_date, qty=100):
    po = PurchaseOrder(po_number=po_number, sku_code=sku_code, node_code="NODE-L3", supplier_code="SUP-L3",
                        order_date=order_date, ordered_qty=qty, expected_date=expected_date)
    session.add(po)
    await session.flush()
    session.add(GoodsReceipt(purchase_order_id=po.id, received_qty=qty, receipt_date=receipt_date))
    await session.commit()
    return po


async def _seed_from_real_files(session):
    for row in _read_orders(ORDER_FILE):
        session.add(SalesOrder(**row))
    await session.flush()
    for row in _read_goods_sent(GOODS_SENT_FILE):
        session.add(GoodsSent(**row))
    po_by_number = {}
    for row in _read_purchase_orders(PURCHASE_ORDER_FILE):
        po = PurchaseOrder(**row)
        session.add(po)
        await session.flush()
        po_by_number[row["po_number"]] = po
    for row in _read_goods_receipts(GOODS_RECEIPT_FILE):
        po = po_by_number[row["po_number"]]
        session.add(GoodsReceipt(purchase_order_id=po.id, received_qty=row["received_qty"], receipt_date=row["receipt_date"]))
    for row in _read_demand_forecast(DEMAND_FORECAST_FILE):
        session.add(DemandForecast(**row))
    await session.commit()


# ── Driver 1: Forecast Accuracy ──────────────────────────────────────────────

async def test_forecast_accuracy_penalizes_both_over_and_under_forecast(session):
    session.add(_demand_forecast("SKU-OVER", week1=100))
    session.add(_demand_forecast("SKU-UNDER", week1=100))
    session.add(_sales_order("ORD-OVER-1", "SKU-OVER", date(2026, 6, 1), 120))
    session.add(_sales_order("ORD-UNDER-1", "SKU-UNDER", date(2026, 6, 1), 80))
    await session.commit()

    over = await service.compute_forecast_accuracy(session, "SKU-OVER", WEEK1_FROM, WEEK1_TO)
    under = await service.compute_forecast_accuracy(session, "SKU-UNDER", WEEK1_FROM, WEEK1_TO)

    assert over["status"] == under["status"] == "ok"
    assert over["accuracy"] == under["accuracy"] == 0.8


async def test_forecast_accuracy_uses_correct_week_column(session):
    session.add(_demand_forecast("SKU-WK", week1=999, week2=200))
    session.add(_sales_order("ORD-WK-1", "SKU-WK", date(2026, 6, 9), 200))
    await session.commit()

    result = await service.compute_forecast_accuracy(session, "SKU-WK", WEEK2_FROM, WEEK2_TO)
    assert result["status"] == "ok"
    assert result["forecastedDemand"] == 200
    assert result["accuracy"] == 1.0


async def test_forecast_accuracy_insufficient_data_when_no_sku_row_or_bad_range(session):
    session.add(_demand_forecast("SKU-BADRANGE", week1=100))
    await session.commit()

    no_forecast_row = await service.compute_forecast_accuracy(session, "SKU-NONE", WEEK1_FROM, WEEK1_TO)
    assert no_forecast_row["status"] == "insufficient_data"

    bad_range = await service.compute_forecast_accuracy(
        session, "SKU-BADRANGE", date(2026, 6, 2), date(2026, 6, 5),
    )
    assert bad_range["status"] == "insufficient_data"


# ── Driver 2: Demand Variability ─────────────────────────────────────────────

async def test_demand_variability_cv_threshold(session):
    session.add_all([
        _sales_order("ORD-LOW-1", "SKU-LOWCV", date(2026, 6, 1), 100),
        _sales_order("ORD-LOW-2", "SKU-LOWCV", date(2026, 6, 2), 100),
        _sales_order("ORD-HIGH-1", "SKU-HIGHCV", date(2026, 6, 1), 10),
        _sales_order("ORD-HIGH-2", "SKU-HIGHCV", date(2026, 6, 2), 100),
    ])
    await session.commit()

    low = await service.compute_demand_variability(session, "SKU-LOWCV")
    high = await service.compute_demand_variability(session, "SKU-HIGHCV")

    assert low["status"] == high["status"] == "ok"
    assert low["cv"] == 0.0
    assert low["flag"] is False
    assert high["cv"] > 0.5
    assert high["flag"] is True


# ── Driver 3: Supplier OTD ────────────────────────────────────────────────────

async def test_supplier_otd_uses_expected_date_not_promised_delivery_date(session):
    await _seed_po_receipt(session, "SKU-OTD", "PO-OTD-1", date(2026, 6, 1), date(2026, 6, 10), date(2026, 6, 9))
    await _seed_po_receipt(session, "SKU-OTD", "PO-OTD-2", date(2026, 6, 1), date(2026, 6, 10), date(2026, 6, 15))

    result = await service.compute_supplier_otd(session, "SKU-OTD")
    assert result["status"] == "ok"
    assert result["poCount"] == 2
    assert result["otdPct"] == 0.5
    assert result["flag"] is True


async def test_supplier_otd_insufficient_data_when_no_po_cycle(session):
    session.add(PurchaseOrder(po_number="PO-NOPO", sku_code="SKU-NOPO", node_code="NODE-L3",
                               supplier_code="SUP-L3", order_date=date(2026, 6, 1), ordered_qty=100,
                               expected_date=date(2026, 6, 10)))
    await session.commit()

    result = await service.compute_supplier_otd(session, "SKU-NOPO")
    assert result["status"] == "insufficient_data"


# ── Driver 4: Lead-Time Variability ──────────────────────────────────────────

async def test_lead_time_first_run_establishes_baseline_no_flag(session):
    await _seed_po_receipt(session, "SKU-LT1", "PO-LT1", date(2026, 6, 1), date(2026, 6, 10), date(2026, 6, 12))

    result = await service.compute_lead_time_variability(session, "SKU-LT1", WEEK1_FROM, WEEK1_TO)
    assert result["status"] == "baseline_established"
    assert result["flag"] is False
    assert result["driftPct"] is None

    from sqlalchemy import select
    baseline = (await session.execute(
        select(LeadTimeBaseline).where(LeadTimeBaseline.sku_code == "SKU-LT1")
    )).scalar_one()
    assert float(baseline.baseline_rmse_lt) == result["rmseLt"]


async def test_lead_time_second_run_flags_on_real_drift(session):
    session.add(LeadTimeBaseline(sku_code="SKU-LT2", baseline_rmse_lt=2.0, computed_at=datetime(2026, 1, 1)))
    session.add(LeadTimeBaseline(sku_code="SKU-LT3", baseline_rmse_lt=2.0, computed_at=datetime(2026, 1, 1)))
    await session.commit()

    # SKU-LT2: actual lead time deviates from promised by 3 days on both POs -> rmse=3.0, drift=(3-2)/2=50% -> flag
    await _seed_po_receipt(session, "SKU-LT2", "PO-LT2-1", date(2026, 6, 1), date(2026, 6, 10), date(2026, 6, 13))
    await _seed_po_receipt(session, "SKU-LT2", "PO-LT2-2", date(2026, 6, 2), date(2026, 6, 11), date(2026, 6, 14))

    # SKU-LT3: deviates by 2 days on both POs -> rmse=2.0, drift=0% -> no flag
    await _seed_po_receipt(session, "SKU-LT3", "PO-LT3-1", date(2026, 6, 1), date(2026, 6, 10), date(2026, 6, 12))
    await _seed_po_receipt(session, "SKU-LT3", "PO-LT3-2", date(2026, 6, 2), date(2026, 6, 11), date(2026, 6, 13))

    drifted = await service.compute_lead_time_variability(session, "SKU-LT2", WEEK1_FROM, WEEK1_TO)
    steady = await service.compute_lead_time_variability(session, "SKU-LT3", WEEK1_FROM, WEEK1_TO)

    assert drifted["status"] == steady["status"] == "ok"
    assert drifted["rmseLt"] == 3.0
    assert drifted["driftPct"] == 0.5
    assert drifted["flag"] is True

    assert steady["rmseLt"] == 2.0
    assert steady["driftPct"] == 0.0
    assert steady["flag"] is False


# ── Driver 5: Replenishment Parameter Age ────────────────────────────────────

async def test_parameter_age_reuses_same_drift_helper_as_lead_time(session, monkeypatch):
    calls = []
    original = service.compute_drift_flag

    def spy(fresh_value, baseline_value, threshold=service.DRIVER_DRIFT_BENCHMARK):
        calls.append((fresh_value, baseline_value, threshold))
        return original(fresh_value, baseline_value, threshold)

    monkeypatch.setattr(service, "compute_drift_flag", spy)

    session.add(LeadTimeBaseline(sku_code="SKU-SPY", baseline_rmse_lt=2.0, computed_at=datetime(2026, 1, 1)))
    from app.fill_rate.models import DemandBaseline
    session.add(DemandBaseline(sku_code="SKU-SPY", baseline_rmse_d=10.0, computed_at=datetime(2026, 1, 1)))
    session.add(_demand_forecast("SKU-SPY", week1=700))
    for i, qty in enumerate([100] * 7, start=1):
        session.add(_sales_order(f"ORD-SPY-{i}", "SKU-SPY", date(2026, 6, i), qty))
    await session.flush()
    await _seed_po_receipt(session, "SKU-SPY", "PO-SPY-1", date(2026, 6, 1), date(2026, 6, 10), date(2026, 6, 13))

    await service.compute_lead_time_variability(session, "SKU-SPY", WEEK1_FROM, WEEK1_TO)
    await service.compute_replenishment_parameter_age(session, "SKU-SPY", WEEK1_FROM, WEEK1_TO)

    assert len(calls) == 2


# ── Part F: Combined screening ────────────────────────────────────────────────

async def test_screen_all_drivers_covers_every_sku_in_period(session):
    await _seed_from_real_files(session)

    results = await service.screen_all_drivers(session, WEEK1_FROM, WEEK1_TO)

    assert len(results) == 6
    assert {row["skuCode"] for row in results} == {f"SKU-200{i}" for i in range(1, 7)}
    for row in results:
        assert set(row) == {
            "skuCode", "skuName", "forecastAccuracy", "demandVariability", "supplierOtd",
            "leadTimeVariability", "parameterAge",
        }


# ── Part G: goods receipt parser regression ──────────────────────────────────

def test_goods_receipt_parser_maps_old_column_names_correctly():
    rows = _read_goods_receipts(GOODS_RECEIPT_FILE)
    assert rows[0] == {"po_number": "PO-8001", "receipt_date": date(2026, 5, 28), "received_qty": 6000}
    assert "grn_reference" not in rows[0]
    assert len(rows) == 6
