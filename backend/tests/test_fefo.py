from datetime import date
from app.models import Batch, InventoryPosition
from app.services.exceptions_service import fefo_order
from tests.conftest import seed_bin, seed_node, seed_sku


async def test_fefo_orders_earliest_expiry_first(session):
    await seed_sku(session, "SKU-T1")
    await seed_node(session, "NODE-T1")
    await seed_bin(session, area_code="AREA-T1", zone_code="ZONE-T1", bin_code="BIN-T1")

    session.add_all([
        Batch(batch_number="B-LATE", sku_code="SKU-T1", node_code="NODE-T1", mfg_date=date(2025, 1, 1), expiry_date=date(2027, 1, 1), shelf_life_months=24, total_qty=100),
        Batch(batch_number="B-EARLY", sku_code="SKU-T1", node_code="NODE-T1", mfg_date=date(2025, 1, 1), expiry_date=date(2026, 1, 1), shelf_life_months=12, total_qty=50),
    ])
    await session.flush()

    session.add_all([
        InventoryPosition(source_id="POS-LATE", sku_code="SKU-T1", node_code="NODE-T1", bin_code="BIN-T1", batch_code="B-LATE", on_hand=100, available=100, inventory_position=100, expiry_date=date(2027, 1, 1)),
        InventoryPosition(source_id="POS-EARLY", sku_code="SKU-T1", node_code="NODE-T1", bin_code="BIN-T1", batch_code="B-EARLY", on_hand=50, available=50, inventory_position=50, expiry_date=date(2026, 1, 1)),
    ])
    await session.commit()

    ordered = await fefo_order(session, "SKU-T1")

    assert [batch.batch_number for _position, batch in ordered] == ["B-EARLY", "B-LATE"]


async def test_fefo_scopes_to_requested_node(session):
    await seed_sku(session, "SKU-T2")
    await seed_node(session, "NODE-A")
    await seed_node(session, "NODE-B")
    await seed_bin(session, area_code="AREA-A", zone_code="ZONE-A", bin_code="BIN-A")
    await seed_bin(session, area_code="AREA-B", zone_code="ZONE-B", bin_code="BIN-B")

    session.add_all([
        Batch(batch_number="B-A", sku_code="SKU-T2", node_code="NODE-A", mfg_date=date(2025, 1, 1), expiry_date=date(2026, 6, 1), shelf_life_months=12, total_qty=10),
        Batch(batch_number="B-B", sku_code="SKU-T2", node_code="NODE-B", mfg_date=date(2025, 1, 1), expiry_date=date(2026, 1, 1), shelf_life_months=12, total_qty=10),
    ])
    await session.flush()
    session.add_all([
        InventoryPosition(source_id="POS-A", sku_code="SKU-T2", node_code="NODE-A", bin_code="BIN-A", batch_code="B-A", on_hand=10, available=10, inventory_position=10, expiry_date=date(2026, 6, 1)),
        InventoryPosition(source_id="POS-B", sku_code="SKU-T2", node_code="NODE-B", bin_code="BIN-B", batch_code="B-B", on_hand=10, available=10, inventory_position=10, expiry_date=date(2026, 1, 1)),
    ])
    await session.commit()

    ordered = await fefo_order(session, "SKU-T2", node_code="NODE-A")

    assert [batch.batch_number for _position, batch in ordered] == ["B-A"]
