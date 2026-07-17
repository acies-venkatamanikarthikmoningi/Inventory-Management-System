import uuid
from datetime import date
from decimal import Decimal
from sqlalchemy import Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class Batch(Base):
    __tablename__ = "batches"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    batch_number: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    sku_code: Mapped[str] = mapped_column(ForeignKey("skus.sku_code"), index=True)
    node_code: Mapped[str] = mapped_column(ForeignKey("nodes.node_code"), index=True)
    mfg_date: Mapped[date] = mapped_column(Date)
    expiry_date: Mapped[date] = mapped_column(Date)
    shelf_life_months: Mapped[int] = mapped_column(Integer)
    total_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
