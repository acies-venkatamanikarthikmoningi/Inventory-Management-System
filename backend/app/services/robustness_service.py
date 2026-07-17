"""Phase 6: Robustness Score + Governance.

Robustness Score is a single composite 0-100 number per (SKU, node, policy)
summarizing how that policy performs across many random Monte Carlo
trajectories (app/simulation/policy_simulator.py) - not just its mean
outcome. The formula and weights are a fixed requirement, not tunable:

  Robustness Score = 0.30*ServiceStability + 0.25*StockoutResilience
                    + 0.20*CostStability + 0.15*ExpiryRobustness
                    + 0.10*InventoryStability

Phase 6.1 refinement: governance is now a 4-tier decision that also asks
"is there something demonstrably BETTER?" (see
policy_recommendation_service.evaluate_sku_node for where the candidate
search happens) rather than only looking at the current policy's own score:

  current >= 80                                          -> no_change_needed
  40 <= current < 80, a candidate scores >=80 AND beats
    current                                               -> suggest_pending_approval
  40 <= current < 80, no candidate clears both bars        -> no_better_alternative_found
  current < 40                                            -> auto_changed (applies the
                                                              best-scoring candidate found,
                                                              regardless of whether IT
                                                              clears 80 - some action is
                                                              mandated at this tier)

A suggestion is therefore only ever surfaced (suggest_pending_approval or
auto_changed) when best_alternative_score is not None; the >=80-and-beats-
current bar for the 40-80 tier is enforced HERE, not left to the caller -
best_alternative_score passed in for that tier must already satisfy both
conditions, or governance correctly reports no_better_alternative_found
instead of implying something actionable exists.

determine_governance_action() below is the pure decision function;
apply_auto_change()/approve_change() perform the actual mutation + audit
logging once a caller has already decided which tier applies - they do not
re-derive the tier themselves.
"""
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import PolicyChangeAuditLog, PolicyRecommendation
from app.services import policy_service

GOVERNANCE_AUTO_THRESHOLD = 40.0
GOVERNANCE_APPROVAL_THRESHOLD = 80.0
SYSTEM_CHANGED_BY = "system_auto_governance"


def compute_robustness_score(*, service_level_achieved: float, target_service_level: float,
                              stockout_rate: float, mean_total_cost: float, std_total_cost: float,
                              expiry_loss_rate: float, avg_ending_inventory: float,
                              std_ending_inventory: float) -> dict:
    service_stability = min(100.0, (service_level_achieved / target_service_level) * 100) if target_service_level > 0 else 0.0

    stockout_resilience = (1.0 - stockout_rate) * 100

    cv_cost = (std_total_cost / mean_total_cost) if mean_total_cost > 0 else 0.0
    cost_stability = max(0.0, min(100.0, 100 * (1 - cv_cost)))

    expiry_robustness = (1.0 - expiry_loss_rate) * 100

    # normalized_variability = ending-inventory CV expressed as a percentage,
    # capped at 100 BEFORE subtracting from 100 - the spec leaves the exact
    # normalization unspecified beyond "capped at 100 before subtracting", so
    # this is documented explicitly: a policy whose ending-inventory CV is
    # already >=100% (wildly unstable) bottoms out Inventory Stability at 0
    # via this cap, rather than going further negative and relying on the
    # outer max(0, ...) to re-clamp it - same numeric result, clearer intent.
    cv_inventory_pct = (std_ending_inventory / avg_ending_inventory * 100) if avg_ending_inventory > 0 else 0.0
    normalized_variability = min(cv_inventory_pct, 100.0)
    inventory_stability = max(0.0, 100.0 - normalized_variability)

    composite_score = (
        0.30 * service_stability + 0.25 * stockout_resilience + 0.20 * cost_stability
        + 0.15 * expiry_robustness + 0.10 * inventory_stability
    )

    return {
        "service_stability": service_stability, "stockout_resilience": stockout_resilience,
        "cost_stability": cost_stability, "expiry_robustness": expiry_robustness,
        "inventory_stability": inventory_stability, "composite_score": composite_score,
    }


def determine_governance_action(current_score: float, best_alternative_score: float | None) -> str:
    """The 4-tier decision. best_alternative_score is None when the current
    score already qualifies as no_change_needed (>=80) - by design, no
    alternative search is even performed in that case (see evaluate_sku_node),
    since nothing would be surfaced regardless of what it found.

    For current < 80, best_alternative_score is the HIGHEST composite score
    found among every other applicable policy type (regardless of whether
    that candidate itself clears 80) - the >=80-and-beats-current bar is
    enforced HERE, for the 40-80 tier only. Below 40, ANY candidate is
    applied automatically (some action is mandated at that tier), even a
    mediocre one - the caller does not need to pre-filter."""
    if current_score >= GOVERNANCE_APPROVAL_THRESHOLD:
        return "no_change_needed"
    if current_score < GOVERNANCE_AUTO_THRESHOLD:
        return "auto_changed"
    # 40 <= current_score < 80: only a genuinely better alternative (>=80 AND
    # beats current) is worth surfacing - otherwise this is honest "nothing
    # better exists" information, not the same as no_change_needed.
    if (best_alternative_score is not None and best_alternative_score >= GOVERNANCE_APPROVAL_THRESHOLD
            and best_alternative_score > current_score):
        return "suggest_pending_approval"
    return "no_better_alternative_found"


async def apply_auto_change(session: AsyncSession, *, sku_code: str, node_code: str, old_policy_type: str,
                             old_params: dict, new_policy_type: str, new_params: dict, composite_score: float,
                             changed_at: datetime) -> PolicyChangeAuditLog | None:
    """Caller (policy_recommendation_service.evaluate_sku_node) has already
    decided this pair is in the auto_changed tier - this function just does
    the mutation (policy_service.apply_policy_type_change) and writes the
    immutable audit row. No internal tier re-check. Returns None only if
    old_policy_type == new_policy_type (nothing to actually apply) or if the
    SKU/node has no existing PolicySnapshot to base the change on."""
    if old_policy_type == new_policy_type:
        return None
    new_snapshot = await policy_service.apply_policy_type_change(session, sku_code, node_code, new_policy_type, changed_at)
    if new_snapshot is None:
        return None
    audit = PolicyChangeAuditLog(
        sku_code=sku_code, node_code=node_code,
        old_policy_type=old_policy_type, old_params=old_params,
        new_policy_type=new_policy_type, new_params=new_params,
        robustness_score_at_change=round(composite_score, 2), changed_at=changed_at, changed_by=SYSTEM_CHANGED_BY,
    )
    session.add(audit)
    return audit


async def approve_change(session: AsyncSession, *, sku_code: str, node_code: str, current_policy_type: str,
                          current_params: dict, suggested_policy_type: str, suggested_params: dict,
                          robustness_score: float, changed_at: datetime, changed_by: str) -> PolicyChangeAuditLog | None:
    """Human-approval path for the suggest_pending_approval tier: applies the
    SAME suggested policy the auto-apply path would, but attributed to a
    human approver, not system_auto_governance. Always applies (the human
    already decided) - does not re-check any threshold."""
    if current_policy_type == suggested_policy_type:
        return None
    new_snapshot = await policy_service.apply_policy_type_change(session, sku_code, node_code, suggested_policy_type, changed_at)
    if new_snapshot is None:
        return None
    audit = PolicyChangeAuditLog(
        sku_code=sku_code, node_code=node_code,
        old_policy_type=current_policy_type, old_params=current_params,
        new_policy_type=suggested_policy_type, new_params=suggested_params,
        robustness_score_at_change=round(robustness_score, 2), changed_at=changed_at, changed_by=changed_by,
    )
    session.add(audit)
    return audit


async def approve_pending_change(session: AsyncSession, *, sku_code: str, node_code: str, changed_by: str,
                                  changed_at: datetime, robustness_score: float | None = None) -> PolicyChangeAuditLog | None:
    """Orchestration for POST /policy/approve-change: reads the LAST PERSISTED
    evaluation (PolicyRecommendation, written by
    policy_recommendation_service.refresh_recommendations - the network-wide
    evaluation pass) rather than recomputing live, since the suggested policy
    is now a simulation-selected "best of several candidates" result, not a
    cheap pure-function of current inputs - recomputing it here would mean
    re-running up to 4 Monte Carlo simulations just to approve a click.
    robustness_score, if passed, is the score the human actually saw when
    clicking Approve, kept purely for an accurate audit record - it does not
    gate whether the approval is honored."""
    rec = (await session.scalars(
        select(PolicyRecommendation).where(
            PolicyRecommendation.sku_code == sku_code, PolicyRecommendation.node_code == node_code
        )
    )).first()
    if rec is None or rec.suggested_policy_type is None:
        return None
    audit = await approve_change(
        session, sku_code=sku_code, node_code=node_code,
        current_policy_type=rec.current_policy_type, current_params=rec.current_params,
        suggested_policy_type=rec.suggested_policy_type, suggested_params=rec.suggested_params,
        robustness_score=robustness_score if robustness_score is not None else float(rec.current_composite_score),
        changed_at=changed_at, changed_by=changed_by,
    )
    await session.commit()
    if audit is not None:
        await session.refresh(audit)
    return audit


async def get_audit_log(session: AsyncSession, sku_code: str | None = None, node_code: str | None = None,
                         limit: int = 200) -> list[PolicyChangeAuditLog]:
    query = select(PolicyChangeAuditLog).order_by(PolicyChangeAuditLog.changed_at.desc())
    if sku_code:
        query = query.where(PolicyChangeAuditLog.sku_code == sku_code)
    if node_code:
        query = query.where(PolicyChangeAuditLog.node_code == node_code)
    return list((await session.scalars(query.limit(limit))).all())
