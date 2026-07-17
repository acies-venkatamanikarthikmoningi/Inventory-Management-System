import math
import pytest
from app.services.exceptions_service import MIN_SHELF_LIFE_FRACTION
from app.services.policy_service import (
    economic_order_quantity,
    max_replenishment_capacity,
    reorder_point,
    safety_stock,
    z_score_for_service_level,
)

# ── Safety Stock: direction-of-impact for each factor ──────────────────────

def test_safety_stock_increases_with_z():
    low = safety_stock(z=1.28, review_period_days=7, lead_time_days=5, rmse_d=100, add_rolling=500, rmse_lt=1)
    high = safety_stock(z=2.33, review_period_days=7, lead_time_days=5, rmse_d=100, add_rolling=500, rmse_lt=1)
    assert high > low


def test_safety_stock_increases_with_rmse_d():
    low = safety_stock(z=1.65, review_period_days=7, lead_time_days=5, rmse_d=50, add_rolling=500, rmse_lt=1)
    high = safety_stock(z=1.65, review_period_days=7, lead_time_days=5, rmse_d=200, add_rolling=500, rmse_lt=1)
    assert high > low


def test_safety_stock_increases_with_rmse_lt():
    low = safety_stock(z=1.65, review_period_days=7, lead_time_days=5, rmse_d=100, add_rolling=500, rmse_lt=0.2)
    high = safety_stock(z=1.65, review_period_days=7, lead_time_days=5, rmse_d=100, add_rolling=500, rmse_lt=2.0)
    assert high > low


def test_safety_stock_increases_with_risk_horizon():
    short = safety_stock(z=1.65, review_period_days=3, lead_time_days=2, rmse_d=100, add_rolling=500, rmse_lt=1)
    long = safety_stock(z=1.65, review_period_days=10, lead_time_days=8, rmse_d=100, add_rolling=500, rmse_lt=1)
    assert long > short


def test_accurately_forecast_but_variable_demand_is_not_over_buffered():
    # The formula's whole point: RMSE_D (error) drives SS, not raw demand level (ADD).
    # A SKU forecast with zero error should need only the lead-time-error term, regardless of its ADD.
    small_add = safety_stock(z=1.65, review_period_days=7, lead_time_days=5, rmse_d=0, add_rolling=100, rmse_lt=0)
    large_add = safety_stock(z=1.65, review_period_days=7, lead_time_days=5, rmse_d=0, add_rolling=100000, rmse_lt=0)
    assert small_add == 0
    assert large_add == 0


# ── Reorder Point: 3-step calculation ──────────────────────────────────────

def test_rop_base_formula_applies_fill_rate_correction():
    result = reorder_point(add_rolling=1000, l_actual=5, fill_rate=1.0, safety_stock_value=0,
                            total_shelf_life_days=365, min_shelf_life_required_days=0)
    result_low_fill = reorder_point(add_rolling=1000, l_actual=5, fill_rate=0.84, safety_stock_value=0,
                                     total_shelf_life_days=365, min_shelf_life_required_days=0)
    # 100% fill rate: base = ADD*L = 5000. Lower fill rate must raise the trigger point.
    assert result["base_rop"] == pytest.approx(5000)
    assert result_low_fill["base_rop"] > result["base_rop"]
    assert result_low_fill["base_rop"] == pytest.approx(1000 * 5 / 0.84)


def test_rop_shelf_life_cap_overrides_base_formula_when_shelf_life_is_short():
    # Short shelf life (10 days): base ROP would want 5000+SS, but only 4000 units can ever be
    # consumed within the receipt-to-expiry window, so the enhanced ROP must be capped there.
    result = reorder_point(add_rolling=1000, l_actual=5, fill_rate=1.0, safety_stock_value=0,
                            total_shelf_life_days=10, min_shelf_life_required_days=10 * MIN_SHELF_LIFE_FRACTION)
    assert result["max_holdable_stock"] == pytest.approx(4000)
    assert result["base_rop"] == pytest.approx(5000)
    assert result["enhanced_rop"] == pytest.approx(4000)
    assert result["enhanced_rop"] < result["base_rop"]


def test_rop_base_formula_wins_when_shelf_life_is_generous():
    result = reorder_point(add_rolling=1000, l_actual=5, fill_rate=1.0, safety_stock_value=500,
                            total_shelf_life_days=365, min_shelf_life_required_days=365 * MIN_SHELF_LIFE_FRACTION)
    assert result["enhanced_rop"] == result["base_rop"]
    assert result["enhanced_rop"] == pytest.approx(5500)


# ── EOQ / MAX ───────────────────────────────────────────────────────────────

def test_eoq_matches_closed_form():
    eoq = economic_order_quantity(annual_demand=365000, ordering_cost=500, holding_cost_per_unit=20)
    assert eoq == pytest.approx(math.sqrt(2 * 365000 * 500 / 20))


def test_eoq_is_zero_when_no_holding_cost():
    assert economic_order_quantity(annual_demand=100000, ordering_cost=500, holding_cost_per_unit=0) == 0.0


def test_max_uncapped_when_capacity_and_shelf_life_are_generous():
    result = max_replenishment_capacity(rop=1000, eoq=5000, warehouse_capacity_qty=100000,
                                         total_shelf_life_days=365, add_rolling=1000)
    assert result["raw_max"] == pytest.approx(6000)
    assert result["final_max"] == pytest.approx(6000)


def test_max_capped_by_warehouse_capacity():
    result = max_replenishment_capacity(rop=1000, eoq=5000, warehouse_capacity_qty=3000,
                                         total_shelf_life_days=365, add_rolling=1000)
    assert result["raw_max"] == pytest.approx(6000)
    assert result["final_max"] == pytest.approx(3000)
    assert result["final_max"] < result["raw_max"]


def test_max_capped_by_shelf_life_consumption():
    result = max_replenishment_capacity(rop=1000, eoq=5000, warehouse_capacity_qty=100000,
                                         total_shelf_life_days=2, add_rolling=1000)
    assert result["shelf_life_capacity_qty"] == pytest.approx(2000)
    assert result["final_max"] == pytest.approx(2000)
    assert result["final_max"] < result["raw_max"]


# ── Worked example from the formula spec (Coca-Cola Classic 330ml, Chennai DC) ──
# ADD=1000 cases/day, L=5 days, R=7 days, 95% service level (Z), RMSE_D=142.
# RMSE_LT solved offline to ~1.0446 so that SS lands at the documented ~1899 cases;
# this pins the formula's SHAPE (not just its coefficients) against a known-good result.

def test_worked_example_safety_stock_and_rop():
    z = z_score_for_service_level(0.95)
    ss = safety_stock(z=z, review_period_days=7, lead_time_days=5, rmse_d=142, add_rolling=1000, rmse_lt=1.0446)
    assert ss == pytest.approx(1899, rel=0.01)

    rop = reorder_point(add_rolling=1000, l_actual=5, fill_rate=0.84, safety_stock_value=ss,
                         total_shelf_life_days=90, min_shelf_life_required_days=90 * MIN_SHELF_LIFE_FRACTION)
    # Fill-rate correction: base ROP is well above the naive ADD*L=5000.
    assert rop["base_rop"] > 5000
    assert rop["base_rop"] == pytest.approx(1000 * 5 / 0.84 + ss, rel=0.001)
    # At a 90-day shelf life the holdable cap (36,000) doesn't bind here - the base formula wins.
    assert rop["max_holdable_stock"] == pytest.approx(36000)
    assert rop["enhanced_rop"] == rop["base_rop"]
