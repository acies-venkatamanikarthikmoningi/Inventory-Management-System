from datetime import date, timedelta
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models import Batch, DemandObservation, InventoryPosition, LeadTimeObservation, SkuCostProfile
from tests.conftest import seed_bin, seed_node, seed_sku

SKU_CODE = "SKU-POLICY"
NODE_CODE = "NODE-POLICY"


async def _seed_full_policy_scenario(session):
    # The /policy endpoints always compute against the real wall-clock "today" (no as_of
    # override), so seeded history must bracket date.today(), not a hardcoded calendar date.
    as_of = date.today()

    await seed_sku(session, SKU_CODE, description="Policy Test SKU")
    await seed_node(session, NODE_CODE)
    # Generous pallet capacity so this "normal" scenario isn't warehouse-capacity-capped;
    # that cap is exercised deliberately in test_policy_formulas.py instead.
    await seed_bin(session, area_code="AREA-P", zone_code="ZONE-P", bin_code="BIN-P", face="RESERVE", pallet_capacity=1000)

    session.add(Batch(batch_number="B-POLICY", sku_code=SKU_CODE, node_code=NODE_CODE,
                       mfg_date=as_of - timedelta(days=30), expiry_date=as_of + timedelta(days=60),
                       shelf_life_months=3, total_qty=1000))
    await session.flush()
    session.add(InventoryPosition(source_id="POS-POLICY", sku_code=SKU_CODE, node_code=NODE_CODE, bin_code="BIN-P",
                                   batch_code="B-POLICY", on_hand=500, available=500, inventory_position=500,
                                   expiry_date=as_of + timedelta(days=60)))

    for i in range(56):
        day = as_of - timedelta(days=55 - i)  # spans as_of-55 .. as_of, all within the 56-day trailing window
        actual = 100 + (10 if i % 2 == 0 else -10)
        session.add(DemandObservation(sku_code=SKU_CODE, node_code=NODE_CODE, observed_date=day, forecast_qty=100, actual_qty=actual))

    for i in range(12):
        order_date = as_of - timedelta(days=5 * i)
        session.add(LeadTimeObservation(sku_code=SKU_CODE, node_code=NODE_CODE, order_date=order_date,
                                         promised_lead_time_days=5, actual_lead_time_days=6 if i % 2 == 0 else 4,
                                         ordered_qty=700, received_qty=630))

    session.add(SkuCostProfile(sku_code=SKU_CODE, unit_cost=100, holding_cost_pct=0.2, ordering_cost=500))
    await session.commit()


@pytest_asyncio.fixture
async def client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with factory() as seed_session:
        await _seed_full_policy_scenario(seed_session)

    async def override_get_session():
        async with factory() as db_session:
            yield db_session

    app.dependency_overrides[get_session] = override_get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client
    app.dependency_overrides.clear()
    await engine.dispose()


async def test_refresh_computes_real_non_placeholder_policy_values(client):
    response = await client.post("/api/v1/policy/refresh", params={"sku": SKU_CODE, "node": NODE_CODE})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["skuCode"] == SKU_CODE
    assert item["node"] == NODE_CODE
    assert item["addRolling"] == pytest.approx(100, rel=0.01)
    assert item["rmseD"] == pytest.approx(10, rel=0.05)
    assert item["lActual"] == 5
    assert item["fillRate"] == pytest.approx(0.9, rel=0.01)
    assert item["safetyStock"] > 0
    assert item["enhancedRop"] > 0
    assert item["finalMax"] > 0
    assert item["finalMax"] >= item["enhancedRop"]


async def test_refresh_all_computes_every_sku_node_pair(client):
    response = await client.post("/api/v1/policy/refresh")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert any(item["skuCode"] == SKU_CODE for item in body["items"])


async def test_drift_endpoint_returns_ss_rop_max_after_two_refreshes(client):
    first = await client.post("/api/v1/policy/refresh", params={"sku": SKU_CODE, "node": NODE_CODE})
    assert first.status_code == 200
    second = await client.post("/api/v1/policy/refresh", params={"sku": SKU_CODE, "node": NODE_CODE})
    assert second.status_code == 200

    response = await client.get("/api/v1/policy/drift")

    assert response.status_code == 200
    body = response.json()
    items = [item for item in body["items"] if item["skuCode"] == SKU_CODE]
    metrics = {item["metric"] for item in items}
    assert metrics == {"Safety Stock", "Reorder Point", "Maximum Stock Level"}
    for item in items:
        assert "evidence" in item and len(item["evidence"]) == 4
        assert item["explanation"]
        assert len(item["impact"]) >= 1


async def test_drift_endpoint_empty_shape_before_any_refresh(client):
    response = await client.get("/api/v1/policy/drift")

    assert response.status_code == 200
    body = response.json()
    assert body == {"items": [], "total": 0}


async def test_recommendations_get_is_empty_before_any_refresh(client):
    """GET /policy/recommendations is a cheap READ ONLY - it must never
    silently compute (that pass runs real Monte Carlo simulations - see
    policy_recommendation_service module docstring), so before the explicit
    POST /policy/recommendations/refresh has ever run, it's honestly empty."""
    response = await client.get("/api/v1/policy/recommendations", params={"sku": SKU_CODE, "node": NODE_CODE})
    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0}


async def test_recommendations_refresh_then_get_returns_real_policy_types_and_reasoning(client):
    await client.post("/api/v1/policy/refresh", params={"sku": SKU_CODE, "node": NODE_CODE})

    refresh_response = await client.post("/api/v1/policy/recommendations/refresh", params={"sku": SKU_CODE, "node": NODE_CODE})
    assert refresh_response.status_code == 200
    refresh_body = refresh_response.json()
    assert refresh_body["total"] == 1
    assert refresh_body["totalSimulations"] >= 1
    assert refresh_body["durationSeconds"] >= 0
    assert sum(refresh_body["tierCounts"].values()) == 1

    response = await client.get("/api/v1/policy/recommendations", params={"sku": SKU_CODE, "node": NODE_CODE})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["skuCode"] == SKU_CODE
    assert item["currentPolicyType"] == "s_S"
    assert item["governanceAction"] in (
        "no_change_needed", "suggest_pending_approval", "no_better_alternative_found", "auto_changed",
    )
    assert len(item["currentParams"]) >= 2
    assert len(item["reasoning"]) > 20  # a real sentence, not empty/placeholder
    if item["suggestedPolicyType"] is None:
        assert item["suggestedCompositeScore"] is None
    else:
        assert item["suggestedPolicyType"] != item["currentPolicyType"]
        assert len(item["suggestedParams"]) >= 2
        assert item["suggestedCompositeScore"] is not None


async def test_recommendations_refresh_upserts_on_repeated_calls(client):
    await client.post("/api/v1/policy/refresh", params={"sku": SKU_CODE, "node": NODE_CODE})

    first = await client.post("/api/v1/policy/recommendations/refresh", params={"sku": SKU_CODE, "node": NODE_CODE})
    second = await client.post("/api/v1/policy/recommendations/refresh", params={"sku": SKU_CODE, "node": NODE_CODE})

    assert first.json()["total"] == 1
    assert second.json()["total"] == 1  # not accumulating a new row per refresh

    read = await client.get("/api/v1/policy/recommendations", params={"sku": SKU_CODE, "node": NODE_CODE})
    assert read.json()["total"] == 1


async def test_audit_log_empty_before_any_change(client):
    response = await client.get("/api/v1/policy/audit-log")

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0}


async def test_approve_change_applies_policy_and_appears_in_audit_log(client):
    await client.post("/api/v1/policy/refresh", params={"sku": SKU_CODE, "node": NODE_CODE})
    await client.post("/api/v1/policy/recommendations/refresh", params={"sku": SKU_CODE, "node": NODE_CODE})
    rec_response = await client.get("/api/v1/policy/recommendations", params={"sku": SKU_CODE, "node": NODE_CODE})
    rec = rec_response.json()["items"][0]

    response = await client.post("/api/v1/policy/approve-change", json={
        "skuCode": SKU_CODE, "nodeCode": NODE_CODE, "approvedBy": "fathina.iffat", "robustnessScore": 65.0,
    })

    assert response.status_code == 200
    body = response.json()
    if rec["suggestedPolicyType"] is None or rec["currentPolicyType"] == rec["suggestedPolicyType"]:
        assert body["applied"] is False
        return

    assert body["applied"] is True
    assert body["audit"]["changedBy"] == "fathina.iffat"
    assert body["audit"]["oldPolicyType"] == rec["currentPolicyType"]
    assert body["audit"]["newPolicyType"] == rec["suggestedPolicyType"]
    assert body["audit"]["robustnessScoreAtChange"] == 65.0

    audit_log = await client.get("/api/v1/policy/audit-log", params={"sku": SKU_CODE, "node": NODE_CODE})
    assert audit_log.json()["total"] == 1
    assert audit_log.json()["items"][0]["changedBy"] == "fathina.iffat"

    # The policy actually changed (PolicySnapshot now carries the new type) -
    # a fresh POST /recommendations/refresh re-derives from that live state
    # and shows the NEW type as current. (The GET-only read stays stale until
    # the next refresh - a known, documented interaction, not a bug.)
    await client.post("/api/v1/policy/recommendations/refresh", params={"sku": SKU_CODE, "node": NODE_CODE})
    after = await client.get("/api/v1/policy/recommendations", params={"sku": SKU_CODE, "node": NODE_CODE})
    assert after.json()["items"][0]["currentPolicyType"] == rec["suggestedPolicyType"]
