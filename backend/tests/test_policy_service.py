from datetime import datetime
import pytest
from app.models import PolicySnapshot
from app.services.policy_service import apply_policy_type_change, initial_policy_type_for_classification, policy_drift
from tests.conftest import seed_node, seed_sku


def _snapshot(sku_code, node_code, computed_at, safety_stock, enhanced_rop, final_max, **overrides):
    values = dict(
        sku_code=sku_code, node_code=node_code, computed_at=computed_at,
        review_period_days=7, service_level=0.95, z_score=1.65,
        add_rolling=100, rmse_d=10, l_actual=5, rmse_lt=1, fill_rate=0.9,
        safety_stock=safety_stock,
        base_rop=enhanced_rop, total_shelf_life_days=90, min_shelf_life_required_days=54,
        max_holdable_stock=99999, enhanced_rop=enhanced_rop,
        eoq=500, raw_max=final_max, warehouse_capacity_qty=99999,
        shelf_life_capacity_qty=99999, final_max=final_max,
    )
    values.update(overrides)
    return PolicySnapshot(**values)


async def test_policy_drift_computes_delta_between_two_snapshots(session):
    await seed_sku(session, "SKU-DRIFT", description="Drift Test SKU")
    await seed_node(session, "NODE-1")
    older = _snapshot("SKU-DRIFT", "NODE-1", datetime(2026, 1, 1), safety_stock=1000, enhanced_rop=5000, final_max=9000)
    newer = _snapshot("SKU-DRIFT", "NODE-1", datetime(2026, 1, 8), safety_stock=1500, enhanced_rop=5000, final_max=6000)
    session.add_all([older, newer])
    await session.commit()

    items = await policy_drift(session)

    by_metric = {item["metric"]: item for item in items}
    assert by_metric["Safety Stock"]["previousValue"] == 1000
    assert by_metric["Safety Stock"]["currentValue"] == 1500
    assert by_metric["Safety Stock"]["driftPct"] == 50
    assert by_metric["Safety Stock"]["driftDirection"] == "up"

    assert by_metric["Reorder Point"]["driftPct"] == 0
    assert by_metric["Reorder Point"]["driftDirection"] == "up"  # 0% drift defaults to "up" (non-negative)

    assert by_metric["Maximum Stock Level"]["previousValue"] == 9000
    assert by_metric["Maximum Stock Level"]["currentValue"] == 6000
    assert by_metric["Maximum Stock Level"]["driftDirection"] == "down"
    assert by_metric["Maximum Stock Level"]["driftPct"] == pytest.approx(-33.333, rel=1e-3)


async def test_policy_drift_skips_pairs_with_only_one_snapshot(session):
    await seed_sku(session, "SKU-ONE")
    await seed_node(session, "NODE-1")
    session.add(_snapshot("SKU-ONE", "NODE-1", datetime(2026, 1, 1), safety_stock=1000, enhanced_rop=5000, final_max=9000))
    await session.commit()

    items = await policy_drift(session)

    assert all(item["skuCode"] != "SKU-ONE" for item in items)


async def test_policy_drift_uses_most_recent_two_when_more_than_two_exist(session):
    await seed_sku(session, "SKU-MULTI")
    await seed_node(session, "NODE-1")
    session.add_all([
        _snapshot("SKU-MULTI", "NODE-1", datetime(2026, 1, 1), safety_stock=100, enhanced_rop=100, final_max=100),
        _snapshot("SKU-MULTI", "NODE-1", datetime(2026, 1, 8), safety_stock=200, enhanced_rop=100, final_max=100),
        _snapshot("SKU-MULTI", "NODE-1", datetime(2026, 1, 15), safety_stock=300, enhanced_rop=100, final_max=100),
    ])
    await session.commit()

    items = await policy_drift(session)

    ss_item = next(item for item in items if item["metric"] == "Safety Stock" and item["skuCode"] == "SKU-MULTI")
    assert ss_item["previousValue"] == 200
    assert ss_item["currentValue"] == 300


# --- Phase 6 Part A: classification-driven initial policy-type assignment ---

def test_initial_policy_type_for_classification_rule():
    assert initial_policy_type_for_classification("Fast Moving") == "s_S"
    assert initial_policy_type_for_classification("Medium Moving") == "s_Q"
    assert initial_policy_type_for_classification("Slow Moving") == "R_S"
    assert initial_policy_type_for_classification(None) == "s_S"  # DEFAULT_POLICY_TYPE fallback
    assert initial_policy_type_for_classification("Nonsense") == "s_S"


async def test_apply_policy_type_change_preserves_computed_values_new_row(session):
    await seed_sku(session, "SKU-CHG")
    await seed_node(session, "NODE-1")
    session.add(_snapshot("SKU-CHG", "NODE-1", datetime(2026, 1, 1), safety_stock=1000, enhanced_rop=5000, final_max=9000, policy_type="s_S"))
    await session.commit()

    new_snapshot = await apply_policy_type_change(session, "SKU-CHG", "NODE-1", "R_s_S", datetime(2026, 1, 2))
    await session.commit()

    assert new_snapshot is not None
    assert new_snapshot.policy_type == "R_s_S"
    assert float(new_snapshot.enhanced_rop) == 5000  # same underlying computed value, just re-labeled
    assert float(new_snapshot.final_max) == 9000

    from sqlalchemy import select
    all_snapshots = (await session.scalars(select(PolicySnapshot).where(PolicySnapshot.sku_code == "SKU-CHG"))).all()
    assert len(all_snapshots) == 2  # append-only: old row preserved, new row added


async def test_apply_policy_type_change_returns_none_without_existing_snapshot(session):
    await seed_sku(session, "SKU-NONE")
    await seed_node(session, "NODE-1")
    await session.commit()

    result = await apply_policy_type_change(session, "SKU-NONE", "NODE-1", "R_S", datetime(2026, 1, 2))

    assert result is None
