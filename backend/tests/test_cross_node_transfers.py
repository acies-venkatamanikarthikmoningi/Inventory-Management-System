from datetime import date, timedelta
from app.models import Batch, DemandObservation, InventoryPosition, Lane, LeadTimeObservation, SkuCostProfile
from app.services.exceptions_service import cross_node_transfer_candidates, transfer_candidates
from app.services.policy_service import refresh_policy
from tests.conftest import seed_bin, seed_node, seed_sku

SKU = "SKU-XNODE"
NODE_A = "NODE-A"
NODE_B = "NODE-B"


async def _seed_demand_and_lead_time(session, node_code, as_of):
    for i in range(56):
        day = as_of - timedelta(days=55 - i)
        session.add(DemandObservation(sku_code=SKU, node_code=node_code, observed_date=day, forecast_qty=100, actual_qty=100))
    for i in range(12):
        order_date = as_of - timedelta(days=5 * i)
        session.add(LeadTimeObservation(sku_code=SKU, node_code=node_code, order_date=order_date,
                                         promised_lead_time_days=5, actual_lead_time_days=5, ordered_qty=700, received_qty=700))


async def _seed_two_node_scenario(session, as_of, with_lane: bool):
    await seed_sku(session, SKU, description="Cross Node Test SKU")
    await seed_node(session, NODE_A)
    await seed_node(session, NODE_B)
    await seed_bin(session, area_code="AREA-A", zone_code="ZONE-A", bin_code="BIN-A", face="RESERVE", pallet_capacity=1000)
    await seed_bin(session, area_code="AREA-B", zone_code="ZONE-B", bin_code="BIN-B", face="RESERVE", pallet_capacity=1000)

    session.add(Batch(batch_number="B-A", sku_code=SKU, node_code=NODE_A, mfg_date=as_of - timedelta(days=10),
                       expiry_date=as_of + timedelta(days=300), shelf_life_months=12, total_qty=100))
    session.add(Batch(batch_number="B-B", sku_code=SKU, node_code=NODE_B, mfg_date=as_of - timedelta(days=10),
                       expiry_date=as_of + timedelta(days=300), shelf_life_months=12, total_qty=5000))
    await session.flush()

    # NODE_A: shortage (low on-hand). NODE_B: surplus (high on-hand). Same demand
    # pattern at both nodes so their computed ROP is the same - the imbalance is
    # purely from on-hand quantity, exactly the condition Phase 4 needs to solve.
    session.add(InventoryPosition(source_id="POS-A", sku_code=SKU, node_code=NODE_A, bin_code="BIN-A", batch_code="B-A",
                                   on_hand=50, available=50, inventory_position=50, expiry_date=as_of + timedelta(days=300)))
    session.add(InventoryPosition(source_id="POS-B", sku_code=SKU, node_code=NODE_B, bin_code="BIN-B", batch_code="B-B",
                                   on_hand=5000, available=5000, inventory_position=5000, expiry_date=as_of + timedelta(days=300)))

    await _seed_demand_and_lead_time(session, NODE_A, as_of)
    await _seed_demand_and_lead_time(session, NODE_B, as_of)
    session.add(SkuCostProfile(sku_code=SKU, unit_cost=50, holding_cost_pct=0.2, ordering_cost=500))
    if with_lane:
        session.add(Lane(source_node_code=NODE_B, dest_node_code=NODE_A, transit_days=1, cost_per_unit=5))
    await session.commit()

    await refresh_policy(session, None, None, computed_at=as_of, as_of=as_of)


async def test_cross_node_candidate_moves_surplus_to_shortage_node(session):
    as_of = date(2026, 6, 1)
    await _seed_two_node_scenario(session, as_of, with_lane=True)

    candidates = await cross_node_transfer_candidates(session, as_of=as_of)

    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["fromNode"] == NODE_B
    assert candidate["toNode"] == NODE_A
    assert candidate["suggestedQty"] > 0

    combined = await transfer_candidates(session, as_of=as_of)
    assert any(c.get("toNode") == NODE_A for c in combined)


async def test_no_cross_node_candidate_without_a_lane(session):
    as_of = date(2026, 6, 1)
    await _seed_two_node_scenario(session, as_of, with_lane=False)

    candidates = await cross_node_transfer_candidates(session, as_of=as_of)

    assert candidates == []
