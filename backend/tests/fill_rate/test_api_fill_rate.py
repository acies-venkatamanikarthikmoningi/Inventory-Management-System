from datetime import date
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.fill_rate.db import Base, get_session
import app.fill_rate.models  # noqa: F401
from app.fill_rate.models import GoodsReceipt, GoodsSent, InventorySnapshot, PurchaseOrder, SalesOrder
from app.main import app


async def _seed(session):
    session.add(SalesOrder(order_id="ORD-API-1", order_date=date(2026, 1, 1), day="Mon",
                            sku_code="SKU-API", sku_name="API Test SKU",
                            node="NODE-API", requested_qty=100))
    await session.flush()
    session.add(GoodsSent(order_id="ORD-API-1", shipped_qty=75))
    session.add(InventorySnapshot(snapshot_date=date(2026, 1, 1), day="Mon", sku_code="SKU-API",
                                   sku_name="API Test SKU", on_hand_before_shipment=200,
                                   qty_shipped=75, on_hand_eod=125))

    po = PurchaseOrder(po_number="PO-API-1", sku_code="SKU-API", node_code="NODE-API",
                        supplier_code="SUP-API", order_date=date(2026, 1, 1), ordered_qty=200)
    session.add(po)
    await session.flush()
    session.add(GoodsReceipt(purchase_order_id=po.id, received_qty=200, receipt_date=date(2026, 1, 8)))
    await session.commit()


@pytest_asyncio.fixture
async def client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with factory() as seed_session:
        await _seed(seed_session)

    async def override_get_session():
        async with factory() as db_session:
            yield db_session

    # Overrides fill_rate's OWN get_session dependency only - proves the route
    # wiring uses app.fill_rate.db.get_session, not app.db.session.get_session.
    app.dependency_overrides[get_session] = override_get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client
    app.dependency_overrides.clear()
    await engine.dispose()


async def test_ready_endpoint_hits_fill_rate_db(client):
    response = await client.get("/api/v1/fill-rate/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


async def test_fill_rate_summary_endpoint_computes_from_sales_order_and_goods_sent(client):
    response = await client.get("/api/v1/fill-rate/summary", params={"node": "NODE-API"})
    assert response.status_code == 200
    body = response.json()
    assert body["totalOrders"] == 1
    assert body["ordersFilledComplete"] == 0  # 75 shipped < 100 requested
    assert body["fillRate"] == 0.0
    assert body["isException"] is True


async def test_fill_rate_by_sku_endpoint(client):
    response = await client.get("/api/v1/fill-rate/summary/by-sku", params={"node": "NODE-API"})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["skuCode"] == "SKU-API"
    assert body["items"][0]["totalOrders"] == 1


async def test_diagnostics_endpoint_computes_stockout_backorder_and_dos(client):
    response = await client.get("/api/v1/fill-rate/diagnostics", params={"sku_code": "SKU-API"})
    assert response.status_code == 200
    body = response.json()
    assert body["backorderRate"] == 1.0  # 75 shipped, 0 < 75 < 100 -> the one order is a backorder
    assert body["isBackorderException"] is True
    assert body["stockoutRate"] == 0.0
    assert len(body["dosTrend"]) == 1
    assert body["dosTrend"][0]["dos"] == 1.25  # 125 on-hand EOD / 100 demand
    assert "Backorder Rate" in body["diagnosticMessage"]


async def test_diagnostics_by_sku_endpoint(client):
    response = await client.get("/api/v1/fill-rate/diagnostics/by-sku", params={"node": "NODE-API"})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["skuCode"] == "SKU-API"
    assert body["items"][0]["isBackorderException"] is True


async def test_purchase_orders_endpoint_returns_seeded_order_with_received_qty(client):
    response = await client.get("/api/v1/fill-rate/purchase-orders")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["poNumber"] == "PO-API-1"
    assert body["items"][0]["receivedQty"] == 200


async def test_supplier_fill_rate_summary_endpoint(client):
    response = await client.get("/api/v1/fill-rate/supplier-summary")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["fillRatePct"] == 100.0


async def test_triage_endpoint_flags_sku_api_as_responsible(client):
    response = await client.get("/api/v1/fill-rate/triage")
    assert response.status_code == 200
    body = response.json()
    row = next(item for item in body["items"] if item["skuCode"] == "SKU-API")
    assert row["status"] == "responsible"
    assert "supplier_otd" in row["flaggedDrivers"]


async def test_rca_endpoint_returns_400_for_a_sku_not_present_in_the_period(client):
    response = await client.get(
        "/api/v1/fill-rate/rca/SKU-NONE", params={"date_from": "2026-01-01", "date_to": "2026-01-31"},
    )
    assert response.status_code == 400


async def test_rca_endpoint_returns_200_for_the_responsible_sku(client):
    # SKU-API's only flagged driver is supplier_otd (its PurchaseOrder has no
    # expected_date, so it's flagged but never causal) - still real, actionable
    # evidence under the corrected recommendation logic, so this lands on
    # "Supply Side", not "Unresolved".
    response = await client.get(
        "/api/v1/fill-rate/rca/SKU-API", params={"date_from": "2025-01-01", "date_to": "2027-01-01"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["skuCode"] == "SKU-API"
    assert body["primaryCause"] == "Supply Side"
    assert set(body["recommendation"]) == {"Expedite PO", "Raise STO"}


async def test_apply_recommendation_endpoint_logs_supply_side_actions(client):
    response = await client.post(
        "/api/v1/fill-rate/rca/SKU-API/apply",
        json={"date_from": "2025-01-01", "date_to": "2027-01-01", "approved_by": "tester@example.com"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["primaryCause"] == "Supply Side"
    assert {a["actionTaken"] for a in body["actions"]} == {"Expedite PO", "Raise STO"}
    assert all(a["oldBaseline"] is None for a in body["actions"])


async def test_measurement_endpoint_compares_two_periods(client):
    response = await client.get(
        "/api/v1/fill-rate/measurement/SKU-API",
        params={
            "before_from": "2025-01-01", "before_to": "2027-01-01",
            "after_from": "2025-01-01", "after_to": "2027-01-01",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["delta"] == 0.0
    assert body["improved"] is False
