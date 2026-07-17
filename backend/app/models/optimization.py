import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class OptimizationRun(Base):
    """One MEIO solve, persisted for reproducibility: exactly what was asked
    (node/SKU set, horizon, scenario set) and what came back (solver status,
    objective, wall-clock solve time), so /recommendations can always trace
    back to the run that produced them."""
    __tablename__ = "optimization_runs"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    requested_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    node_codes: Mapped[list] = mapped_column(JSON)
    sku_codes: Mapped[list] = mapped_column(JSON)
    horizon_days: Mapped[int] = mapped_column(Integer)
    scenario_set: Mapped[list] = mapped_column(JSON)
    solver_status: Mapped[str] = mapped_column(String(20))
    objective_value: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    solve_seconds: Mapped[Decimal] = mapped_column(Numeric(10, 3))
    detail: Mapped[str] = mapped_column(String(255), default="")


class OptimizationRecommendation(Base):
    """One planner-readable recommendation (a replenishment order or an
    inter-node transfer) produced by one OptimizationRun's solved solution."""
    __tablename__ = "optimization_recommendations"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("optimization_runs.id"), index=True)
    recommendation_type: Mapped[str] = mapped_column(String(20))  # "REPLENISH" | "TRANSFER"
    sku_code: Mapped[str] = mapped_column(ForeignKey("skus.sku_code"), index=True)
    node_code: Mapped[str] = mapped_column(ForeignKey("nodes.node_code"), index=True)  # REPLENISH: the node; TRANSFER: destination
    source_node_code: Mapped[str | None] = mapped_column(ForeignKey("nodes.node_code"), nullable=True)  # TRANSFER only
    period_index: Mapped[int] = mapped_column(Integer)
    scenario_name: Mapped[str] = mapped_column(String(30))
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3))
