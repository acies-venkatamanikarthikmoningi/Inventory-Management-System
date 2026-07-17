from datetime import date
from app.models import Batch
from app.services.exceptions_service import shelf_life_feasible


def _batch(mfg, expiry):
    return Batch(batch_number="B", sku_code="SKU", node_code="NODE", mfg_date=mfg, expiry_date=expiry, shelf_life_months=12, total_qty=0)


def test_feasible_when_well_above_min_fraction():
    # 365-day life, evaluated on day 1: ~100% remaining, comfortably above the 60% floor.
    batch = _batch(date(2026, 1, 1), date(2027, 1, 1))
    assert shelf_life_feasible(batch, date(2026, 1, 2)) is True


def test_infeasible_once_below_min_fraction():
    # 365-day life; day 300 leaves ~65 days (~18%) remaining, below the 60% floor.
    batch = _batch(date(2026, 1, 1), date(2027, 1, 1))
    assert shelf_life_feasible(batch, date(2026, 10, 28)) is False


def test_boundary_at_exactly_min_fraction():
    # 100-day life; at day 40, exactly 60 days (60%) remain.
    batch = _batch(date(2026, 1, 1), date(2026, 4, 11))
    assert shelf_life_feasible(batch, date(2026, 2, 10)) is True


def test_zero_length_shelf_life_is_never_feasible():
    batch = _batch(date(2026, 1, 1), date(2026, 1, 1))
    assert shelf_life_feasible(batch, date(2026, 1, 1)) is False
