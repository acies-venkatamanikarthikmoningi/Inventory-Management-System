from datetime import date
from app.models import Batch, InventoryPosition
from app.services.exceptions_service import transfer_candidates
from tests.conftest import seed_bin, seed_node, seed_sku

AS_OF = date(2026, 6, 1)


async def test_recommends_reserve_to_pick_transfer_for_near_expiry_batch(session):
    await seed_sku(session, "SKU-T1")
    await seed_node(session, "NODE-1")
    await seed_bin(session, area_code="AREA-RS", zone_code="ZONE-RS", bin_code="BIN-RS", face="RESERVE")
    await seed_bin(session, area_code="AREA-PK", zone_code="ZONE-PK", bin_code="BIN-PK", face="PICK")

    session.add(Batch(batch_number="B-NE", sku_code="SKU-T1", node_code="NODE-1", mfg_date=date(2025, 1, 1), expiry_date=date(2026, 6, 21), shelf_life_months=18, total_qty=40))
    await session.flush()
    session.add_all([
        InventoryPosition(source_id="POS-RS", sku_code="SKU-T1", node_code="NODE-1", bin_code="BIN-RS", batch_code="B-NE", on_hand=40, available=40, inventory_position=40, expiry_date=date(2026, 6, 21)),
        InventoryPosition(source_id="POS-PK", sku_code="SKU-T1", node_code="NODE-1", bin_code="BIN-PK", batch_code="B-NE", on_hand=5, available=5, inventory_position=5, expiry_date=date(2026, 6, 21)),
    ])
    await session.commit()

    candidates = await transfer_candidates(session, as_of=AS_OF)

    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["fromBin"] == "BIN-RS"
    assert candidate["toBin"] == "BIN-PK"
    assert candidate["suggestedQty"] == 40.0


async def test_no_candidate_without_a_pick_face_destination(session):
    await seed_sku(session, "SKU-T2")
    await seed_node(session, "NODE-1")
    await seed_bin(session, area_code="AREA-RS", zone_code="ZONE-RS", bin_code="BIN-RS", face="RESERVE")

    session.add(Batch(batch_number="B-NE2", sku_code="SKU-T2", node_code="NODE-1", mfg_date=date(2025, 1, 1), expiry_date=date(2026, 6, 21), shelf_life_months=18, total_qty=40))
    await session.flush()
    session.add(InventoryPosition(source_id="POS-RS2", sku_code="SKU-T2", node_code="NODE-1", bin_code="BIN-RS", batch_code="B-NE2", on_hand=40, available=40, inventory_position=40, expiry_date=date(2026, 6, 21)))
    await session.commit()

    candidates = await transfer_candidates(session, as_of=AS_OF)

    assert candidates == []


async def test_no_candidate_for_already_expired_batch(session):
    await seed_sku(session, "SKU-T3")
    await seed_node(session, "NODE-1")
    await seed_bin(session, area_code="AREA-RS", zone_code="ZONE-RS", bin_code="BIN-RS", face="RESERVE")
    await seed_bin(session, area_code="AREA-PK", zone_code="ZONE-PK", bin_code="BIN-PK", face="PICK")

    session.add(Batch(batch_number="B-EXP", sku_code="SKU-T3", node_code="NODE-1", mfg_date=date(2024, 1, 1), expiry_date=date(2026, 1, 1), shelf_life_months=24, total_qty=40))
    await session.flush()
    session.add_all([
        InventoryPosition(source_id="POS-RS3", sku_code="SKU-T3", node_code="NODE-1", bin_code="BIN-RS", batch_code="B-EXP", on_hand=40, available=40, inventory_position=40, expiry_date=date(2026, 1, 1)),
        InventoryPosition(source_id="POS-PK3", sku_code="SKU-T3", node_code="NODE-1", bin_code="BIN-PK", batch_code="B-EXP", on_hand=5, available=5, inventory_position=5, expiry_date=date(2026, 1, 1)),
    ])
    await session.commit()

    candidates = await transfer_candidates(session, as_of=AS_OF)

    assert candidates == []
