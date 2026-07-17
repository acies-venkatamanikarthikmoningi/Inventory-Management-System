import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class DemandObservation(Base):
    """One trailing daily actual-vs-forecast demand fact for a SKU/node.

    Seeded/simulated: no real historical demand feed exists in this repo yet.
    actual_qty vs forecast_qty lets RMSE_D measure forecast ERROR, not raw
    demand variability, per the enhanced Safety Stock formula.
    """
    __tablename__ = "demand_observations"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sku_code: Mapped[str] = mapped_column(ForeignKey("skus.sku_code"), index=True)
    node_code: Mapped[str] = mapped_column(ForeignKey("nodes.node_code"), index=True)
    observed_date: Mapped[date] = mapped_column(Date, index=True)
    forecast_qty: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    actual_qty: Mapped[Decimal] = mapped_column(Numeric(14, 3))


class LeadTimeObservation(Base):
    """One trailing delivery fact for a SKU/node: promised vs actual lead time,
    plus ordered/received quantities so fill rate can be derived from the same
    real per-delivery record instead of a separate table. Seeded/simulated,
    same honesty standard as DemandObservation.
    """
    __tablename__ = "lead_time_observations"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sku_code: Mapped[str] = mapped_column(ForeignKey("skus.sku_code"), index=True)
    node_code: Mapped[str] = mapped_column(ForeignKey("nodes.node_code"), index=True)
    order_date: Mapped[date] = mapped_column(Date, index=True)
    promised_lead_time_days: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    actual_lead_time_days: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    ordered_qty: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    received_qty: Mapped[Decimal] = mapped_column(Numeric(14, 3))


class SkuCostProfile(Base):
    """Unit cost / holding / ordering cost inputs for EOQ, plus (Phase 4) the
    shortage/expiry penalty and MOQ inputs the MEIO objective/constraints need.
    Seeded/simulated: no real costing data exists in this repo yet (checked
    sku.json and every src/data/*.json file - none carry a cost, price, MOQ,
    or penalty field)."""
    __tablename__ = "sku_cost_profiles"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sku_code: Mapped[str] = mapped_column(ForeignKey("skus.sku_code"), unique=True, index=True)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    holding_cost_pct: Mapped[Decimal] = mapped_column(Numeric(5, 4))
    ordering_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    # Phase 4 MEIO additions:
    shortage_penalty_per_unit: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    expiry_penalty_per_unit: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    moq_units: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)


class PolicySnapshot(Base):
    """A versioned, auditable record of one SS/ROP/MAX computation, with every
    intermediate value exposed so later drift comparisons and audits don't
    need to recompute anything — they just diff two rows."""
    __tablename__ = "policy_snapshots"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sku_code: Mapped[str] = mapped_column(ForeignKey("skus.sku_code"), index=True)
    node_code: Mapped[str] = mapped_column(ForeignKey("nodes.node_code"), index=True)
    computed_at: Mapped[datetime] = mapped_column(DateTime, index=True)

    review_period_days: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    service_level: Mapped[Decimal] = mapped_column(Numeric(6, 4))
    z_score: Mapped[Decimal] = mapped_column(Numeric(7, 4))

    add_rolling: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    rmse_d: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    l_actual: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    rmse_lt: Mapped[Decimal] = mapped_column(Numeric(7, 3))
    fill_rate: Mapped[Decimal] = mapped_column(Numeric(6, 4))

    safety_stock: Mapped[Decimal] = mapped_column(Numeric(14, 3))

    base_rop: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    total_shelf_life_days: Mapped[Decimal] = mapped_column(Numeric(7, 2))
    min_shelf_life_required_days: Mapped[Decimal] = mapped_column(Numeric(7, 2))
    max_holdable_stock: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    enhanced_rop: Mapped[Decimal] = mapped_column(Numeric(14, 3))

    eoq: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    raw_max: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    warehouse_capacity_qty: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    shelf_life_capacity_qty: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    final_max: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    # Phase 5 addition: which of the 5 named policy types (see
    # policy_service.POLICY_TYPES) this snapshot's s/S/Q/R values are stored
    # under. Assigned per Phase 6's classification-driven rule
    # (policy_service.initial_policy_type_for_classification) whenever a
    # snapshot is (re)computed; defaults to "s_S" only when classification is
    # unset. Also the row Phase 6's governance auto-apply/approval paths
    # rewrite via policy_service.apply_policy_type_change() when a policy
    # type is actually changed.
    policy_type: Mapped[str] = mapped_column(String(20), default="s_S")


class PolicyRecommendation(Base):
    """One persisted policy-type EVALUATION for a SKU/node (Phase 6.1): the
    policy type currently in use vs. the best-scoring alternative the
    simulator found (if any - see policy_recommendation_service
    .evaluate_sku_node), both with their concrete parameters and full
    Robustness Score breakdowns, plus the human-readable reasoning and the
    resulting governance_action. suggested_* columns are nullable: a SKU/node
    with no genuinely-better alternative (no_change_needed or
    no_better_alternative_found) legitimately has no suggestion - that is not
    a missing-data bug, it's an honest "nothing better exists" result."""
    __tablename__ = "policy_recommendations"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sku_code: Mapped[str] = mapped_column(ForeignKey("skus.sku_code"), index=True)
    node_code: Mapped[str] = mapped_column(ForeignKey("nodes.node_code"), index=True)
    computed_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    current_policy_type: Mapped[str] = mapped_column(String(20))
    suggested_policy_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    current_params: Mapped[dict] = mapped_column(JSON)
    suggested_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reasoning: Mapped[str] = mapped_column(Text)
    # Phase 6.1: governance tier + full Robustness Score breakdown for both
    # policies, computed by evaluate_sku_node's simulation pass (not the old
    # cheap business rule) - see robustness_service.determine_governance_action
    # for the 4-tier decision this is stored as.
    governance_action: Mapped[str] = mapped_column(String(30), default="no_change_needed")
    current_composite_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    current_service_stability: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    current_stockout_resilience: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    current_cost_stability: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    current_expiry_robustness: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    current_inventory_stability: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    current_service_level_achieved: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=0)
    current_total_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    # Cost breakdown (holding + shortage = total) for the collapsible cost
    # detail on the Policy Robustness card - the simulator already computes
    # both sub-components (app/simulation/policy_simulator.py's
    # simulate_policy), this just persists them alongside the total.
    current_total_holding_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    current_total_shortage_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    suggested_composite_score: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    suggested_service_stability: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    suggested_stockout_resilience: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    suggested_cost_stability: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    suggested_expiry_robustness: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    suggested_inventory_stability: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    suggested_service_level_achieved: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)
    suggested_total_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    suggested_total_holding_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    suggested_total_shortage_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    # Showcase/demo data flag (app/seed/demo_robustness_showcase.py): a row
    # with is_demo_seed=True was NOT produced by evaluate_sku_node/the real
    # Monte Carlo pipeline - its scores/params are hand-authored for a
    # presentable demo card. refresh_recommendations() skips any SKU/node
    # pair whose existing row already has this flag set, so a real
    # network-wide re-evaluation can never silently overwrite or conflict
    # with a showcase card. A DATA-level flag, not just a code comment, so
    # these rows stay identifiable/removable programmatically later.
    is_demo_seed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class PolicyChangeAuditLog(Base):
    """An IMMUTABLE record of every policy-type change Phase 6's governance
    system makes to a SKU/node - whether applied automatically (composite
    Robustness Score < 40, changed_by="system_auto_governance") or by an
    explicit human approval (40-80 tier, changed_by=the approver). Rows are
    only ever inserted, never updated or deleted - see
    app/services/robustness_service.py."""
    __tablename__ = "policy_change_audit_log"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sku_code: Mapped[str] = mapped_column(ForeignKey("skus.sku_code"), index=True)
    node_code: Mapped[str] = mapped_column(ForeignKey("nodes.node_code"), index=True)
    old_policy_type: Mapped[str] = mapped_column(String(20))
    old_params: Mapped[dict] = mapped_column(JSON)
    new_policy_type: Mapped[str] = mapped_column(String(20))
    new_params: Mapped[dict] = mapped_column(JSON)
    robustness_score_at_change: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    changed_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    changed_by: Mapped[str] = mapped_column(String(50))
    # Same showcase/demo flag as PolicyRecommendation.is_demo_seed above -
    # set on the demo audit-log rows app/seed/demo_robustness_showcase.py
    # writes for its Part B (auto-approved) showcase cards, so a card's
    # "View audit log entry" click-through shows a consistent, identifiably-
    # demo record rather than nothing.
    is_demo_seed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
