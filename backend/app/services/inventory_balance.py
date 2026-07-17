"""Shared inventory-balance state transition, used by BOTH Phase 4's MEIO
model (app/services/optimization_service.py's balance/backorder/served_le_*
Pyomo constraints encode this same relationship symbolically) and Phase 5's
Monte Carlo simulator (app/simulation/policy_simulator.py calls this directly,
numerically, once per simulated day). One formula, two consumers, so the
optimizer and the simulator can't silently disagree about basic mechanics -
see tests/test_inventory_balance.py for a cross-check against a solved MIP.
"""


def one_period_step(start: float, arrivals: float, transfers_in: float, transfers_out: float,
                     demand: float, prev_backorder: float, expired: float = 0.0) -> dict:
    """One period's ending on-hand/backorder/demand-served, given the same
    relationships build_model()'s Pyomo constraints express:
      supply          = start + arrivals + transfers_in - transfers_out
      demand_pressure = prev_backorder + demand
      demand_served    = min(supply, demand_pressure)   (can't serve more than either)
      on_hand          = supply - demand_served - expired
      backorder        = demand_pressure - demand_served
    """
    supply = max(start + arrivals + transfers_in - transfers_out, 0.0)
    demand_pressure = max(prev_backorder + demand, 0.0)
    demand_served = max(min(supply, demand_pressure), 0.0)
    on_hand = max(supply - demand_served - expired, 0.0)
    backorder = max(demand_pressure - demand_served, 0.0)
    return {"on_hand": on_hand, "backorder": backorder, "demand_served": demand_served}
