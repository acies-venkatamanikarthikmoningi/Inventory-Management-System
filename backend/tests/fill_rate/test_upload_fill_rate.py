from io import BytesIO
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from openpyxl import Workbook
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.fill_rate.db import Base, get_session
import app.fill_rate.models  # noqa: F401
from app.main import app


def _xlsx_bytes(headers, rows):
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest_asyncio.fixture
async def client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_session():
        async with factory() as db_session:
            yield db_session

    app.dependency_overrides[get_session] = override_get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client
    app.dependency_overrides.clear()
    await engine.dispose()


async def test_upload_missing_required_column_returns_400(client):
    content = _xlsx_bytes(["po_number", "sku_code"], [["PO-1", "SKU-1"]])
    response = await client.post(
        "/api/v1/fill-rate/upload/purchase-orders",
        files={"file": ("bad.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert response.status_code == 400
    assert "Missing required column" in response.json()["detail"]


async def test_upload_non_xlsx_file_rejected(client):
    response = await client.post(
        "/api/v1/fill-rate/upload/purchase-orders",
        files={"file": ("data.csv", b"po_number,sku_code\nPO-1,SKU-1", "text/csv")},
    )
    assert response.status_code == 400
    assert "xlsx" in response.json()["detail"].lower()


async def test_upload_purchase_orders_and_goods_receipts_roundtrip(client):
    po_content = _xlsx_bytes(
        ["po_number", "sku_code", "node_code", "supplier_code", "order_date", "ordered_qty"],
        [["PO-1", "SKU-3", "NODE-3", "SUP-1", "2026-01-01", 200]],
    )
    po_resp = await client.post(
        "/api/v1/fill-rate/upload/purchase-orders",
        files={"file": ("po.xlsx", po_content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert po_resp.json() == {"inserted": 1, "updated": 0, "skipped": 0, "errors": []}

    gr_content = _xlsx_bytes(["po_number", "received_qty", "receipt_date"], [["PO-1", 180, "2026-01-10"]])
    gr_resp = await client.post(
        "/api/v1/fill-rate/upload/goods-receipts",
        files={"file": ("gr.xlsx", gr_content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert gr_resp.json() == {"inserted": 1, "updated": 0, "skipped": 0, "errors": []}

    summary = await client.get("/api/v1/fill-rate/supplier-summary")
    assert summary.json()["items"][0]["fillRatePct"] == 90.0
