from datetime import datetime
from sqlalchemy import select
from app.models import PolicyChangeAuditLog, PolicyRecommendation, PolicySnapshot
from app.services import robustness_service
from tests.conftest import seed_node, seed_sku

SKU = "SKU-GOV"
NODE = "NODE-GOV"


def _snapshot(sku_code, node_code, policy_type, computed_at):
    return PolicySnapshot(
        sku_code=sku_code, node_code=node_code, computed_at=computed_at,
        review_period_days=7.0, service_level=0.95, z_score=1.645,
        add_rolling=100.0, rmse_d=10.0, l_actual=5.0, rmse_lt=1.0, fill_rate=0.9,
        safety_stock=200.0, base_rop=1000.0, total_shelf_life_days=90.0,
        min_shelf_life_required_days=54.0, max_holdable_stock=99999.0, enhanced_rop=1000.0,
        eoq=500.0, raw_max=1500.0, warehouse_capacity_qty=99999.0, shelf_life_capacity_qty=99999.0,
        final_max=1500.0, policy_type=policy_type,
    )


async def _seed(session):
    await seed_sku(session, SKU, description="Governance Test SKU")
    await seed_node(session, NODE)
    session.add(_snapshot(SKU, NODE, "s_S", datetime.now()))
    await session.commit()


def _recommendation(*, current_type="s_S", suggested_type, current_score, suggested_score, governance_action):
    return PolicyRecommendation(
        sku_code=SKU, node_code=NODE, computed_at=datetime.now(),
        current_policy_type=current_type, suggested_policy_type=suggested_type,
        current_params={"s": 1000, "S": 1500}, suggested_params={"R": 7, "s": 1000, "S": 1600} if suggested_type else None,
        reasoning="test reasoning", governance_action=governance_action,
        current_composite_score=current_score,
        current_service_stability=90, current_stockout_resilience=90, current_cost_stability=90,
        current_expiry_robustness=90, current_inventory_stability=90,
        current_service_level_achieved=0.9, current_total_cost=1000,
        suggested_composite_score=suggested_score,
        suggested_service_stability=90 if suggested_score else None,
        suggested_stockout_resilience=90 if suggested_score else None,
        suggested_cost_stability=90 if suggested_score else None,
        suggested_expiry_robustness=90 if suggested_score else None,
        suggested_inventory_stability=90 if suggested_score else None,
        suggested_service_level_achieved=0.95 if suggested_score else None,
        suggested_total_cost=900 if suggested_score else None,
    )


# --- compute_robustness_score formula (unchanged from prior task) ---

def test_perfect_policy_scores_100_composite():
    scores = robustness_service.compute_robustness_score(
        service_level_achieved=0.95, target_service_level=0.95, stockout_rate=0.0,
        mean_total_cost=1000.0, std_total_cost=0.0, expiry_loss_rate=0.0,
        avg_ending_inventory=500.0, std_ending_inventory=0.0,
    )
    assert scores["composite_score"] == 100.0


def test_composite_uses_specified_weights():
    scores = robustness_service.compute_robustness_score(
        service_level_achieved=0.50, target_service_level=1.00, stockout_rate=0.5,
        mean_total_cost=1000.0, std_total_cost=500.0, expiry_loss_rate=0.2,
        avg_ending_inventory=200.0, std_ending_inventory=40.0,
    )
    expected = (
        0.30 * scores["service_stability"] + 0.25 * scores["stockout_resilience"]
        + 0.20 * scores["cost_stability"] + 0.15 * scores["expiry_robustness"]
        + 0.10 * scores["inventory_stability"]
    )
    assert scores["composite_score"] == expected


# --- determine_governance_action: the true 4-tier decision ---

def test_governance_no_change_needed_ignores_alternative_score():
    assert robustness_service.determine_governance_action(100, None) == "no_change_needed"
    assert robustness_service.determine_governance_action(80, 40) == "no_change_needed"  # >=80 short-circuits


def test_governance_suggest_pending_approval_requires_alt_clearing_both_bars():
    assert robustness_service.determine_governance_action(65, 85) == "suggest_pending_approval"
    assert robustness_service.determine_governance_action(40, 80.01) == "suggest_pending_approval"


def test_governance_no_better_alternative_found_when_alt_doesnt_clear_bars():
    assert robustness_service.determine_governance_action(65, 79.99) == "no_better_alternative_found"  # alt<80
    assert robustness_service.determine_governance_action(65, 60) == "no_better_alternative_found"  # alt<current
    assert robustness_service.determine_governance_action(79.99, 79.99) == "no_better_alternative_found"  # not strictly greater
    assert robustness_service.determine_governance_action(65, None) == "no_better_alternative_found"


def test_governance_auto_changed_below_40_regardless_of_alt_quality():
    assert robustness_service.determine_governance_action(39.99, 10) == "auto_changed"  # mediocre best still applies
    assert robustness_service.determine_governance_action(0, 5) == "auto_changed"


# --- the 3 explicitly required boundary cases (scores 35 / 65 / 90) ---

def test_score_35_is_auto_changed():
    assert robustness_service.determine_governance_action(35, 82) == "auto_changed"


def test_score_65_with_qualifying_alt_is_pending_approval():
    assert robustness_service.determine_governance_action(65, 85) == "suggest_pending_approval"


def test_score_90_is_no_change_needed():
    assert robustness_service.determine_governance_action(90, None) == "no_change_needed"


# --- apply_auto_change: mutation + audit, no internal tier re-check ---

async def test_apply_auto_change_creates_new_snapshot_and_audit_row(session):
    await _seed(session)
    audit = await robustness_service.apply_auto_change(
        session, sku_code=SKU, node_code=NODE, old_policy_type="s_S", old_params={"s": 1000, "S": 1500},
        new_policy_type="R_s_S", new_params={"R": 7, "s": 1000, "S": 1600}, composite_score=35.0,
        changed_at=datetime.now(),
    )
    await session.commit()

    assert audit is not None
    assert audit.old_policy_type == "s_S"
    assert audit.new_policy_type == "R_s_S"
    assert audit.changed_by == robustness_service.SYSTEM_CHANGED_BY
    assert float(audit.robustness_score_at_change) == 35.0

    latest = (await session.scalars(
        select(PolicySnapshot).where(PolicySnapshot.sku_code == SKU, PolicySnapshot.node_code == NODE)
        .order_by(PolicySnapshot.computed_at.desc())
    )).first()
    assert latest.policy_type == "R_s_S"
    assert float(latest.enhanced_rop) == 1000.0  # underlying computed values preserved

    audit_rows = (await session.scalars(select(PolicyChangeAuditLog).where(PolicyChangeAuditLog.sku_code == SKU))).all()
    assert len(audit_rows) == 1


async def test_apply_auto_change_skipped_when_types_already_match(session):
    await _seed(session)
    audit = await robustness_service.apply_auto_change(
        session, sku_code=SKU, node_code=NODE, old_policy_type="s_S", old_params={"s": 1000, "S": 1500},
        new_policy_type="s_S", new_params={"s": 1000, "S": 1500}, composite_score=10.0, changed_at=datetime.now(),
    )
    await session.commit()
    assert audit is None
    audit_rows = (await session.scalars(select(PolicyChangeAuditLog).where(PolicyChangeAuditLog.sku_code == SKU))).all()
    assert len(audit_rows) == 0


# --- approve_change: human-approval path, always applies ---

async def test_approve_change_applies_and_attributes_to_human(session):
    await _seed(session)
    audit = await robustness_service.approve_change(
        session, sku_code=SKU, node_code=NODE, current_policy_type="s_S", current_params={"s": 1000, "S": 1500},
        suggested_policy_type="R_s_S", suggested_params={"R": 7, "s": 1000, "S": 1600},
        robustness_score=65.0, changed_at=datetime.now(), changed_by="fathina.iffat",
    )
    await session.commit()
    assert audit is not None
    assert audit.changed_by == "fathina.iffat"
    assert audit.new_policy_type == "R_s_S"


# --- approve_pending_change: reads the last PERSISTED evaluation, not a live recompute ---

async def test_approve_pending_change_reads_persisted_recommendation(session):
    await _seed(session)
    session.add(_recommendation(suggested_type="R_s_S", current_score=65.0, suggested_score=85.0,
                                 governance_action="suggest_pending_approval"))
    await session.commit()

    audit = await robustness_service.approve_pending_change(
        session, sku_code=SKU, node_code=NODE, changed_by="fathina.iffat", changed_at=datetime.now(),
        robustness_score=65.0,
    )

    assert audit is not None
    assert audit.old_policy_type == "s_S"
    assert audit.new_policy_type == "R_s_S"
    assert audit.changed_by == "fathina.iffat"
    audit_rows = (await session.scalars(select(PolicyChangeAuditLog).where(PolicyChangeAuditLog.sku_code == SKU))).all()
    assert len(audit_rows) == 1


async def test_approve_pending_change_none_when_no_suggestion_persisted(session):
    await _seed(session)
    session.add(_recommendation(suggested_type=None, current_score=90.0, suggested_score=None,
                                 governance_action="no_change_needed"))
    await session.commit()

    audit = await robustness_service.approve_pending_change(
        session, sku_code=SKU, node_code=NODE, changed_by="fathina.iffat", changed_at=datetime.now(),
    )
    assert audit is None


async def test_approve_pending_change_none_when_no_recommendation_exists(session):
    await _seed(session)
    audit = await robustness_service.approve_pending_change(
        session, sku_code=SKU, node_code=NODE, changed_by="fathina.iffat", changed_at=datetime.now(),
    )
    assert audit is None


# --- get_audit_log ---

async def test_get_audit_log_filters_by_sku_and_node(session):
    await _seed(session)
    await robustness_service.apply_auto_change(
        session, sku_code=SKU, node_code=NODE, old_policy_type="s_S", old_params={},
        new_policy_type="R_s_S", new_params={}, composite_score=20.0, changed_at=datetime.now(),
    )
    await session.commit()

    rows = await robustness_service.get_audit_log(session, sku_code=SKU, node_code=NODE)
    assert len(rows) == 1
    rows_other = await robustness_service.get_audit_log(session, sku_code="SKU-NOPE")
    assert len(rows_other) == 0
