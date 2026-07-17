from datetime import date, timedelta
import pytest
import pyomo.environ as pyo
from app.models import Batch, DemandObservation, InventoryPosition, LeadTimeObservation, SkuCostProfile
from app.optimization.solver_adapter import solve_model
from app.services.inventory_balance import one_period_step
from app.services.optimization_service import build_model, gather_context
from app.services.policy_service import refresh_policy
from tests.conftest import seed_bin, seed_node, seed_sku


def test_sufficient_supply_serves_all_demand_no_backorder():
    result = one_period_step(start=100, arrivals=0, transfers_in=0, transfers_out=0, demand=40, prev_backorder=0)
    assert result["demand_served"] == 40
    assert result["backorder"] == 0
    assert result["on_hand"] == 60


def test_insufficient_supply_creates_backorder():
    result = one_period_step(start=10, arrivals=0, transfers_in=0, transfers_out=0, demand=40, prev_backorder=0)
    assert result["demand_served"] == 10
    assert result["backorder"] == 30
    assert result["on_hand"] == 0


def test_prior_backorder_carries_and_can_be_served_by_arrivals():
    result = one_period_step(start=0, arrivals=50, transfers_in=0, transfers_out=0, demand=10, prev_backorder=30)
    assert result["demand_served"] == 40
    assert result["backorder"] == 0
    assert result["on_hand"] == 10


def test_transfers_out_reduce_available_supply():
    result = one_period_step(start=100, arrivals=0, transfers_in=0, transfers_out=60, demand=20, prev_backorder=0)
    assert result["on_hand"] == 20
    assert result["backorder"] == 0


SKU = "SKU-BAL"
NODE = "NODE-BAL"


async def test_matches_solved_meio_model_on_hand_and_backorder(session):
    """Cross-check: replaying a solved Phase 4 MIP's arrivals/demand through
    one_period_step reproduces the exact same on_hand/backorder Pyomo
    computed - proof the simulator (Phase 5) and the optimizer (Phase 4)
    agree on basic mechanics, not just coincidentally similar answers."""
    as_of = date(2026, 6, 1)
    await seed_sku(session, SKU, description="Balance Cross-Check SKU")
    await seed_node(session, NODE)
    await seed_bin(session, area_code="AREA-BAL", zone_code="ZONE-BAL", bin_code="BIN-BAL", face="RESERVE", pallet_capacity=1000)
    session.add(Batch(batch_number="B-BAL", sku_code=SKU, node_code=NODE, mfg_date=as_of - timedelta(days=10),
                       expiry_date=as_of + timedelta(days=300), shelf_life_months=12, total_qty=100))
    await session.flush()
    session.add(InventoryPosition(source_id="POS-BAL", sku_code=SKU, node_code=NODE, bin_code="BIN-BAL",
                                   batch_code="B-BAL", on_hand=50, available=50, inventory_position=50,
                                   expiry_date=as_of + timedelta(days=300)))
    for i in range(56):
        day = as_of - timedelta(days=55 - i)
        session.add(DemandObservation(sku_code=SKU, node_code=NODE, observed_date=day, forecast_qty=30, actual_qty=30))
    for i in range(12):
        order_date = as_of - timedelta(days=5 * i)
        session.add(LeadTimeObservation(sku_code=SKU, node_code=NODE, order_date=order_date,
                                         promised_lead_time_days=2, actual_lead_time_days=2, ordered_qty=200, received_qty=200))
    session.add(SkuCostProfile(sku_code=SKU, unit_cost=10, holding_cost_pct=0.2, ordering_cost=100,
                                shortage_penalty_per_unit=15, expiry_penalty_per_unit=10, moq_units=20))
    await session.commit()
    await refresh_policy(session, None, None, computed_at=as_of, as_of=as_of)

    horizon = 6
    ctx = await gather_context(session, [SKU], [NODE], horizon, as_of)
    model = build_model(ctx, horizon)
    result = solve_model(model, time_limit_seconds=20)
    assert result.status in ("optimal", "feasible"), result.detail

    for t in range(horizon):
        for scenario_name in list(model.S):
            lead = ctx["lead_periods"][(SKU, NODE, scenario_name)]
            start = ctx["initial_on_hand"][(SKU, NODE)] if t == 0 else pyo.value(model.on_hand[SKU, NODE, t - 1, scenario_name])
            arrivals = pyo.value(model.order_qty[SKU, NODE, t - lead, scenario_name]) if t - lead >= 0 else 0.0
            prev_backorder = 0.0 if t == 0 else pyo.value(model.backorder[SKU, NODE, t - 1, scenario_name])
            demand = ctx["demand"][(SKU, NODE, scenario_name)]

            replay = one_period_step(start=start, arrivals=arrivals, transfers_in=0.0, transfers_out=0.0,
                                      demand=demand, prev_backorder=prev_backorder)

            assert replay["on_hand"] == pytest.approx(pyo.value(model.on_hand[SKU, NODE, t, scenario_name]), abs=1e-3)
            assert replay["backorder"] == pytest.approx(pyo.value(model.backorder[SKU, NODE, t, scenario_name]), abs=1e-3)
