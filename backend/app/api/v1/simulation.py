from datetime import datetime, timezone
from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_session
from app.schemas.simulation import SimulationResultsResponse, SimulationRunRequest, SimulationRunResponse
from app.services import simulation_service

router = APIRouter(prefix="/simulation", tags=["simulation"])


@router.post("/run", response_model=SimulationRunResponse)
async def post_run(payload: SimulationRunRequest = Body(default_factory=SimulationRunRequest),
                    session: AsyncSession = Depends(get_session)):
    requested_at = datetime.now(timezone.utc).replace(tzinfo=None)
    run = await simulation_service.run_simulation(
        session, payload.skuCodes, payload.nodeCodes, payload.nRuns, payload.horizonDays, payload.seed, requested_at,
    )
    return {
        "runId": str(run.id), "requestedAt": run.requested_at, "seed": run.seed, "nRuns": run.n_runs,
        "horizonDays": run.horizon_days, "skuCodes": run.sku_codes, "nodeCodes": run.node_codes,
        "status": run.status, "durationSeconds": float(run.duration_seconds), "detail": run.detail,
    }


@router.get("/results", response_model=SimulationResultsResponse)
async def get_results(runId: str | None = Query(None), session: AsyncSession = Depends(get_session)):
    run, results = await simulation_service.get_results(session, runId)
    if run is None:
        return {"runId": None, "seed": None, "nRuns": None, "horizonDays": None, "status": None, "items": [], "total": 0}
    items = [{
        "runId": str(run.id), "skuCode": r.sku_code, "nodeCode": r.node_code, "policyRole": r.policy_role,
        "policyType": r.policy_type, "policyParams": r.policy_params,
        "serviceLevelAchieved": float(r.service_level_achieved), "avgEndingInventory": float(r.avg_ending_inventory),
        "totalHoldingCost": float(r.total_holding_cost), "totalShortageCost": float(r.total_shortage_cost),
        "p95ShortageQty": float(r.p95_shortage_qty),
        "compositeScore": float(r.composite_score), "serviceStability": float(r.service_stability),
        "stockoutResilience": float(r.stockout_resilience), "costStability": float(r.cost_stability),
        "expiryRobustness": float(r.expiry_robustness), "inventoryStability": float(r.inventory_stability),
        "governanceAction": r.governance_action,
    } for r in results]
    return {
        "runId": str(run.id), "seed": run.seed, "nRuns": run.n_runs, "horizonDays": run.horizon_days,
        "status": run.status, "items": items, "total": len(items),
    }
