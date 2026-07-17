import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.fill_rate.db import Base


class IdMixin:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)


class SalesOrder(IdMixin, Base):
    """L1 Fill Rate's authoritative sales-order schema, matching
    seed_data/Order_File_Week1.xlsx's real "Orders" sheet exactly - see
    docs/implementation-status.md for the file's column layout."""
    __tablename__ = "sales_orders"
    order_id: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    order_date: Mapped[date] = mapped_column(Date)
    day: Mapped[str | None] = mapped_column(String(10), nullable=True)
    sku_code: Mapped[str] = mapped_column(String(80), index=True)
    sku_name: Mapped[str] = mapped_column(String(255))
    node: Mapped[str] = mapped_column(String(120), index=True)
    requested_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3))


class GoodsSent(IdMixin, Base):
    """Matches seed_data/Goods_Sent_Register.xlsx exactly - that file has ONLY
    Order ID and Qty Shipped, no SKU/Node/Date columns of its own; those come
    from the joined SalesOrder row via order_id."""
    __tablename__ = "goods_sent"
    order_id: Mapped[str] = mapped_column(ForeignKey("sales_orders.order_id"), index=True)
    shipped_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3))


class PurchaseOrder(IdMixin, Base):
    __tablename__ = "purchase_orders"
    po_number: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    sku_code: Mapped[str] = mapped_column(String(80), index=True)
    node_code: Mapped[str] = mapped_column(String(80), index=True)
    supplier_code: Mapped[str] = mapped_column(String(80))
    order_date: Mapped[date] = mapped_column(Date)
    ordered_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    expected_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="OPEN")


class GoodsReceipt(IdMixin, Base):
    __tablename__ = "goods_receipts"
    purchase_order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchase_orders.id"), index=True)
    received_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    receipt_date: Mapped[date] = mapped_column(Date)
    grn_reference: Mapped[str | None] = mapped_column(String(80), nullable=True)


class InventorySnapshot(IdMixin, Base):
    """L2 Days of Supply's authoritative schema, matching
    seed_data/Inventory_Snapshot.xlsx's real "Inventory Snapshot Register" sheet
    exactly - no Node column of its own (same single-node dataset as SalesOrder;
    see SalesOrder.node's docstring)."""
    __tablename__ = "inventory_snapshots"
    __table_args__ = (UniqueConstraint("sku_code", "snapshot_date", name="uq_inventory_snapshot_sku_date"),)
    snapshot_date: Mapped[date] = mapped_column(Date, index=True)
    day: Mapped[str | None] = mapped_column(String(10), nullable=True)
    sku_code: Mapped[str] = mapped_column(String(80), index=True)
    sku_name: Mapped[str] = mapped_column(String(255))
    on_hand_before_shipment: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    qty_shipped: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    on_hand_eod: Mapped[Decimal] = mapped_column(Numeric(18, 3))


class DemandForecast(IdMixin, Base):
    """L3 Driver 1/5's authoritative demand-forecast schema, matching
    seed_data/Demand_Forecast_Data.xlsx exactly - WIDE format, one row per SKU with
    4 weekly forecast columns (not one row per day/period). The file's 8th
    "Forecast Basis" column is descriptive-only and isn't stored here."""
    __tablename__ = "demand_forecasts"
    sku_code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    sku_name: Mapped[str] = mapped_column(String(255))
    node: Mapped[str] = mapped_column(String(120))
    week1_forecast: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    week2_forecast: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    week3_forecast: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    week4_forecast: Mapped[Decimal] = mapped_column(Numeric(18, 3))


class LeadTimeBaseline(IdMixin, Base):
    """Driver 4's drift baseline - one row per SKU, self-contained WITHIN
    fill_rate_db. Deliberately does not reference or read the main app's Phase-3
    lead-time policy data, per the module's database-isolation requirement."""
    __tablename__ = "lead_time_baselines"
    sku_code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    baseline_rmse_lt: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    computed_at: Mapped[datetime] = mapped_column(DateTime)


class DemandBaseline(IdMixin, Base):
    """Driver 5's drift baseline - same self-contained, one-row-per-SKU pattern as
    LeadTimeBaseline, applied to demand RMSE instead of lead-time RMSE."""
    __tablename__ = "demand_baselines"
    sku_code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    baseline_rmse_d: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    computed_at: Mapped[datetime] = mapped_column(DateTime)


class FillRateActionLog(IdMixin, Base):
    """L5 Action's audit trail - one row per applied RCA recommendation. For the
    "Policy Drift" cause, old_baseline/new_baseline record the DemandBaseline value
    actually changed; for every other cause, both stay null since those
    recommendations (expedite supply, monitor, manual review) are acknowledgments
    only, with no data mutation to record."""
    __tablename__ = "fill_rate_action_logs"
    sku_code: Mapped[str] = mapped_column(String(80), index=True)
    primary_cause: Mapped[str] = mapped_column(String(60))
    old_baseline: Mapped[Decimal | None] = mapped_column(Numeric(18, 6), nullable=True)
    new_baseline: Mapped[Decimal | None] = mapped_column(Numeric(18, 6), nullable=True)
    action_taken: Mapped[str] = mapped_column(String(120))
    approved_by: Mapped[str] = mapped_column(String(120))
    approved_at: Mapped[datetime] = mapped_column(DateTime)
