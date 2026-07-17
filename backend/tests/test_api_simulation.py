from datetime import date, timedelta
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models import Batch, DemandObservation, InventoryPosition, LeadTimeObservation, SkuCostProfile
from app.services.policy_service import refresh_policy
from tests.conftest import seed_bin, seed_node, seed_sku

SKU = "SKU-SIM-API"
NODE = "NODE-SIM-API"


async def _seed(session):
    as_of = date.today()
    await seed_sku(session, SKU, description="Simulation API Test SKU")
    await seed_node(session, NODE)
    await seed_bin(session, area_code="AREA-SIM-API", zone_code="ZONE-SIM-API", bin_code="BIN-SIM-API", face="RESERVE", pallet_capacity=1000)
    session.add(Batch(batch_number="B-SIM-API", sku_code=SKU, node_code=NODE, mfg_date=as_of - timedelta(days=10),
                       expiry_date=as_of + timedelta(days=300), shelf_life_months=12, total_qty=500))
    await session.flush()
    session.add(InventoryPosition(source_id="POS-SIM-API", sku_code=SKU, node_code=NODE, bin_code="BIN-SIM-API",
                                   batch_code="B-SIM-API", on_hand=300, available=300, inventory_position=300,
                                   expiry_date=as_of + timedelta(days=300)))
    for i in range(56):
        day = as_of - timedelta(days=55 - i)
        session.add(DemandObservation(sku_code=SKU, node_code=NODE, observed_date=day, forecast_qty=50, actual_qty=50))
    for i in range(12):
        order_date = as_of - timedelta(days=5 * i)
        session.add(LeadTimeObservation(sku_code=SKU, node_code=NODE, order_date=order_date,
                                         promised_lead_time_days=4, actual_lead_time_days=4, ordered_qty=300, received_qty=300))
    session.add(SkuCostProfile(sku_code=SKU, unit_cost=20, holding_cost_pct=0.2, ordering_cost=100,
                                shortage_penalty_per_unit=30, expiry_penalty_per_unit=20, moq_units=20))
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


async def test_run_then_results_reference_real_data(client):
    run_response = await client.post("/api/v1/simulation/run", json={
        "skuCodes": [SKU], "nodeCodes": [NODE], "nRuns": 50, "horizonDays": 30,
    })

    assert run_response.status_code == 200
    run_body = run_response.json()
    assert run_body["status"] == "completed"
    assert run_body["skuCodes"] == [SKU]
    assert run_body["nodeCodes"] == [NODE]

    results_response = await client.get("/api/v1/simulation/results", params={"runId": run_body["runId"]})
    assert results_response.status_code == 200
    results_body = results_response.json()
    assert results_body["runId"] == run_body["runId"]
    # "suggested" only exists when the simulator found a genuinely-better
    # alternative (Phase 6.1) - a well-behaved SKU whose current policy
    # already scores >=80 legitimately has no suggested row, so total is 1 or 2.
    assert results_body["total"] in (1, 2)
    roles = {item["policyRole"] for item in results_body["items"]}
    assert roles <= {"current", "suggested"}
    assert "current" in roles
    for item in results_body["items"]:
        assert item["skuCode"] == SKU
        assert item["nodeCode"] == NODE
        assert 0.0 <= item["serviceLevelAchieved"] <= 1.0
        assert item["policyType"] in ("s_S", "s_Q", "R_S", "R_s_S", "base_stock")
        assert isinstance(item["policyParams"], dict) and len(item["policyParams"]) >= 2
        assert 0.0 <= item["compositeScore"] <= 100.0
        if item["policyRole"] == "current":
            assert item["governanceAction"] in (
                "no_change_needed", "suggest_pending_approval", "no_better_alternative_found", "auto_changed",
            )
        else:
            assert item["governanceAction"] is None


async def test_default_seed_reproduces_identical_results_across_two_calls(client):
    """Compares by the actual (policyType, policyParams) combo simulated in
    each call, not by policyRole - if the first call's governance auto-applies
    a change (composite score < 40), the second call's "current" role
    legitimately refers to a different policy than the first call's did. The
    "suggested" combo is always shared (deterministic from classification/
    volatility/cost, independent of governance), so at least one match is
    guaranteed."""
    first = await client.post("/api/v1/simulation/run", json={"skuCodes": [SKU], "nodeCodes": [NODE], "nRuns": 50})
    second = await client.post("/api/v1/simulation/run", json={"skuCodes": [SKU], "nodeCodes": [NODE], "nRuns": 50})
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["seed"] == second.json()["seed"]  # both used the default fixed seed

    first_results = (await client.get("/api/v1/simulation/results", params={"runId": first.json()["runId"]})).json()
    second_results = (await client.get("/api/v1/simulation/results", params={"runId": second.json()["runId"]})).json()

    def key_and_metrics(items):
        out = {}
        for i in items:
            key = (i["policyType"], tuple(sorted(i["policyParams"].items())))
            out[key] = (i["serviceLevelAchieved"], i["avgEndingInventory"], i["totalHoldingCost"],
                        i["totalShortageCost"], i["p95ShortageQty"], i["compositeScore"])
        return out

    first_by_key = key_and_metrics(first_results["items"])
    second_by_key = key_and_metrics(second_results["items"])
    shared_keys = set(first_by_key) & set(second_by_key)
    assert shared_keys, "expected at least one identical (policyType, policyParams) combo across both calls"
    for key in shared_keys:
        assert first_by_key[key] == second_by_key[key]
