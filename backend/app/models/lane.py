from decimal import Decimal
from sqlalchemy import ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.models.network import IdMixin


class Lane(IdMixin, Base):
    """A directed inter-node transit lane: transit time and per-unit cost for
    moving stock from source_node_code to dest_node_code. Seeded from the
    lead-time figures already hardcoded in NodeSelection.jsx's
    PLANT_TO_DC_LEAD_TIMES / DC-to-DC transfer logic - documented, not invented."""
    __tablename__ = "lanes"
    __table_args__ = (UniqueConstraint("source_node_code", "dest_node_code", name="uq_lane_source_dest"),)
    source_node_code: Mapped[str] = mapped_column(ForeignKey("nodes.node_code"), index=True)
    dest_node_code: Mapped[str] = mapped_column(ForeignKey("nodes.node_code"), index=True)
    transit_days: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    cost_per_unit: Mapped[Decimal] = mapped_column(Numeric(10, 4))
    lane_type: Mapped[str] = mapped_column(String(20), default="DC_TO_DC")
