from datetime import date
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.fill_rate.db import Base
import app.fill_rate.models  # noqa: F401  register table metadata on fill_rate's own Base
from app.fill_rate.models import GoodsReceipt, GoodsSent, PurchaseOrder, SalesOrder
from app.fill_rate.service import list_purchase_orders, supplier_fill_rate_summary


@pytest_asyncio.fixture
async def session():
    # In-memory sqlite standing in for fill_rate_db in unit tests - a real Postgres
    # database is exercised separately in the docker-compose live verification, but
    # the point of this fixture is that it never touches app.db.base.Base at all.
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db_session:
        yield db_session
    await engine.dispose()


async def test_fill_rate_base_metadata_is_isolated_from_main_app_base():
    from app.db.base import Base as MainBase
    fill_rate_tables = set(Base.metadata.tables.keys())
    main_tables = set(MainBase.metadata.tables.keys())
    assert fill_rate_tables == {
        "sales_orders", "goods_sent", "purchase_orders", "goods_receipts", "inventory_snapshots",
        "demand_forecasts", "lead_time_baselines", "demand_baselines", "fill_rate_action_logs",
    }
    assert fill_rate_tables.isdisjoint(main_tables)


async def test_supplier_fill_rate_summary_aggregates_by_sku_node_supplier(session):
    po = PurchaseOrder(po_number="PO-1", sku_code="SKU-2", node_code="NODE-2",
                        supplier_code="SUP-1", order_date=date(2026, 1, 1), ordered_qty=200)
    session.add(po)
    await session.flush()
    session.add(GoodsReceipt(purchase_order_id=po.id, received_qty=180, receipt_date=date(2026, 1, 10)))
    await session.commit()

    items = await list_purchase_orders(session)
    assert items[0]["receivedQty"] == 180

    summary = await supplier_fill_rate_summary(session)
    assert len(summary) == 1
    row = summary[0]
    assert row["supplierCode"] == "SUP-1"
    assert row["orderedQty"] == 200
    assert row["receivedQty"] == 180
    assert row["fillRatePct"] == 90.0


async def test_goods_sent_references_sales_order_by_order_id(session):
    """Sanity check that the new L1 schema wires up as designed - GoodsSent.order_id
    is a plain string FK against SalesOrder.order_id (a unique business key), not a
    UUID FK against SalesOrder.id, matching the real Order ID values in both source
    files (e.g. "ORD-1001")."""
    session.add(SalesOrder(order_id="ORD-1001", order_date=date(2026, 6, 1), day="Mon",
                            sku_code="SKU-2001", sku_name="Amul Butter 500g",
                            node="Chennai Distribution Center", requested_qty=947))
    await session.flush()
    session.add(GoodsSent(order_id="ORD-1001", shipped_qty=947))
    await session.commit()
