import uuid
from datetime import date
from decimal import Decimal
from sqlalchemy import Boolean, Date, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class IdMixin:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)


class Node(IdMixin, Base):
    __tablename__ = "nodes"
    node_code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Sku(IdMixin, Base):
    __tablename__ = "skus"
    sku_code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Backfilled in Phase 3 from sku.json's existing classification field, for service-level lookup.
    classification: Mapped[str | None] = mapped_column(String(30), nullable=True)


class Area(IdMixin, Base):
    __tablename__ = "areas"
    area_code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(20))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Zone(IdMixin, Base):
    __tablename__ = "zones"
    zone_code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(255))
    face: Mapped[str] = mapped_column(String(10))
    area_code: Mapped[str] = mapped_column(ForeignKey("areas.area_code"), index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class BinType(IdMixin, Base):
    __tablename__ = "bin_types"
    type_code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(255))
    max_volume_m3: Mapped[Decimal] = mapped_column(Numeric(12, 3))
    max_weight_kg: Mapped[Decimal] = mapped_column(Numeric(12, 3))
    bin_pallet_capacity: Mapped[int]
    storage_hu_type: Mapped[str] = mapped_column(String(10))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Bin(IdMixin, Base):
    __tablename__ = "bins"
    bin_code: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(255))
    type_code: Mapped[str] = mapped_column(ForeignKey("bin_types.type_code"))
    zone_code: Mapped[str] = mapped_column(ForeignKey("zones.zone_code"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")


class InventoryPosition(IdMixin, Base):
    __tablename__ = "inventory_positions"
    __table_args__ = (UniqueConstraint("source_id", name="uq_inventory_position_source_id"),)
    source_id: Mapped[str] = mapped_column(String(80))
    sku_code: Mapped[str] = mapped_column(ForeignKey("skus.sku_code"), index=True)
    node_code: Mapped[str] = mapped_column(ForeignKey("nodes.node_code"), index=True)
    bin_code: Mapped[str] = mapped_column(ForeignKey("bins.bin_code"), index=True)
    batch_code: Mapped[str] = mapped_column(String(100))
    on_hand: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    on_order: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    in_transit: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    allocated: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    available: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    backorder: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    inventory_position: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    status: Mapped[str] = mapped_column(String(30), default="Healthy")
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
