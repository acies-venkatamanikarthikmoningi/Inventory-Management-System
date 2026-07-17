"""Solver-neutral adapter around Pyomo + HiGHS (via the open-source `highspy`
package). app/services/optimization_service.py builds a plain pyo.ConcreteModel
and calls solve_model() here; it never imports pyomo/highspy solver internals
directly, and the rest of the service layer only ever sees SolveResult - per
docs/target-architecture.md's "solver adapter" principle, so swapping solvers
later only touches this one file.

Uses the modern appsi Highs interface directly (not the legacy
pyo.SolverFactory("appsi_highs") shim) - the legacy wrapper was found, during
this phase's own live verification, to silently ignore config.time_limit and
run to true optimality/exhaustion instead of honoring the cutoff. The direct
appsi interface's time_limit was verified to actually bound solve time."""
import time
from dataclasses import dataclass, field
import pyomo.environ as pyo
from pyomo.contrib.appsi.solvers.highs import Highs


@dataclass
class SolveResult:
    status: str  # "optimal" | "feasible" | "infeasible" | "error"
    objective_value: float | None
    solve_seconds: float
    detail: str = ""
    variable_values: dict = field(default_factory=dict)


def solve_model(model: pyo.ConcreteModel, time_limit_seconds: int = 60) -> SolveResult:
    started = time.monotonic()
    try:
        solver = Highs()
        solver.config.time_limit = float(time_limit_seconds)
        solver.config.load_solution = True
        # HiGHS' default MIP optimality gap is 0 (prove true optimality); for a
        # solve that must return within time_limit_seconds, accept a 1% gap so
        # branch-and-bound can stop early with a "good enough" integer solution
        # instead of exhausting the full time budget proving the last 0.001%.
        solver.highs_options["mip_rel_gap"] = 0.01
        results = solver.solve(model)
    except Exception as exc:  # pragma: no cover - exercised via the API integration test's live run
        return SolveResult(status="error", objective_value=None, solve_seconds=time.monotonic() - started, detail=str(exc))

    solve_seconds = time.monotonic() - started
    term = str(results.termination_condition).rsplit(".", 1)[-1].lower()

    if term == "optimal":
        status = "optimal"
    elif term in ("maxtimelimit", "feasible"):
        status = "feasible"
    elif term in ("infeasible", "infeasibleorunbounded"):
        status = "infeasible"
    else:
        status = "error"

    objective_value = None
    if status in ("optimal", "feasible"):
        try:
            objective_value = pyo.value(model.OBJ)
        except Exception:
            status = "error"

    return SolveResult(status=status, objective_value=objective_value, solve_seconds=solve_seconds, detail=term)
