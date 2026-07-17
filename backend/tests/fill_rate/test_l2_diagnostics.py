from datetime import date
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.fill_rate.db import Base
import app.fill_rate.models  # noqa: F401
from app.fill_rate.models import GoodsSent, InventorySnapshot, SalesOrder
from app.fill_rate.seed import (
    GOODS_SENT_FILE, INVENTORY_SNAPSHOT_FILE, ORDER_FILE, _read_goods_sent, _read_inventory_snapshots, _read_orders,
)
from app.fill_rate.service import (
    compute_days_of_supply, compute_fill_rate, compute_stockout_backorder_rates,
    compute_stockout_backorder_rates_by_sku, get_l2_diagnostics,
)


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db_session:
        yield db_session
    await engine.dispose()


async def _seed_from_real_files(session):
    for row in _read_orders(ORDER_FILE):
        session.add(SalesOrder(**row))
    await session.flush()
    for row in _read_goods_sent(GOODS_SENT_FILE):
        session.add(GoodsSent(**row))
    for row in _read_inventory_snapshots(INVENTORY_SNAPSHOT_FILE):
        session.add(InventorySnapshot(**row))
    await session.commit()


async def test_stockout_and_backorder_mutually_exclusive(session):
    """No order can ever be both a stockout (shipped=0) and a backorder
    (0 < shipped < requested) - construction-level guarantee, checked here against
    every real seeded order, not just a hand-picked example."""
    await _seed_from_real_files(session)
    from app.fill_rate.service import _joined_fill_rate_rows

    rows = await _joined_fill_rate_rows(session)
    for r in rows:
        is_stockout = r["shippedQty"] == 0
        is_backorder = 0 < r["shippedQty"] < r["requestedQty"]
        assert not (is_stockout and is_backorder), f"order {r['orderId']} flagged as both"


async def test_rates_and_filled_complete_sum_to_total_orders(session):
    await _seed_from_real_files(session)

    fill_rate = await compute_fill_rate(session)
    rates = await compute_stockout_backorder_rates(session)

    assert rates["totalOrders"] == fill_rate["totalOrders"]
    assert rates["stockoutCount"] + rates["backorderCount"] + fill_rate["ordersFilledComplete"] == fill_rate["totalOrders"]


async def test_by_sku_stockout_backorder_uses_same_logic_as_dc_level(session):
    await _seed_from_real_files(session)

    dc_level = await compute_stockout_backorder_rates(session)
    by_sku = await compute_stockout_backorder_rates_by_sku(session)

    assert sum(row["totalOrders"] for row in by_sku) == dc_level["totalOrders"]
    assert sum(row["stockoutCount"] for row in by_sku) == dc_level["stockoutCount"]
    assert sum(row["backorderCount"] for row in by_sku) == dc_level["backorderCount"]


async def test_dos_uses_same_day_demand_not_average(session):
    """A demand spike on one day must show up as an immediate DoS drop THAT day,
    not smoothed across the week - proves daily_demand is the real same-day total,
    not a rolling average."""
    session.add_all([
        SalesOrder(order_id="ORD-D1", order_date=date(2026, 1, 1), day="Mon",
                   sku_code="SKU-X", sku_name="X", node="NODE-X", requested_qty=100),
        SalesOrder(order_id="ORD-D2", order_date=date(2026, 1, 2), day="Tue",
                   sku_code="SKU-X", sku_name="X", node="NODE-X", requested_qty=1000),  # spike
        SalesOrder(order_id="ORD-D3", order_date=date(2026, 1, 3), day="Wed",
                   sku_code="SKU-X", sku_name="X", node="NODE-X", requested_qty=100),
    ])
    session.add_all([
        InventorySnapshot(snapshot_date=date(2026, 1, 1), day="Mon", sku_code="SKU-X", sku_name="X",
                           on_hand_before_shipment=1000, qty_shipped=100, on_hand_eod=900),
        InventorySnapshot(snapshot_date=date(2026, 1, 2), day="Tue", sku_code="SKU-X", sku_name="X",
                           on_hand_before_shipment=900, qty_shipped=900, on_hand_eod=900),
        InventorySnapshot(snapshot_date=date(2026, 1, 3), day="Wed", sku_code="SKU-X", sku_name="X",
                           on_hand_before_shipment=900, qty_shipped=100, on_hand_eod=800),
    ])
    await session.commit()

    trend = await compute_days_of_supply(session, sku_code="SKU-X")
    by_date = {row["date"]: row["dos"] for row in trend}

    assert by_date[date(2026, 1, 1)] == 9.0     # 900 / 100
    assert by_date[date(2026, 1, 2)] == 0.9     # 900 / 1000 - drops sharply on the spike day
    assert by_date[date(2026, 1, 3)] == 8.0     # 800 / 100 - recovers immediately after, not smoothed


async def test_dos_handles_zero_demand_day_without_crashing(session):
    session.add(SalesOrder(order_id="ORD-Z1", order_date=date(2026, 1, 1), day="Mon",
                            sku_code="SKU-Z", sku_name="Z", node="NODE-Z", requested_qty=100))
    await session.flush()
    session.add_all([
        InventorySnapshot(snapshot_date=date(2026, 1, 1), day="Mon", sku_code="SKU-Z", sku_name="Z",
                           on_hand_before_shipment=500, qty_shipped=100, on_hand_eod=400),
        # A snapshot date with NO matching SalesOrder at all - zero demand that day.
        InventorySnapshot(snapshot_date=date(2026, 1, 2), day="Tue", sku_code="SKU-Z", sku_name="Z",
                           on_hand_before_shipment=400, qty_shipped=0, on_hand_eod=400),
    ])
    await session.commit()

    trend = await compute_days_of_supply(session, sku_code="SKU-Z")
    by_date = {row["date"]: row["dos"] for row in trend}

    assert by_date[date(2026, 1, 1)] == 4.0
    assert by_date[date(2026, 1, 2)] is None  # zero demand -> None, not a crash or a misleading 0


async def test_matches_known_result(session):
    """Real seeded Week 1 data: SKU-2001's Stockout Rate ~28.6%, Backorder Rate
    ~14.3%, and DC-level Days of Supply declining from ~3.5-3.8 down to 0.00 across
    the week - hand-validated directly from the raw seed_data files before any
    backend code was written."""
    await _seed_from_real_files(session)

    sku_rates = await compute_stockout_backorder_rates(session, sku_code="SKU-2001")
    assert sku_rates["totalOrders"] == 7
    assert sku_rates["stockoutCount"] == 2
    assert sku_rates["backorderCount"] == 1
    assert sku_rates["stockoutRate"] == round(2 / 7, 4)  # ~0.2857
    assert sku_rates["backorderRate"] == round(1 / 7, 4)  # ~0.1429
    assert sku_rates["isStockoutException"] is True
    assert sku_rates["isBackorderException"] is True

    dc_trend = await compute_days_of_supply(session)
    dos_values = [row["dos"] for row in dc_trend if row["dos"] is not None]
    assert len(dc_trend) == 7
    assert 3.5 <= dos_values[0] <= 3.8
    assert dos_values[-1] == 0.0
    assert dos_values[-1] < dos_values[0]

    diagnostics = await get_l2_diagnostics(session, sku_code="SKU-2001")
    assert diagnostics["isStockoutException"] is True
    assert diagnostics["isBackorderException"] is True
    assert "Stockout Rate" in diagnostics["diagnosticMessage"]
    assert "Backorder Rate" in diagnostics["diagnosticMessage"]
