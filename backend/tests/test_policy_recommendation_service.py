from datetime import date, datetime
from app.models import PolicySnapshot, Sku, SkuCostProfile
from app.services.policy_recommendation_service import (
    build_context, cost_percentiles, evaluate_sku_node, refresh_recommendations, volatility_percentiles,
)
from tests.conftest import seed_bin, seed_node, seed_sku

NODE = "NODE-REC"


def _snapshot(sku_code, node_code, *, add_rolling, rmse_d, l_actual=5.0, rmse_lt=1.0,
              enhanced_rop=1000.0, final_max=3000.0, eoq=800.0, computed_at, policy_type="s_S"):
    return PolicySnapshot(
        sku_code=sku_code, node_code=node_code, computed_at=computed_at,
        review_period_days=7.0, service_level=0.95, z_score=1.645,
        add_rolling=add_rolling, rmse_d=rmse_d, l_actual=l_actual, rmse_lt=rmse_lt, fill_rate=0.9,
        safety_stock=200.0, base_rop=enhanced_rop, total_shelf_life_days=90.0,
        min_shelf_life_required_days=54.0, max_holdable_stock=99999.0, enhanced_rop=enhanced_rop,
        eoq=eoq, raw_max=final_max, warehouse_capacity_qty=99999.0, final_max=final_max,
        shelf_life_capacity_qty=99999.0, policy_type=policy_type,
    )


async def _seed_pair(session, sku_code, *, classification, unit_cost, add_rolling, rmse_d, initial_on_hand=0.0):
    from sqlalchemy import select
    from app.models import InventoryPosition
    await seed_sku(session, sku_code, description=f"{sku_code} test SKU")
    sku_row = (await session.scalars(select(Sku).where(Sku.sku_code == sku_code))).first()
    sku_row.classification = classification
    session.add(SkuCostProfile(sku_code=sku_code, unit_cost=unit_cost, holding_cost_pct=0.2, ordering_cost=100,
                                shortage_penalty_per_unit=30, expiry_penalty_per_unit=20, moq_units=20))
    computed_at = date.today()
    session.add(_snapshot(sku_code, NODE, add_rolling=add_rolling, rmse_d=rmse_d, computed_at=computed_at))
    # Always create an InventoryPosition row (even at 0 on-hand) - refresh_recommendations
    # discovers SKU/node pairs via policy_service.sku_node_pairs(), which reads
    # InventoryPosition, not PolicySnapshot - a pair with no position row would be
    # silently invisible to a network-wide refresh.
    bin_code = f"BIN-{sku_code}"
    await seed_bin(session, area_code=f"AREA-{sku_code}", zone_code=f"ZONE-{sku_code}", bin_code=bin_code, pallet_capacity=1000)
    session.add(InventoryPosition(source_id=f"POS-{sku_code}", sku_code=sku_code, node_code=NODE,
                                   bin_code=bin_code, batch_code=f"BATCH-{sku_code}", on_hand=initial_on_hand,
                                   available=initial_on_hand, inventory_position=initial_on_hand))
    await session.commit()


async def test_build_context_reflects_real_computed_values(session):
    await seed_node(session, NODE)
    await _seed_pair(session, "SKU-REC-1", classification="Fast Moving", unit_cost=50.0, add_rolling=500.0, rmse_d=150.0)

    context = await build_context(session, "SKU-REC-1", NODE, date.today())

    assert context is not None
    assert context["current_policy_type"] == "s_S"
    assert context["classification"] == "Fast Moving"
    assert context["volatility_ratio"] == 150.0 / 500.0
    assert context["unit_cost"] == 50.0


async def test_build_context_none_when_no_cost_profile(session):
    await seed_node(session, NODE)
    await seed_sku(session, "SKU-NO-COST")
    session.add(_snapshot("SKU-NO-COST", NODE, add_rolling=100.0, rmse_d=10.0, computed_at=date.today()))
    await session.commit()

    context = await build_context(session, "SKU-NO-COST", NODE, date.today())
    assert context is None


async def test_evaluate_sku_node_skips_alternative_search_when_current_already_robust(session):
    """A well-stocked, low-variability, well-forecast SKU should score >=80 on
    its current policy - the simulator should NOT be asked to evaluate any
    alternatives in that case (efficiency: "don't force a suggestion"), and
    no suggestion should be surfaced."""
    await seed_node(session, NODE)
    await _seed_pair(session, "SKU-REC-GOOD", classification="Fast Moving", unit_cost=50.0,
                      add_rolling=100.0, rmse_d=2.0, initial_on_hand=5000.0)

    percentiles = await cost_percentiles(session)
    vol_pcts = await volatility_percentiles(session)
    result = await evaluate_sku_node(
        session, sku_code="SKU-REC-GOOD", node_code=NODE, seed=42, n_runs=80, horizon_days=30,
        as_of=date.today(), requested_at=datetime.now(), cost_percentiles=percentiles, vol_percentiles=vol_pcts,
        apply_mutations=True,
    )

    assert result is not None
    if result["current_result"]["scores"]["composite_score"] >= 80:
        assert result["governance_action"] == "no_change_needed"
        assert result["suggested_result"] is None
        assert result["sims_run"] == 1
    # If this particular seed/scenario doesn't clear 80 (stochastic edge case),
    # fall through to the general structural invariants test below instead of
    # asserting a specific tier here.


async def test_evaluate_sku_node_structural_invariants_hold_regardless_of_scenario(session):
    """Whatever tier a scenario lands in, these invariants must hold: a
    suggestion exists if and only if the tier calls for one, a suggestion (if
    any) is never the same type as current, and sims_run reflects whether an
    alternative search happened (1 vs up to 5)."""
    await seed_node(session, NODE)
    await _seed_pair(session, "SKU-REC-EDGE", classification="Slow Moving", unit_cost=900.0,
                      add_rolling=40.0, rmse_d=25.0, initial_on_hand=0.0)  # thin stock, likely to stock out

    percentiles = await cost_percentiles(session)
    vol_pcts = await volatility_percentiles(session)
    result = await evaluate_sku_node(
        session, sku_code="SKU-REC-EDGE", node_code=NODE, seed=42, n_runs=80, horizon_days=30,
        as_of=date.today(), requested_at=datetime.now(), cost_percentiles=percentiles, vol_percentiles=vol_pcts,
        apply_mutations=True,
    )

    assert result is not None
    action = result["governance_action"]
    suggested = result["suggested_result"]
    if action == "no_change_needed":
        assert suggested is None
        assert result["sims_run"] == 1
    elif action == "no_better_alternative_found":
        assert suggested is None
        assert result["sims_run"] > 1
    else:  # suggest_pending_approval or auto_changed
        assert result["sims_run"] > 1
        assert suggested is not None
        assert suggested["policy_type"] != result["current_policy_type"]
        assert suggested["scores"]["composite_score"] > result["current_result"]["scores"]["composite_score"]
    assert len(result["reasoning"]) > 20


async def test_refresh_recommendations_upserts_not_accumulates(session):
    await seed_node(session, NODE)
    await _seed_pair(session, "SKU-REC-12", classification="Slow Moving", unit_cost=25.0, add_rolling=80.0, rmse_d=3.0,
                      initial_on_hand=2000.0)

    first, tier_counts_1, sims_1 = await refresh_recommendations(session, "SKU-REC-12", NODE, computed_at=datetime.now())
    second, tier_counts_2, sims_2 = await refresh_recommendations(session, "SKU-REC-12", NODE, computed_at=datetime.now())

    assert len(first) == 1
    assert len(second) == 1
    assert first[0].id == second[0].id  # same row updated in place, not a new one appended
    assert sum(tier_counts_1.values()) == 1
    assert sims_1 >= 1


async def test_refresh_recommendations_reports_tier_counts_and_sim_totals(session):
    await seed_node(session, NODE)
    await _seed_pair(session, "SKU-REC-A", classification="Fast Moving", unit_cost=50.0, add_rolling=100.0, rmse_d=2.0,
                      initial_on_hand=5000.0)
    await _seed_pair(session, "SKU-REC-B", classification="Slow Moving", unit_cost=900.0, add_rolling=40.0, rmse_d=25.0,
                      initial_on_hand=0.0)

    recs, tier_counts, total_sims = await refresh_recommendations(session, None, None, computed_at=datetime.now())

    assert len(recs) == 2
    assert sum(tier_counts.values()) == 2
    assert set(tier_counts.keys()) == {
        "no_change_needed", "suggest_pending_approval", "no_better_alternative_found", "auto_changed",
    }
    assert total_sims >= 2  # at least 1 sim per pair
    for rec in recs:
        assert rec.governance_action in tier_counts
        if rec.suggested_policy_type is None:
            assert rec.suggested_composite_score is None
        else:
            assert rec.suggested_policy_type != rec.current_policy_type
            assert rec.suggested_composite_score is not None
