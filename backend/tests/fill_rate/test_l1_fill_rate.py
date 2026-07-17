from datetime import date
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.fill_rate.db import Base
import app.fill_rate.models  # noqa: F401
from app.fill_rate.models import GoodsSent, SalesOrder
from app.fill_rate.seed import GOODS_SENT_FILE, ORDER_FILE, _read_goods_sent, _read_orders
from app.fill_rate.service import compute_fill_rate, compute_fill_rate_by_sku


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
    """Loads the REAL seed_data/Order_File_Week1.xlsx + Goods_Sent_Register.xlsx
    through the actual seed-parsing helpers (not a synthetic fixture), so this test
    exercises the real file contents this module ships with."""
    for row in _read_orders(ORDER_FILE):
        session.add(SalesOrder(**row))
    await session.flush()
    for row in _read_goods_sent(GOODS_SENT_FILE):
        session.add(GoodsSent(**row))
    await session.commit()


async def test_fill_rate_matches_known_result(session):
    await _seed_from_real_files(session)

    result = await compute_fill_rate(session)

    assert result["totalOrders"] == 42
    assert result["ordersFilledComplete"] == 24
    assert result["fillRate"] == round(24 / 42, 4)  # 0.5714 - the hand-validated ~57.1%
    assert result["isException"] is True


async def test_left_join_counts_unshipped_orders_as_stockout(session):
    """A SalesOrder with NO matching GoodsSent row at all must still be counted -
    as a genuine stockout (filled_complete=0) - not excluded from total_orders.
    Proves the join is a LEFT JOIN from SalesOrder, not an INNER JOIN."""
    session.add(SalesOrder(order_id="ORD-9001", order_date=date(2026, 1, 1), day="Mon",
                            sku_code="SKU-X", sku_name="Test SKU", node="NODE-X", requested_qty=100))
    await session.commit()

    result = await compute_fill_rate(session, node="NODE-X")

    assert result["totalOrders"] == 1
    assert result["ordersFilledComplete"] == 0
    assert result["fillRate"] == 0.0
    assert result["isException"] is True


async def test_by_sku_uses_same_logic_as_node_level(session):
    """Sum of by-SKU order counts (and filled-complete counts) must equal the
    node-level totals - proves compute_fill_rate_by_sku shares the same join/flag
    logic as compute_fill_rate rather than a separately maintained calculation."""
    session.add_all([
        SalesOrder(order_id="ORD-A1", order_date=date(2026, 1, 1), day="Mon",
                   sku_code="SKU-A", sku_name="A", node="NODE-Y", requested_qty=100),
        SalesOrder(order_id="ORD-A2", order_date=date(2026, 1, 2), day="Tue",
                   sku_code="SKU-A", sku_name="A", node="NODE-Y", requested_qty=50),
        SalesOrder(order_id="ORD-B1", order_date=date(2026, 1, 3), day="Wed",
                   sku_code="SKU-B", sku_name="B", node="NODE-Y", requested_qty=80),
    ])
    await session.flush()
    session.add_all([
        GoodsSent(order_id="ORD-A1", shipped_qty=100),  # filled complete
        GoodsSent(order_id="ORD-A2", shipped_qty=10),   # stockout
        # ORD-B1 has no GoodsSent row at all - a stockout via LEFT JOIN
    ])
    await session.commit()

    node_level = await compute_fill_rate(session, node="NODE-Y")
    by_sku = await compute_fill_rate_by_sku(session, node="NODE-Y")

    assert sum(row["totalOrders"] for row in by_sku) == node_level["totalOrders"] == 3
    assert sum(row["ordersFilledComplete"] for row in by_sku) == node_level["ordersFilledComplete"] == 1
