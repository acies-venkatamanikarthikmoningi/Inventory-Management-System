from datetime import date, datetime, timedelta
from app.models import Batch, DemandObservation, InventoryPosition, LeadTimeObservation, SkuCostProfile
from app.services.policy_service import refresh_policy
from app.services.simulation_service import get_results, run_simulation
from tests.conftest import seed_bin, seed_node, seed_sku

SKU = "SKU-SIM"
NODE = "NODE-SIM"


async def _seed_scenario(session):
    as_of = date.today()
    await seed_sku(session, SKU, description="Simulation Test SKU")
    await seed_node(session, NODE)
    await seed_bin(session, area_code="AREA-SIM", zone_code="ZONE-SIM", bin_code="BIN-SIM", face="RESERVE", pallet_capacity=1000)
    session.add(Batch(batch_number="B-SIM", sku_code=SKU, node_code=NODE, mfg_date=as_of - timedelta(days=10),
                       expiry_date=as_of + timedelta(days=300), shelf_life_months=12, total_qty=500))
    await session.flush()
    session.add(InventoryPosition(source_id="POS-SIM", sku_code=SKU, node_code=NODE, bin_code="BIN-SIM",
                                   batch_code="B-SIM", on_hand=300, available=300, inventory_position=300,
                                   expiry_date=as_of + timedelta(days=300)))
    for i in range(56):
        day = as_of - timedelta(days=55 - i)
        actual = 50 + (5 if i % 2 == 0 else -5)
        session.add(DemandObservation(sku_code=SKU, node_code=NODE, observed_date=day, forecast_qty=50, actual_qty=actual))
    for i in range(12):
        order_date = as_of - timedelta(days=5 * i)
        session.add(LeadTimeObservation(sku_code=SKU, node_code=NODE, order_date=order_date,
                                         promised_lead_time_days=4, actual_lead_time_days=5 if i % 2 == 0 else 3,
                                         ordered_qty=300, received_qty=280))
    session.add(SkuCostProfile(sku_code=SKU, unit_cost=20, holding_cost_pct=0.2, ordering_cost=100,
                                shortage_penalty_per_unit=30, expiry_penalty_per_unit=20, moq_units=20))
    await session.commit()
    await refresh_policy(session, None, None, computed_at=as_of, as_of=as_of)


async def test_run_simulation_produces_current_and_suggested_results(session):
    await _seed_scenario(session)

    run = await run_simulation(session, [SKU], [NODE], n_runs=50, horizon_days=30, seed=42,
                                requested_at=datetime.now())

    assert run.status == "completed"
    assert run.seed == 42
    assert run.n_runs == 50

    fetched_run, results = await get_results(session, str(run.id))
    assert fetched_run.id == run.id
    roles = {r.policy_role for r in results}
    # "suggested" is now only present when the simulator actually found a
    # genuinely-better alternative (Phase 6.1) - a well-behaved SKU whose
    # current policy already scores >=80 legitimately has no suggested row.
    assert roles <= {"current", "suggested"}
    assert "current" in roles
    for r in results:
        assert 0.0 <= float(r.service_level_achieved) <= 1.0
        assert float(r.p95_shortage_qty) >= 0.0
        assert r.policy_type in ("s_S", "s_Q", "R_S", "R_s_S", "base_stock")
        assert isinstance(r.policy_params, dict) and len(r.policy_params) >= 2
        assert 0.0 <= float(r.composite_score) <= 100.0
        assert 0.0 <= float(r.service_stability) <= 100.0
        assert 0.0 <= float(r.stockout_resilience) <= 100.0
        assert 0.0 <= float(r.cost_stability) <= 100.0
        assert 0.0 <= float(r.expiry_robustness) <= 100.0
        assert 0.0 <= float(r.inventory_stability) <= 100.0

    current_row = next(r for r in results if r.policy_role == "current")
    assert current_row.policy_type == "s_S"  # unclassified SKU -> DEFAULT_POLICY_TYPE
    assert current_row.governance_action in (
        "no_change_needed", "suggest_pending_approval", "no_better_alternative_found", "auto_changed",
    )
    suggested_rows = [r for r in results if r.policy_role == "suggested"]
    if suggested_rows:
        assert suggested_rows[0].governance_action is None  # governance only decided on the "current" row
        assert suggested_rows[0].policy_type != current_row.policy_type


async def test_same_seed_reproduces_identical_metrics(session):
    """Reproducibility is a property of (policy_type, params, seed) -> metrics,
    not of the "current"/"suggested" ROLE labels. Ad-hoc runs (this function)
    never mutate the live policy (apply_mutations=False - see
    simulation_service.run_simulation), so the "current" policy_type/params
    are identical across repeated calls with the same seed regardless; this
    compares by the actual (policy_type, params) combo simulated in each run
    rather than by role anyway, since that is the more fundamental identity."""
    await _seed_scenario(session)

    first = await run_simulation(session, [SKU], [NODE], n_runs=50, horizon_days=30, seed=7, requested_at=datetime.now())
    second = await run_simulation(session, [SKU], [NODE], n_runs=50, horizon_days=30, seed=7, requested_at=datetime.now())

    _, first_results = await get_results(session, str(first.id))
    _, second_results = await get_results(session, str(second.id))

    def key_and_metrics(r):
        key = (r.policy_type, tuple(sorted(r.policy_params.items())))
        metrics = (float(r.service_level_achieved), float(r.avg_ending_inventory),
                   float(r.total_holding_cost), float(r.total_shortage_cost), float(r.p95_shortage_qty),
                   float(r.composite_score))
        return key, metrics

    first_by_key = dict(key_and_metrics(r) for r in first_results)
    second_by_key = dict(key_and_metrics(r) for r in second_results)

    shared_keys = set(first_by_key) & set(second_by_key)
    assert shared_keys, "expected at least one identical (policy_type, params) combo across both runs"
    for key in shared_keys:
        assert first_by_key[key] == second_by_key[key]
