import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class SimulationRun(Base):
    """One Monte Carlo simulation batch, persisted for reproducibility: the
    exact seed/N/horizon/SKU-node set requested, so results can always be
    traced back to how they were produced - the Phase 5 equivalent of
    Phase 4's OptimizationRun."""
    __tablename__ = "simulation_runs"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    requested_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    seed: Mapped[int] = mapped_column(Integer)
    n_runs: Mapped[int] = mapped_column(Integer)
    horizon_days: Mapped[int] = mapped_column(Integer)
    sku_codes: Mapped[list] = mapped_column(JSON)
    node_codes: Mapped[list] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20))  # "completed" | "failed"
    duration_seconds: Mapped[Decimal] = mapped_column(Numeric(10, 3))
    detail: Mapped[str] = mapped_column(String(255), default="")


class SimulationResult(Base):
    """One (SKU, node, policy_role) row of aggregated Monte Carlo metrics for
    one SimulationRun. policy_role is "current" (whatever policy_type/params
    the SKU/node's latest PolicySnapshot is stored under - "s_S" for every
    SKU so far, since that's the only type this system has used until now)
    or "suggested" (Part B's policy_recommendation_service output). Both
    policy_type and policy_params are stored per row (not just a label) so
    the comparison UI can show the actual policy definitions being compared,
    not just their names."""
    __tablename__ = "simulation_results"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("simulation_runs.id"), index=True)
    sku_code: Mapped[str] = mapped_column(ForeignKey("skus.sku_code"), index=True)
    node_code: Mapped[str] = mapped_column(ForeignKey("nodes.node_code"), index=True)
    policy_role: Mapped[str] = mapped_column(String(20))  # "current" | "suggested"
    policy_type: Mapped[str] = mapped_column(String(20))  # "s_S" | "s_Q" | "R_S" | "R_s_S" | "base_stock"
    policy_params: Mapped[dict] = mapped_column(JSON)
    service_level_achieved: Mapped[Decimal] = mapped_column(Numeric(6, 4))
    avg_ending_inventory: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    total_holding_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    total_shortage_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    p95_shortage_qty: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    # Phase 6: Robustness Score (0-100 composite + its 5 weighted components),
    # computed from the full per-trajectory array before it's discarded - see
    # app/services/robustness_service.py for the exact formula/weights.
    composite_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    service_stability: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    stockout_resilience: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    cost_stability: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    expiry_robustness: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    inventory_stability: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    # Governance tier derived from the CURRENT policy's composite_score - only
    # ever set on the policy_role="current" row (None on "suggested" rows,
    # since governance decides whether to change FROM current, not about
    # suggested's own standing).
    governance_action: Mapped[str | None] = mapped_column(String(30), nullable=True)
