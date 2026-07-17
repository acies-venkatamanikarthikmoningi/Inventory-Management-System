from datetime import date, timedelta
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models import Batch, DemandObservation, InventoryPosition, Lane, LeadTimeObservation, SkuCostProfile
from app.services.policy_service import refresh_policy
from tests.conftest import seed_bin, seed_node, seed_sku

SKU = "SKU-OPT-API"
NODE_X = "NODE-API-X"
NODE_Y = "NODE-API-Y"


async def _seed(session):
    as_of = date.today()
    await seed_sku(session, SKU, description="Optimization API Test SKU")
    await seed_node(session, NODE_X)
    await seed_node(session, NODE_Y)
    await seed_bin(session, area_code="AREA-API-X", zone_code="ZONE-API-X", bin_code="BIN-API-X", face="RESERVE", pallet_capacity=5)
    await seed_bin(session, area_code="AREA-API-Y", zone_code="ZONE-API-Y", bin_code="BIN-API-Y", face="RESERVE", pallet_capacity=1000)

    session.add(Batch(batch_number="B-API-X", sku_code=SKU, node_code=NODE_X, mfg_date=as_of - timedelta(days=10),
                       expiry_date=as_of + timedelta(days=300), shelf_life_months=12, total_qty=30))
    session.add(Batch(batch_number="B-API-Y", sku_code=SKU, node_code=NODE_Y, mfg_date=as_of - timedelta(days=10),
                       expiry_date=as_of + timedelta(days=300), shelf_life_months=12, total_qty=3000))
    await session.flush()

    session.add(InventoryPosition(source_id="POS-API-X", sku_code=SKU, node_code=NODE_X, bin_code="BIN-API-X",
                                   batch_code="B-API-X", on_hand=30, available=30, inventory_position=30,
                                   expiry_date=as_of + timedelta(days=300)))
    session.add(InventoryPosition(source_id="POS-API-Y", sku_code=SKU, node_code=NODE_Y, bin_code="BIN-API-Y",
                                   batch_code="B-API-Y", on_hand=3000, available=3000, inventory_position=3000,
                                   expiry_date=as_of + timedelta(days=300)))

    for i in range(56):
        day = as_of - timedelta(days=55 - i)
        session.add(DemandObservation(sku_code=SKU, node_code=NODE_X, observed_date=day, forecast_qty=40, actual_qty=40))
        session.add(DemandObservation(sku_code=SKU, node_code=NODE_Y, observed_date=day, forecast_qty=40, actual_qty=40))
    for i in range(12):
        order_date = as_of - timedelta(days=5 * i)
        session.add(LeadTimeObservation(sku_code=SKU, node_code=NODE_X, order_date=order_date,
                                         promised_lead_time_days=2, actual_lead_time_days=2, ordered_qty=500, received_qty=500))
        session.add(LeadTimeObservation(sku_code=SKU, node_code=NODE_Y, order_date=order_date,
                                         promised_lead_time_days=2, actual_lead_time_days=2, ordered_qty=500, received_qty=500))

    session.add(SkuCostProfile(sku_code=SKU, unit_cost=10, holding_cost_pct=0.2, ordering_cost=100,
                                shortage_penalty_per_unit=15, expiry_penalty_per_unit=10, moq_units=40))
    session.add(Lane(source_node_code=NODE_Y, dest_node_code=NODE_X, transit_days=1, cost_per_unit=2))
    await session.commit()

    await refresh_policy(session, None, None, computed_at=as_of, as_of=as_of)


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

    app.dependency_overrides[get_session] = override_get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client
    app.dependency_overrides.clear()
    await engine.dispose()


async def test_run_then_recommendations_reference_real_data(client):
    run_response = await client.post("/api/v1/optimization/run", json={
        "skuCodes": [SKU], "nodeCodes": [NODE_X, NODE_Y], "horizonDays": 8,
    })

    assert run_response.status_code == 200
    run_body = run_response.json()
    assert run_body["solverStatus"] in ("optimal", "feasible")
    assert run_body["objectiveValue"] is not None
    assert run_body["skuCodes"] == [SKU]
    assert set(run_body["nodeCodes"]) == {NODE_X, NODE_Y}
    assert len(run_body["scenarioSet"]) == 4

    rec_response = await client.get("/api/v1/optimization/recommendations", params={"runId": run_body["runId"]})
    assert rec_response.status_code == 200
    rec_body = rec_response.json()
    assert rec_body["runId"] == run_body["runId"]
    for item in rec_body["items"]:
        assert item["skuCode"] == SKU
        assert item["nodeCode"] in (NODE_X, NODE_Y)
        assert item["recommendationType"] in ("REPLENISH", "TRANSFER")
        assert item["quantity"] > 0


async def test_recommendations_without_run_id_uses_latest_run(client):
    first = await client.post("/api/v1/optimization/run", json={"skuCodes": [SKU], "nodeCodes": [NODE_X, NODE_Y]})
    assert first.status_code == 200

    latest = await client.get("/api/v1/optimization/recommendations")
    assert latest.status_code == 200
    assert latest.json()["runId"] == first.json()["runId"]
