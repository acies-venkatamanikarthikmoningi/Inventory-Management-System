from datetime import date
from app.models import Batch, InventoryPosition
from app.services.exceptions_service import detect_exceptions
from tests.conftest import seed_bin, seed_node, seed_sku

AS_OF = date(2026, 6, 1)


async def _seed_position(session, *, source_id, sku_code, node_code, bin_code, batch_number, expiry_date, mfg_date, status="Healthy", with_batch=True):
    if with_batch:
        session.add(Batch(batch_number=batch_number, sku_code=sku_code, node_code=node_code, mfg_date=mfg_date, expiry_date=expiry_date, shelf_life_months=12, total_qty=10))
        await session.flush()
    session.add(InventoryPosition(source_id=source_id, sku_code=sku_code, node_code=node_code, bin_code=bin_code, batch_code=batch_number, on_hand=10, available=10, inventory_position=10, status=status, expiry_date=expiry_date))
    await session.flush()


async def test_detects_expired_position(session):
    await seed_sku(session, "SKU-EXP")
    await seed_node(session, "NODE-1")
    await seed_bin(session, area_code="AREA-1", zone_code="ZONE-1", bin_code="BIN-1")
    await _seed_position(session, source_id="POS-1", sku_code="SKU-EXP", node_code="NODE-1", bin_code="BIN-1",
                          batch_number="B-EXP", mfg_date=date(2025, 1, 1), expiry_date=date(2026, 1, 1))
    await session.commit()

    exceptions = await detect_exceptions(session, as_of=AS_OF)

    types = {e["exceptionType"] for e in exceptions}
    assert "EXPIRED" in types
    expired = next(e for e in exceptions if e["exceptionType"] == "EXPIRED")
    assert expired["severity"] == "Critical"
    assert expired["daysRemaining"] < 0


async def test_detects_near_expiry_within_window(session):
    await seed_sku(session, "SKU-NE")
    await seed_node(session, "NODE-1")
    await seed_bin(session, area_code="AREA-1", zone_code="ZONE-1", bin_code="BIN-1")
    # 20 days out from AS_OF: inside the 90-day window and the <=30-day Critical band.
    await _seed_position(session, source_id="POS-2", sku_code="SKU-NE", node_code="NODE-1", bin_code="BIN-1",
                          batch_number="B-NE", mfg_date=date(2025, 1, 1), expiry_date=date(2026, 6, 21))
    await session.commit()

    exceptions = await detect_exceptions(session, as_of=AS_OF)

    near_expiry = [e for e in exceptions if e["exceptionType"] == "NEAR_EXPIRY"]
    assert len(near_expiry) == 1
    assert near_expiry[0]["severity"] == "Critical"
    assert near_expiry[0]["daysRemaining"] == 20


async def test_no_exceptions_for_healthy_far_dated_batch(session):
    await seed_sku(session, "SKU-OK")
    await seed_node(session, "NODE-1")
    await seed_bin(session, area_code="AREA-1", zone_code="ZONE-1", bin_code="BIN-1")
    await _seed_position(session, source_id="POS-3", sku_code="SKU-OK", node_code="NODE-1", bin_code="BIN-1",
                          batch_number="B-OK", mfg_date=date(2026, 1, 1), expiry_date=date(2028, 1, 1))
    await session.commit()

    exceptions = await detect_exceptions(session, as_of=AS_OF)

    assert exceptions == []


async def test_detects_backorder_risk_from_critical_status(session):
    await seed_sku(session, "SKU-CRIT")
    await seed_node(session, "NODE-1")
    await seed_bin(session, area_code="AREA-1", zone_code="ZONE-1", bin_code="BIN-1")
    await _seed_position(session, source_id="POS-4", sku_code="SKU-CRIT", node_code="NODE-1", bin_code="BIN-1",
                          batch_number="B-CRIT", mfg_date=date(2026, 1, 1), expiry_date=date(2028, 1, 1), status="Critical")
    await session.commit()

    exceptions = await detect_exceptions(session, as_of=AS_OF)

    assert any(e["exceptionType"] == "BACKORDER_RISK" for e in exceptions)


async def test_detects_shelf_life_infeasible_before_near_expiry_window(session):
    await seed_sku(session, "SKU-SLI")
    await seed_node(session, "NODE-1")
    await seed_bin(session, area_code="AREA-1", zone_code="ZONE-1", bin_code="BIN-1")
    # 365-day life; at AS_OF only ~120 days (33%) remain: below the 60% floor but outside the 90-day near-expiry window.
    await _seed_position(session, source_id="POS-5", sku_code="SKU-SLI", node_code="NODE-1", bin_code="BIN-1",
                          batch_number="B-SLI", mfg_date=date(2025, 6, 2), expiry_date=date(2026, 10, 1))
    await session.commit()

    exceptions = await detect_exceptions(session, as_of=AS_OF)

    types = {e["exceptionType"] for e in exceptions}
    assert "SHELF_LIFE_INFEASIBLE" in types
    assert "NEAR_EXPIRY" not in types
