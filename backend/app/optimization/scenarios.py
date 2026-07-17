"""Deterministic scenario set for Phase 4's stochastic MEIO model.

Honest limitation, stated explicitly per the task spec: this repo has no real
demand-variance history (Phase 3's demand/lead-time observations are
themselves deterministically seeded/simulated). True Monte Carlo sampling
over a fitted distribution is Phase 5's job. Here, a small fixed set of named
scenarios perturbs Phase 3's REAL computed policy inputs (ADD_rolling,
RMSE_D, L_actual, RMSE_LT) by documented percentages and feeds them back
through the actual safety_stock()/reorder_point() formulas in
app/services/policy_service.py - so each scenario's SS/ROP is a genuine
recomputation, not an invented number. Probabilities sum to 1.0.
"""
from app.services import policy_service

SCENARIOS = [
    {"name": "baseline", "probability": 0.40, "demand_multiplier": 1.00, "rmse_d_multiplier": 1.00, "lead_time_multiplier": 1.00, "rmse_lt_multiplier": 1.00},
    {"name": "demand_spike", "probability": 0.25, "demand_multiplier": 1.35, "rmse_d_multiplier": 1.50, "lead_time_multiplier": 1.00, "rmse_lt_multiplier": 1.00},
    {"name": "supplier_delay", "probability": 0.20, "demand_multiplier": 1.00, "rmse_d_multiplier": 1.00, "lead_time_multiplier": 1.40, "rmse_lt_multiplier": 1.60},
    {"name": "combined_stress", "probability": 0.15, "demand_multiplier": 1.35, "rmse_d_multiplier": 1.50, "lead_time_multiplier": 1.40, "rmse_lt_multiplier": 1.60},
]

assert abs(sum(s["probability"] for s in SCENARIOS) - 1.0) < 1e-9


def scenario_policy(snapshot, scenario: dict) -> dict:
    """Re-derive SS/ROP for one PolicySnapshot under one scenario's perturbed
    inputs, using the real Phase 3 formula functions (not a re-implementation)."""
    add = float(snapshot.add_rolling) * scenario["demand_multiplier"]
    rmse_d = float(snapshot.rmse_d) * scenario["rmse_d_multiplier"]
    l_actual = float(snapshot.l_actual) * scenario["lead_time_multiplier"]
    rmse_lt = float(snapshot.rmse_lt) * scenario["rmse_lt_multiplier"]

    ss = policy_service.safety_stock(
        float(snapshot.z_score), float(snapshot.review_period_days), l_actual, rmse_d, add, rmse_lt,
    )
    rop = policy_service.reorder_point(
        add, l_actual, float(snapshot.fill_rate), ss,
        float(snapshot.total_shelf_life_days), float(snapshot.min_shelf_life_required_days),
    )
    return {"add": add, "l_actual": l_actual, "rmse_d": rmse_d, "rmse_lt": rmse_lt,
            "safety_stock": ss, "enhanced_rop": rop["enhanced_rop"]}
