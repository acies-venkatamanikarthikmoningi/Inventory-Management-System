"""Ad-hoc / exploratory Monte Carlo runs: lets a caller re-run the simulator
for a specific SKU/node set with a custom seed/N/horizon and see current vs.
best-alternative side by side, WITHOUT mutating the live policy - governance
mutation only ever happens via the official network-wide evaluation pass
(policy_recommendation_service.refresh_recommendations, triggered by
POST /policy/recommendations/refresh), never from an ad-hoc exploratory run
here. That's why evaluate_sku_node is called with apply_mutations=False
below - a user poking at a custom seed to see "what if" should never
silently change what policy is actually in force.
"""
import time
import uuid
from datetime import date, datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Node, SimulationResult, SimulationRun
from app.services.optimization_service import default_sku_codes
from app.services.policy_recommendation_service import cost_percentiles as get_cost_percentiles
from app.services.policy_recommendation_service import evaluate_sku_node
from app.services.policy_recommendation_service import volatility_percentiles as get_volatility_percentiles
from app.simulation.random_generator import DEFAULT_SEED

DEFAULT_N_RUNS = 200
DEFAULT_HORIZON_DAYS = 30


async def run_simulation(session: AsyncSession, sku_codes: list[str] | None, node_codes: list[str] | None,
                          n_runs: int | None, horizon_days: int | None, seed: int | None,
                          requested_at: datetime) -> SimulationRun:
    if not node_codes:
        node_codes = [n.node_code for n in (await session.scalars(select(Node).order_by(Node.node_code))).all()]
    if not sku_codes:
        sku_codes = await default_sku_codes(session, limit=8)
    n_runs = n_runs or DEFAULT_N_RUNS
    horizon_days = horizon_days or DEFAULT_HORIZON_DAYS
    seed = seed if seed is not None else DEFAULT_SEED
    as_of = requested_at.date() if isinstance(requested_at, datetime) else date.today()

    run = SimulationRun(
        requested_at=requested_at, seed=seed, n_runs=n_runs, horizon_days=horizon_days,
        sku_codes=sku_codes, node_codes=node_codes, status="pending", duration_seconds=0, detail="",
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)

    started = time.monotonic()
    results: list[SimulationResult] = []
    dropped = 0
    percentiles = await get_cost_percentiles(session)
    vol_percentiles = await get_volatility_percentiles(session)

    for sku_code in sku_codes:
        for node_code in node_codes:
            evaluation = await evaluate_sku_node(
                session, sku_code=sku_code, node_code=node_code, seed=seed, n_runs=n_runs, horizon_days=horizon_days,
                as_of=as_of, requested_at=requested_at, cost_percentiles=percentiles, vol_percentiles=vol_percentiles,
                apply_mutations=False,
            )
            if evaluation is None:
                dropped += 1
                continue

            roles = [("current", evaluation["current_result"])]
            if evaluation["suggested_result"] is not None:
                roles.append(("suggested", evaluation["suggested_result"]))

            for policy_role, sim in roles:
                metrics, scores = sim["metrics"], sim["scores"]
                results.append(SimulationResult(
                    run_id=run.id, sku_code=sku_code, node_code=node_code, policy_role=policy_role,
                    policy_type=sim["policy_type"], policy_params=sim["params"],
                    service_level_achieved=round(metrics["service_level_achieved"], 4),
                    avg_ending_inventory=round(metrics["avg_ending_inventory"], 3),
                    total_holding_cost=round(metrics["total_holding_cost"], 2),
                    total_shortage_cost=round(metrics["total_shortage_cost"], 2),
                    p95_shortage_qty=round(metrics["p95_shortage_qty"], 3),
                    composite_score=round(scores["composite_score"], 2),
                    service_stability=round(scores["service_stability"], 2),
                    stockout_resilience=round(scores["stockout_resilience"], 2),
                    cost_stability=round(scores["cost_stability"], 2),
                    expiry_robustness=round(scores["expiry_robustness"], 2),
                    inventory_stability=round(scores["inventory_stability"], 2),
                    governance_action=evaluation["governance_action"] if policy_role == "current" else None,
                ))

    duration = time.monotonic() - started
    run.status = "completed"
    run.duration_seconds = round(duration, 3)
    run.detail = f"Dropped {dropped} SKU/node pair(s) lacking a policy snapshot, cost profile, or recommendation." if dropped else ""
    session.add_all(results)
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def get_results(session: AsyncSession, run_id: str | None):
    if run_id:
        run = await session.get(SimulationRun, uuid.UUID(run_id))
    else:
        run = (await session.scalars(select(SimulationRun).order_by(SimulationRun.requested_at.desc()))).first()
    if run is None:
        return None, []
    results = (await session.scalars(
        select(SimulationResult).where(SimulationResult.run_id == run.id)
        .order_by(SimulationResult.sku_code, SimulationResult.node_code, SimulationResult.policy_role)
    )).all()
    return run, results
