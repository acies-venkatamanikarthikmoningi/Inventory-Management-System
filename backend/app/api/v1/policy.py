import time
from datetime import datetime, timezone
from fastapi import APIRouter, Body, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_session
from app.models import PolicyRecommendation
from app.schemas.policy import (
    PolicyApproveChangeRequest, PolicyApproveChangeResponse, PolicyAuditLogResponse,
    PolicyDriftResponse, PolicyRecommendationsRefreshResponse, PolicyRecommendationsResponse, PolicyRefreshResponse,
)
from app.services import robustness_service
from app.services.policy_recommendation_service import refresh_recommendations
from app.services.policy_service import policy_drift, refresh_policy

router = APIRouter(prefix="/policy", tags=["policy"])


def _recommendation_item(r: PolicyRecommendation) -> dict:
    return {
        "skuCode": r.sku_code, "node": r.node_code, "computedAt": r.computed_at,
        "currentPolicyType": r.current_policy_type, "suggestedPolicyType": r.suggested_policy_type,
        "currentParams": r.current_params, "suggestedParams": r.suggested_params, "reasoning": r.reasoning,
        "governanceAction": r.governance_action,
        "currentCompositeScore": float(r.current_composite_score),
        "currentServiceStability": float(r.current_service_stability),
        "currentStockoutResilience": float(r.current_stockout_resilience),
        "currentCostStability": float(r.current_cost_stability),
        "currentExpiryRobustness": float(r.current_expiry_robustness),
        "currentInventoryStability": float(r.current_inventory_stability),
        "currentServiceLevelAchieved": float(r.current_service_level_achieved),
        "currentTotalCost": float(r.current_total_cost),
        "currentTotalHoldingCost": float(r.current_total_holding_cost),
        "currentTotalShortageCost": float(r.current_total_shortage_cost),
        "suggestedCompositeScore": float(r.suggested_composite_score) if r.suggested_composite_score is not None else None,
        "suggestedServiceStability": float(r.suggested_service_stability) if r.suggested_service_stability is not None else None,
        "suggestedStockoutResilience": float(r.suggested_stockout_resilience) if r.suggested_stockout_resilience is not None else None,
        "suggestedCostStability": float(r.suggested_cost_stability) if r.suggested_cost_stability is not None else None,
        "suggestedExpiryRobustness": float(r.suggested_expiry_robustness) if r.suggested_expiry_robustness is not None else None,
        "suggestedInventoryStability": float(r.suggested_inventory_stability) if r.suggested_inventory_stability is not None else None,
        "suggestedServiceLevelAchieved": float(r.suggested_service_level_achieved) if r.suggested_service_level_achieved is not None else None,
        "suggestedTotalCost": float(r.suggested_total_cost) if r.suggested_total_cost is not None else None,
        "suggestedTotalHoldingCost": float(r.suggested_total_holding_cost) if r.suggested_total_holding_cost is not None else None,
        "suggestedTotalShortageCost": float(r.suggested_total_shortage_cost) if r.suggested_total_shortage_cost is not None else None,
        "isDemoSeed": bool(r.is_demo_seed),
    }


@router.get("/drift", response_model=PolicyDriftResponse)
async def get_policy_drift(session: AsyncSession = Depends(get_session)):
    items = await policy_drift(session)
    return {"items": items, "total": len(items)}


@router.post("/refresh", response_model=PolicyRefreshResponse)
async def post_policy_refresh(sku: str | None = None, node: str | None = None, session: AsyncSession = Depends(get_session)):
    snapshots = await refresh_policy(session, sku, node, computed_at=datetime.now(timezone.utc).replace(tzinfo=None))
    items = [{
        "skuCode": s.sku_code, "node": s.node_code, "computedAt": s.computed_at,
        "reviewPeriodDays": float(s.review_period_days), "serviceLevel": float(s.service_level), "zScore": float(s.z_score),
        "addRolling": float(s.add_rolling), "rmseD": float(s.rmse_d), "lActual": float(s.l_actual),
        "rmseLt": float(s.rmse_lt), "fillRate": float(s.fill_rate),
        "safetyStock": float(s.safety_stock),
        "baseRop": float(s.base_rop), "totalShelfLifeDays": float(s.total_shelf_life_days),
        "minShelfLifeRequiredDays": float(s.min_shelf_life_required_days),
        "maxHoldableStock": float(s.max_holdable_stock), "enhancedRop": float(s.enhanced_rop),
        "eoq": float(s.eoq), "rawMax": float(s.raw_max), "warehouseCapacityQty": float(s.warehouse_capacity_qty),
        "shelfLifeCapacityQty": float(s.shelf_life_capacity_qty), "finalMax": float(s.final_max),
    } for s in snapshots]
    return {"items": items, "total": len(items)}


@router.get("/recommendations", response_model=PolicyRecommendationsResponse)
async def get_policy_recommendations(sku: str | None = None, node: str | None = None, session: AsyncSession = Depends(get_session)):
    """CHEAP READ ONLY - reads whatever the last POST /policy/recommendations/refresh
    persisted. Deliberately does NOT compute (that pass runs real Monte Carlo
    simulations per SKU/node and can take real time - see
    policy_recommendation_service module docstring), so this stays safe for a
    fetch-on-mount page load."""
    query = select(PolicyRecommendation)
    if sku:
        query = query.where(PolicyRecommendation.sku_code == sku)
    if node:
        query = query.where(PolicyRecommendation.node_code == node)
    rows = (await session.scalars(query.order_by(PolicyRecommendation.sku_code, PolicyRecommendation.node_code))).all()
    items = [_recommendation_item(r) for r in rows]
    return {"items": items, "total": len(items)}


@router.post("/recommendations/refresh", response_model=PolicyRecommendationsRefreshResponse)
async def post_recommendations_refresh(sku: str | None = None, node: str | None = None, seed: int | None = None,
                                        nRuns: int | None = None, horizonDays: int | None = None,
                                        session: AsyncSession = Depends(get_session)):
    """The expensive pass: simulates the current policy (and, when it scores
    below 80, every other applicable policy type) for every SKU/node -
    explicit POST, never triggered implicitly by the GET above. See
    policy_recommendation_service.refresh_recommendations for the per-pair
    decision logic and robustness_service.determine_governance_action for
    the 4-tier outcome."""
    started = time.monotonic()
    _recs, tier_counts, total_sims = await refresh_recommendations(
        session, sku, node, computed_at=datetime.now(timezone.utc).replace(tzinfo=None),
        seed=seed, n_runs=nRuns, horizon_days=horizonDays,
    )
    duration = time.monotonic() - started
    return {
        "total": len(_recs), "durationSeconds": round(duration, 3),
        "totalSimulations": total_sims, "tierCounts": tier_counts,
    }


@router.get("/audit-log", response_model=PolicyAuditLogResponse)
async def get_policy_audit_log(sku: str | None = None, node: str | None = None, session: AsyncSession = Depends(get_session)):
    rows = await robustness_service.get_audit_log(session, sku, node)
    items = [{
        "id": str(a.id), "skuCode": a.sku_code, "nodeCode": a.node_code,
        "oldPolicyType": a.old_policy_type, "oldParams": a.old_params,
        "newPolicyType": a.new_policy_type, "newParams": a.new_params,
        "robustnessScoreAtChange": float(a.robustness_score_at_change),
        "changedAt": a.changed_at, "changedBy": a.changed_by, "isDemoSeed": bool(a.is_demo_seed),
    } for a in rows]
    return {"items": items, "total": len(items)}


@router.post("/approve-change", response_model=PolicyApproveChangeResponse)
async def post_approve_change(payload: PolicyApproveChangeRequest = Body(...), session: AsyncSession = Depends(get_session)):
    changed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    audit = await robustness_service.approve_pending_change(
        session, sku_code=payload.skuCode, node_code=payload.nodeCode,
        changed_by=payload.approvedBy or "planner_approval", changed_at=changed_at,
        robustness_score=payload.robustnessScore,
    )
    if audit is None:
        return {"applied": False, "audit": None}
    return {
        "applied": True,
        "audit": {
            "id": str(audit.id), "skuCode": audit.sku_code, "nodeCode": audit.node_code,
            "oldPolicyType": audit.old_policy_type, "oldParams": audit.old_params,
            "newPolicyType": audit.new_policy_type, "newParams": audit.new_params,
            "robustnessScoreAtChange": float(audit.robustness_score_at_change),
            "changedAt": audit.changed_at, "changedBy": audit.changed_by,
        },
    }
