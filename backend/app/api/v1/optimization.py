from datetime import datetime, timezone
from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_session
from app.schemas.optimization import (
    OptimizationRecommendationsResponse, OptimizationRunRequest, OptimizationRunResponse,
)
from app.services import optimization_service

router = APIRouter(prefix="/optimization", tags=["optimization"])


@router.post("/run", response_model=OptimizationRunResponse)
async def post_run(payload: OptimizationRunRequest = Body(default_factory=OptimizationRunRequest),
                    session: AsyncSession = Depends(get_session)):
    requested_at = datetime.now(timezone.utc).replace(tzinfo=None)
    run = await optimization_service.run_optimization(
        session, payload.skuCodes, payload.nodeCodes, payload.horizonDays, requested_at,
    )
    return {
        "runId": str(run.id), "requestedAt": run.requested_at, "nodeCodes": run.node_codes,
        "skuCodes": run.sku_codes, "horizonDays": run.horizon_days, "scenarioSet": run.scenario_set,
        "solverStatus": run.solver_status,
        "objectiveValue": float(run.objective_value) if run.objective_value is not None else None,
        "solveSeconds": float(run.solve_seconds), "detail": run.detail,
    }


@router.get("/recommendations", response_model=OptimizationRecommendationsResponse)
async def get_recommendations(runId: str | None = Query(None), session: AsyncSession = Depends(get_session)):
    run, recs = await optimization_service.get_recommendations(session, runId)
    if run is None:
        return {"runId": None, "items": [], "total": 0}
    items = [{
        "runId": str(run.id), "recommendationType": r.recommendation_type, "skuCode": r.sku_code,
        "nodeCode": r.node_code, "sourceNodeCode": r.source_node_code, "periodIndex": r.period_index,
        "scenarioName": r.scenario_name, "quantity": float(r.quantity),
    } for r in recs]
    return {"runId": str(run.id), "items": items, "total": len(items)}
