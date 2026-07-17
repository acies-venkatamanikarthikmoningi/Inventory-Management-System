from datetime import date, datetime
from sqlalchemy import select
from app.models import InventoryPosition, PolicyChangeAuditLog, PolicyRecommendation, PolicySnapshot, Sku, SkuCostProfile
from app.seed.demo_robustness_showcase import (
    CHENNAI, PART_A, PART_B, _composite, _resolve_type, seed_demo_robustness_showcase,
)
from app.services.policy_recommendation_service import refresh_recommendations
from tests.conftest import seed_bin, seed_node, seed_sku

ALL_DEMO_SKUS = [row["sku"] for row in PART_A] + [row["sku"] for row in PART_B]


async def _seed_context(session, sku_code, node_code):
    """Minimal PolicySnapshot/SkuCostProfile/InventoryPosition context -
    everything build_context/policy_params_for_type need - same shape as
    test_policy_recommendation_service.py's _seed_pair, just standalone here
    so this test module doesn't depend on another test file's helper."""
    await seed_sku(session, sku_code, description=f"{sku_code} test SKU")
    sku_row = (await session.scalars(select(Sku).where(Sku.sku_code == sku_code))).first()
    sku_row.classification = "Fast Moving"
    session.add(SkuCostProfile(sku_code=sku_code, unit_cost=100.0, holding_cost_pct=0.2, ordering_cost=100,
                                shortage_penalty_per_unit=30, expiry_penalty_per_unit=20, moq_units=20))
    session.add(PolicySnapshot(
        sku_code=sku_code, node_code=node_code, computed_at=date.today(),
        review_period_days=7.0, service_level=0.95, z_score=1.645,
        add_rolling=500.0, rmse_d=50.0, l_actual=5.0, rmse_lt=1.0, fill_rate=0.9,
        safety_stock=200.0, base_rop=1000.0, total_shelf_life_days=90.0,
        min_shelf_life_required_days=54.0, max_holdable_stock=99999.0, enhanced_rop=1000.0,
        eoq=800.0, raw_max=3000.0, warehouse_capacity_qty=99999.0, final_max=3000.0,
        shelf_life_capacity_qty=99999.0, policy_type="s_S",
    ))
    bin_code = f"BIN-{sku_code}"
    await seed_bin(session, area_code=f"AREA-{sku_code}", zone_code=f"ZONE-{sku_code}", bin_code=bin_code, pallet_capacity=1000)
    session.add(InventoryPosition(source_id=f"POS-{sku_code}", sku_code=sku_code, node_code=node_code,
                                   bin_code=bin_code, batch_code=f"BATCH-{sku_code}", on_hand=1000.0,
                                   available=1000.0, inventory_position=1000.0))
    await session.flush()


async def _seed_all_demo_context(session):
    await seed_node(session, CHENNAI)
    for sku_code in ALL_DEMO_SKUS:
        await _seed_context(session, sku_code, CHENNAI)
    await session.commit()


def test_composite_matches_real_weight_formula():
    # 0.30/0.25/0.20/0.15/0.10 - same weights as robustness_service.compute_robustness_score
    assert _composite((100, 100, 100, 100, 100)) == 100.0
    assert _composite((0, 0, 0, 0, 0)) == 0.0
    assert abs(_composite((80, 60, 40, 20, 100)) - (0.30 * 80 + 0.25 * 60 + 0.20 * 40 + 0.15 * 20 + 0.10 * 100)) < 1e-9


def test_resolve_type_keeps_preferred_when_it_differs():
    assert _resolve_type("s_Q", "s_S") == "s_Q"


def test_resolve_type_falls_back_when_preferred_collides_with_current():
    resolved = _resolve_type("s_S", "s_S")
    assert resolved != "s_S"
    assert resolved in {"s_Q", "R_S", "R_s_S", "base_stock"}


def test_part_a_and_part_b_skus_do_not_overlap():
    part_a_skus = {row["sku"] for row in PART_A}
    part_b_skus = {row["sku"] for row in PART_B}
    assert part_a_skus.isdisjoint(part_b_skus)
    assert len(PART_A) in (6, 7)
    assert len(PART_B) in (5, 6)


async def test_seed_demo_showcase_writes_flagged_internally_consistent_rows(session):
    await _seed_all_demo_context(session)

    await seed_demo_robustness_showcase(session)

    rows = (await session.scalars(
        select(PolicyRecommendation).where(PolicyRecommendation.node_code == CHENNAI, PolicyRecommendation.is_demo_seed == True)  # noqa: E712
    )).all()
    assert len(rows) == len(PART_A) + len(PART_B)

    pending = [r for r in rows if r.governance_action == "suggest_pending_approval"]
    auto = [r for r in rows if r.governance_action == "auto_changed"]
    assert len(pending) == len(PART_A)
    assert len(auto) == len(PART_B)

    for r in rows:
        assert r.is_demo_seed is True
        assert r.suggested_policy_type is not None
        assert r.suggested_policy_type != r.current_policy_type
        assert float(r.suggested_composite_score) > float(r.current_composite_score)
        assert float(r.suggested_service_level_achieved) > float(r.current_service_level_achieved)
        assert float(r.suggested_total_cost) < float(r.current_total_cost)
        # cost breakdown sums to the total (holding + shortage/stockout = total)
        assert abs(float(r.current_total_holding_cost) + float(r.current_total_shortage_cost) - float(r.current_total_cost)) < 1
        assert abs(float(r.suggested_total_holding_cost) + float(r.suggested_total_shortage_cost) - float(r.suggested_total_cost)) < 1

    for r in pending:
        assert 40 <= float(r.current_composite_score) <= 79
        assert 80 <= float(r.suggested_composite_score) <= 96
    for r in auto:
        assert float(r.current_composite_score) < 40
        assert 80 <= float(r.suggested_composite_score) <= 96

    # diversity: more than one policy type is used as a suggested/new type (this
    # fixture gives every SKU the same current_policy_type="s_S", so _resolve_type
    # correctly avoids "s_S" everywhere here - full 5-type spread across real,
    # varied current types was confirmed live against the real seeded dataset)
    suggested_types = {r.suggested_policy_type for r in rows}
    assert len(suggested_types) >= 3
    assert "s_S" not in suggested_types  # every row's current type here, so never a valid suggestion


async def test_seed_demo_showcase_writes_matching_audit_log_for_part_b(session):
    await _seed_all_demo_context(session)
    await seed_demo_robustness_showcase(session)

    audit_rows = (await session.scalars(
        select(PolicyChangeAuditLog).where(PolicyChangeAuditLog.node_code == CHENNAI, PolicyChangeAuditLog.is_demo_seed == True)  # noqa: E712
    )).all()
    assert len(audit_rows) == len(PART_B)
    for a in audit_rows:
        assert a.changed_by == "system_auto_governance"
        assert a.is_demo_seed is True
        assert a.new_policy_type != a.old_policy_type
        assert float(a.robustness_score_at_change) < 40


async def test_seed_demo_showcase_is_idempotent(session):
    await _seed_all_demo_context(session)
    await seed_demo_robustness_showcase(session)
    await seed_demo_robustness_showcase(session)

    rows = (await session.scalars(
        select(PolicyRecommendation).where(PolicyRecommendation.node_code == CHENNAI, PolicyRecommendation.is_demo_seed == True)  # noqa: E712
    )).all()
    audit_rows = (await session.scalars(
        select(PolicyChangeAuditLog).where(PolicyChangeAuditLog.node_code == CHENNAI, PolicyChangeAuditLog.is_demo_seed == True)  # noqa: E712
    )).all()
    assert len(rows) == len(PART_A) + len(PART_B)  # no duplicate PolicyRecommendation rows
    assert len(audit_rows) == len(PART_B)  # no accumulated duplicate audit rows


async def test_refresh_recommendations_skips_demo_seed_rows(session):
    """The real network-wide pipeline must never overwrite or conflict with a
    showcase row - this is the Part C isolation guarantee."""
    await _seed_all_demo_context(session)
    await seed_demo_robustness_showcase(session)

    before = {
        r.sku_code: (r.governance_action, float(r.current_composite_score), float(r.suggested_composite_score))
        for r in (await session.scalars(
            select(PolicyRecommendation).where(PolicyRecommendation.node_code == CHENNAI)
        )).all()
    }

    recs, tier_counts, total_sims = await refresh_recommendations(session, None, None, computed_at=datetime.now())

    # None of the 13 demo SKU/node pairs should have been (re)computed this pass
    assert sum(tier_counts.values()) == 0
    assert total_sims == 0
    assert len(recs) == 0

    after = {
        r.sku_code: (r.governance_action, float(r.current_composite_score), float(r.suggested_composite_score))
        for r in (await session.scalars(
            select(PolicyRecommendation).where(PolicyRecommendation.node_code == CHENNAI)
        )).all()
    }
    assert after == before
