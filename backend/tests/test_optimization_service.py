from datetime import date, timedelta
import pytest
import pyomo.environ as pyo
from app.models import Batch, DemandObservation, InventoryPosition, Lane, LeadTimeObservation, SkuCostProfile
from app.optimization.scenarios import SCENARIOS
from app.optimization.solver_adapter import solve_model
from app.services.optimization_service import (
    build_model, default_sku_codes, gather_context, recompute_objective_from_solution,
)
from app.services.policy_service import refresh_policy
from tests.conftest import seed_bin, seed_node, seed_sku

SKU = "SKU-OPT"
NODE_X = "NODE-X"  # shortage: low on-hand, small capacity
NODE_Y = "NODE-Y"  # surplus: high on-hand, generous capacity
HORIZON_DAYS = 10


async def _seed_demand_and_lead_time(session, node_code, as_of, demand=50.0, promised_lt=2.0, actual_lt=2.0):
    for i in range(56):
        day = as_of - timedelta(days=55 - i)
        session.add(DemandObservation(sku_code=SKU, node_code=node_code, observed_date=day, forecast_qty=demand, actual_qty=demand))
    for i in range(12):
        order_date = as_of - timedelta(days=5 * i)
        session.add(LeadTimeObservation(sku_code=SKU, node_code=node_code, order_date=order_date,
                                         promised_lead_time_days=promised_lt, actual_lead_time_days=actual_lt,
                                         ordered_qty=700, received_qty=700))


async def _seed_scenario(session, as_of, *, y_expiry_days: int):
    await seed_sku(session, SKU, description="Optimization Test SKU")
    await seed_node(session, NODE_X)
    await seed_node(session, NODE_Y)
    await seed_bin(session, area_code="AREA-X", zone_code="ZONE-X", bin_code="BIN-X", face="RESERVE", pallet_capacity=2)
    await seed_bin(session, area_code="AREA-Y", zone_code="ZONE-Y", bin_code="BIN-Y", face="RESERVE", pallet_capacity=1000)

    session.add(Batch(batch_number="B-X", sku_code=SKU, node_code=NODE_X, mfg_date=as_of - timedelta(days=10),
                       expiry_date=as_of + timedelta(days=300), shelf_life_months=12, total_qty=20))
    session.add(Batch(batch_number="B-Y", sku_code=SKU, node_code=NODE_Y, mfg_date=as_of - timedelta(days=10),
                       expiry_date=as_of + timedelta(days=y_expiry_days), shelf_life_months=12, total_qty=2000))
    await session.flush()

    session.add(InventoryPosition(source_id="POS-X", sku_code=SKU, node_code=NODE_X, bin_code="BIN-X", batch_code="B-X",
                                   on_hand=20, available=20, inventory_position=20, expiry_date=as_of + timedelta(days=300)))
    session.add(InventoryPosition(source_id="POS-Y", sku_code=SKU, node_code=NODE_Y, bin_code="BIN-Y", batch_code="B-Y",
                                   on_hand=2000, available=2000, inventory_position=2000, expiry_date=as_of + timedelta(days=y_expiry_days)))

    await _seed_demand_and_lead_time(session, NODE_X, as_of)
    await _seed_demand_and_lead_time(session, NODE_Y, as_of)
    session.add(SkuCostProfile(sku_code=SKU, unit_cost=10, holding_cost_pct=0.2, ordering_cost=100,
                                shortage_penalty_per_unit=15, expiry_penalty_per_unit=10, moq_units=50))
    session.add(Lane(source_node_code=NODE_Y, dest_node_code=NODE_X, transit_days=1, cost_per_unit=2))
    session.add(Lane(source_node_code=NODE_X, dest_node_code=NODE_Y, transit_days=1, cost_per_unit=2))
    await session.commit()

    await refresh_policy(session, None, None, computed_at=as_of, as_of=as_of)


async def test_solve_is_optimal_and_internally_consistent(session):
    as_of = date(2026, 6, 1)
    await _seed_scenario(session, as_of, y_expiry_days=300)  # both batches long-lived: transfer is shelf-life feasible

    ctx = await gather_context(session, [SKU], [NODE_X, NODE_Y], HORIZON_DAYS, as_of)
    assert (SKU, NODE_X, NODE_Y) in ctx["feasible_transfer"] or (SKU, NODE_Y, NODE_X) in ctx["feasible_transfer"]

    model = build_model(ctx, HORIZON_DAYS)
    result = solve_model(model, time_limit_seconds=30)

    assert result.status in ("optimal", "feasible"), result.detail
    assert result.objective_value is not None

    # Objective-consistency: recomputing total cost from the solved values matches the reported objective.
    recomputed = recompute_objective_from_solution(model, ctx, HORIZON_DAYS)
    assert recomputed == pytest.approx(result.objective_value, rel=1e-4, abs=1e-2)

    # Capacity constraint: NODE_X's tiny 2-pallet (80-case) capacity is never exceeded.
    capacity_x = ctx["capacity"][(SKU, NODE_X)]
    for t in range(HORIZON_DAYS):
        for scenario in SCENARIOS:
            assert pyo.value(model.on_hand[SKU, NODE_X, t, scenario["name"]]) <= capacity_x + 1e-6

    # MOQ constraint: any placed order is either zero or at least the 50-unit MOQ.
    moq = 50.0
    for t in range(HORIZON_DAYS):
        for scenario in SCENARIOS:
            qty = pyo.value(model.order_qty[SKU, NODE_X, t, scenario["name"]])
            assert qty < 1e-6 or qty >= moq - 1e-6

    # The optimizer should recognize NODE_Y's surplus is cheaper to ship than to
    # buy fresh stock for NODE_X (transfer cost 2/unit vs unit cost 10 + fixed order
    # cost 100) - a real, not-hardcoded, decision the solver makes on its own.
    total_transfer = sum(
        pyo.value(model.transfer_qty[SKU, NODE_Y, NODE_X, t, s["name"]])
        for t in range(HORIZON_DAYS) for s in SCENARIOS
    )
    assert total_transfer > 0


async def test_shelf_life_infeasible_transfer_excluded_from_model(session):
    as_of = date(2026, 6, 1)
    # NODE_Y's batch expires in 5 days; a 1-day transit leaves only 4/15 = 27% of
    # shelf life remaining at arrival, below the 60% MIN_SHELF_LIFE_FRACTION threshold.
    await _seed_scenario(session, as_of, y_expiry_days=5)

    ctx = await gather_context(session, [SKU], [NODE_X, NODE_Y], HORIZON_DAYS, as_of)

    assert (SKU, NODE_Y, NODE_X) not in ctx["feasible_transfer"]


async def test_expiry_forces_on_hand_to_zero_at_expire_period(session):
    as_of = date(2026, 6, 1)
    await _seed_scenario(session, as_of, y_expiry_days=5)

    ctx = await gather_context(session, [SKU], [NODE_X, NODE_Y], HORIZON_DAYS, as_of)
    assert ctx["expire_period"][(SKU, NODE_Y)] == 5

    model = build_model(ctx, HORIZON_DAYS)
    result = solve_model(model, time_limit_seconds=30)
    assert result.status in ("optimal", "feasible"), result.detail

    for scenario in SCENARIOS:
        assert pyo.value(model.on_hand[SKU, NODE_Y, 5, scenario["name"]]) == pytest.approx(0.0, abs=1e-6)


async def test_default_sku_codes_prefers_multi_node_skus(session):
    as_of = date(2026, 6, 1)
    await _seed_scenario(session, as_of, y_expiry_days=300)

    await seed_sku(session, "SKU-SINGLE", description="Single Node SKU")
    await seed_bin(session, area_code="AREA-Z", zone_code="ZONE-Z", bin_code="BIN-Z", face="RESERVE", pallet_capacity=10)
    session.add(Batch(batch_number="B-Z", sku_code="SKU-SINGLE", node_code=NODE_X, mfg_date=as_of - timedelta(days=10),
                       expiry_date=as_of + timedelta(days=300), shelf_life_months=12, total_qty=100))
    await session.flush()
    session.add(InventoryPosition(source_id="POS-Z", sku_code="SKU-SINGLE", node_code=NODE_X, bin_code="BIN-Z",
                                   batch_code="B-Z", on_hand=100, available=100, inventory_position=100,
                                   expiry_date=as_of + timedelta(days=300)))
    await session.commit()

    codes = await default_sku_codes(session)

    assert SKU in codes
    assert "SKU-SINGLE" not in codes
