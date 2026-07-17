"""Idempotently loads the real Week 1 Fill Rate source files directly into
SalesOrder/GoodsSent/InventorySnapshot at container startup - no upload step
required for this data to appear. All three files carry trailer rows (a blank
spacer, a "Week Total Qty"/similar summary row, and a source-note footer) after
the real data; each reader skips these by only ingesting rows whose SKU/Order
identifying column looks real, rather than misreading them as data.
"""
import logging
from datetime import datetime
from pathlib import Path
from openpyxl import load_workbook
from sqlalchemy import select
from app.fill_rate.db import SessionLocal
from app.fill_rate.models import (
    DemandBaseline, DemandForecast, GoodsReceipt, GoodsSent, InventorySnapshot, LeadTimeBaseline, PurchaseOrder,
    SalesOrder,
)

logger = logging.getLogger(__name__)

SEED_DATA_DIR = Path(__file__).resolve().parent / "seed_data"
ORDER_FILE = SEED_DATA_DIR / "Order_File_Week1.xlsx"
GOODS_SENT_FILE = SEED_DATA_DIR / "Goods_Sent_Register.xlsx"
INVENTORY_SNAPSHOT_FILE = SEED_DATA_DIR / "Inventory_Snapshot.xlsx"

# These 5 baseline rows are pre-seeded demo data, standing in for a "prior
# computation" that would normally only exist after the system has been running for
# a while. Without this, Lead-Time Variability and Parameter Age can never flag on a
# first run (drift requires a prior value to compare against) - this pre-seed lets
# the demo show a realistic flagged state immediately, using specific values chosen
# so the real Week 1 data drifts >15% against them. This is clearly demo
# scaffolding, not something a production seed would normally include - a real
# deployment's baselines would come from actual historical computation, not a
# hardcoded dict.
_BASELINE_PRE_SEED_COMPUTED_AT = datetime(2026, 5, 25)  # one week before the real Week 1 period (Jun 1-7)
_LEAD_TIME_BASELINE_PRE_SEED = {"SKU-2002": 4.0, "SKU-2005": 3.33}
_DEMAND_BASELINE_PRE_SEED = {"SKU-2001": 827.2, "SKU-2004": 534.18, "SKU-2006": 489.6}
PURCHASE_ORDER_FILE = SEED_DATA_DIR / "Purchase_Orders.xlsx"
GOODS_RECEIPT_FILE = SEED_DATA_DIR / "Goods_Receipt_Register.xlsx"
DEMAND_FORECAST_FILE = SEED_DATA_DIR / "Demand_Forecast_Data.xlsx"


def _is_real_order_row(order_id) -> bool:
    return order_id is not None and str(order_id).strip().upper().startswith("ORD-")


def _is_real_sku_row(sku_code) -> bool:
    return sku_code is not None and str(sku_code).strip().upper().startswith("SKU-")


def _read_orders(path: Path) -> list[dict]:
    workbook = load_workbook(path, data_only=True)
    sheet = workbook.active
    rows = []
    for order_id, order_date, day, sku_code, sku_name, node, requested_qty in sheet.iter_rows(min_row=2, values_only=True):
        if not _is_real_order_row(order_id):
            continue
        rows.append(dict(
            order_id=str(order_id).strip(),
            order_date=order_date.date() if hasattr(order_date, "date") else order_date,
            day=day,
            sku_code=sku_code,
            sku_name=sku_name,
            node=node,
            requested_qty=requested_qty,
        ))
    return rows


def _read_goods_sent(path: Path) -> list[dict]:
    workbook = load_workbook(path, data_only=True)
    sheet = workbook.active
    rows = []
    for order_id, shipped_qty in sheet.iter_rows(min_row=2, values_only=True):
        if not _is_real_order_row(order_id):
            continue
        rows.append(dict(order_id=str(order_id).strip(), shipped_qty=shipped_qty))
    return rows


def _read_inventory_snapshots(path: Path) -> list[dict]:
    """Unlike Order_File_Week1/Goods_Sent_Register (whose trailer rows land in
    column A), this file's trailer rows land with SKU Code (column C) empty, so
    the real-row check is on sku_code, not the first column."""
    workbook = load_workbook(path, data_only=True)
    sheet = workbook.active
    rows = []
    for snapshot_date, day, sku_code, sku_name, on_hand_before_shipment, qty_shipped, on_hand_eod in sheet.iter_rows(
        min_row=2, values_only=True,
    ):
        if not _is_real_sku_row(sku_code):
            continue
        rows.append(dict(
            snapshot_date=snapshot_date.date() if hasattr(snapshot_date, "date") else snapshot_date,
            day=day,
            sku_code=sku_code,
            sku_name=sku_name,
            on_hand_before_shipment=on_hand_before_shipment,
            qty_shipped=qty_shipped,
            on_hand_eod=on_hand_eod,
        ))
    return rows


def _read_purchase_orders(path: Path) -> list[dict]:
    """Purchase_Orders.xlsx's own headers already match PurchaseOrder's field names
    exactly (po_number, sku_code, node_code, supplier_code, order_date, ordered_qty,
    expected_date) - no column-name mapping needed, unlike Goods_Receipt_Register.xlsx."""
    workbook = load_workbook(path, data_only=True)
    sheet = workbook.active
    rows = []
    for po_number, sku_code, node_code, supplier_code, order_date, ordered_qty, expected_date in sheet.iter_rows(
        min_row=2, values_only=True,
    ):
        if not po_number:
            continue
        rows.append(dict(
            po_number=str(po_number).strip(),
            sku_code=sku_code,
            node_code=node_code,
            supplier_code=supplier_code,
            order_date=order_date.date() if hasattr(order_date, "date") else order_date,
            ordered_qty=ordered_qty,
            expected_date=expected_date.date() if hasattr(expected_date, "date") else expected_date,
        ))
    return rows


def _read_goods_receipts(path: Path) -> list[dict]:
    """Maps Goods_Receipt_Register.xlsx's real column names - "PO Number",
    "Actual Delivery Date", "Qty Received" - onto GoodsReceipt's field names
    (po_number, receipt_date, received_qty). This file has no grn_reference column
    at all, so none is produced here."""
    workbook = load_workbook(path, data_only=True)
    sheet = workbook.active
    rows = []
    for po_number, receipt_date, received_qty in sheet.iter_rows(min_row=2, values_only=True):
        if not po_number:
            continue
        rows.append(dict(
            po_number=str(po_number).strip(),
            receipt_date=receipt_date.date() if hasattr(receipt_date, "date") else receipt_date,
            received_qty=received_qty,
        ))
    return rows


def _read_demand_forecast(path: Path) -> list[dict]:
    """WIDE format - one row per SKU, 4 weekly forecast columns. This file has an
    8th "Forecast Basis" column beyond what DemandForecast stores; row[:7] ignores
    it. 11 SKUs here (SKU-2001..SKU-2010, SKU-2012) vs. the order file's 6 - that
    mismatch is expected, see compute_forecast_accuracy's docstring."""
    workbook = load_workbook(path, data_only=True)
    sheet = workbook.active
    rows = []
    for row in sheet.iter_rows(min_row=2, values_only=True):
        sku_code, sku_name, node, week1, week2, week3, week4 = row[:7]
        if not _is_real_sku_row(sku_code):
            continue
        rows.append(dict(
            sku_code=sku_code, sku_name=sku_name, node=node,
            week1_forecast=week1, week2_forecast=week2, week3_forecast=week3, week4_forecast=week4,
        ))
    return rows


async def seed_fill_rate() -> None:
    async with SessionLocal() as session:
        if ORDER_FILE.exists() and GOODS_SENT_FILE.exists():
            order_rows = _read_orders(ORDER_FILE)
            sent_rows = _read_goods_sent(GOODS_SENT_FILE)

            for row in order_rows:
                existing = (await session.execute(
                    select(SalesOrder).where(SalesOrder.order_id == row["order_id"])
                )).scalar_one_or_none()
                if existing:
                    for key, value in row.items():
                        if key != "order_id":
                            setattr(existing, key, value)
                else:
                    session.add(SalesOrder(**row))
            await session.flush()

            for row in sent_rows:
                existing = (await session.execute(
                    select(GoodsSent).where(GoodsSent.order_id == row["order_id"])
                )).scalar_one_or_none()
                if existing:
                    existing.shipped_qty = row["shipped_qty"]
                else:
                    session.add(GoodsSent(**row))
            await session.commit()
            logger.info(
                "Fill Rate seed: upserted %d SalesOrder row(s) and %d GoodsSent row(s)",
                len(order_rows), len(sent_rows),
            )
        else:
            if not ORDER_FILE.exists():
                logger.warning("Fill Rate seed: %s not found - skipping SalesOrder/GoodsSent seed", ORDER_FILE)
            if not GOODS_SENT_FILE.exists():
                logger.warning("Fill Rate seed: %s not found - skipping SalesOrder/GoodsSent seed", GOODS_SENT_FILE)

        if INVENTORY_SNAPSHOT_FILE.exists():
            snapshot_rows = _read_inventory_snapshots(INVENTORY_SNAPSHOT_FILE)
            for row in snapshot_rows:
                existing = (await session.execute(
                    select(InventorySnapshot).where(
                        InventorySnapshot.sku_code == row["sku_code"],
                        InventorySnapshot.snapshot_date == row["snapshot_date"],
                    )
                )).scalar_one_or_none()
                if existing:
                    for key, value in row.items():
                        setattr(existing, key, value)
                else:
                    session.add(InventorySnapshot(**row))
            await session.commit()
            logger.info("Fill Rate seed: upserted %d InventorySnapshot row(s)", len(snapshot_rows))
        else:
            logger.warning("Fill Rate seed: %s not found - skipping InventorySnapshot seed", INVENTORY_SNAPSHOT_FILE)

        if PURCHASE_ORDER_FILE.exists():
            po_rows = _read_purchase_orders(PURCHASE_ORDER_FILE)
            po_by_number = {}
            for row in po_rows:
                existing = (await session.execute(
                    select(PurchaseOrder).where(PurchaseOrder.po_number == row["po_number"])
                )).scalar_one_or_none()
                if existing:
                    for key, value in row.items():
                        if key != "po_number":
                            setattr(existing, key, value)
                    po_by_number[row["po_number"]] = existing
                else:
                    po = PurchaseOrder(**row)
                    session.add(po)
                    po_by_number[row["po_number"]] = po
            await session.flush()
            logger.info("Fill Rate seed: upserted %d PurchaseOrder row(s)", len(po_rows))

            if GOODS_RECEIPT_FILE.exists():
                receipt_rows = _read_goods_receipts(GOODS_RECEIPT_FILE)
                for row in receipt_rows:
                    po = po_by_number.get(row["po_number"])
                    if po is None:
                        logger.warning(
                            "Fill Rate seed: goods receipt references unknown po_number=%s - skipping",
                            row["po_number"],
                        )
                        continue
                    existing = (await session.execute(
                        select(GoodsReceipt).where(GoodsReceipt.purchase_order_id == po.id)
                    )).scalar_one_or_none()
                    if existing:
                        existing.received_qty = row["received_qty"]
                        existing.receipt_date = row["receipt_date"]
                    else:
                        session.add(GoodsReceipt(
                            purchase_order_id=po.id, received_qty=row["received_qty"], receipt_date=row["receipt_date"],
                        ))
                await session.commit()
                logger.info("Fill Rate seed: upserted %d GoodsReceipt row(s)", len(receipt_rows))
            else:
                logger.warning("Fill Rate seed: %s not found - skipping GoodsReceipt seed", GOODS_RECEIPT_FILE)
        else:
            logger.warning(
                "Fill Rate seed: %s not found - skipping PurchaseOrder/GoodsReceipt seed", PURCHASE_ORDER_FILE
            )

        if DEMAND_FORECAST_FILE.exists():
            forecast_rows = _read_demand_forecast(DEMAND_FORECAST_FILE)
            for row in forecast_rows:
                existing = (await session.execute(
                    select(DemandForecast).where(DemandForecast.sku_code == row["sku_code"])
                )).scalar_one_or_none()
                if existing:
                    for key, value in row.items():
                        if key != "sku_code":
                            setattr(existing, key, value)
                else:
                    session.add(DemandForecast(**row))
            await session.commit()
            logger.info("Fill Rate seed: upserted %d DemandForecast row(s)", len(forecast_rows))
        else:
            logger.warning("Fill Rate seed: %s not found - skipping DemandForecast seed", DEMAND_FORECAST_FILE)

        pre_seeded_lt = []
        for sku_code, baseline_rmse_lt in _LEAD_TIME_BASELINE_PRE_SEED.items():
            existing = (await session.execute(
                select(LeadTimeBaseline).where(LeadTimeBaseline.sku_code == sku_code)
            )).scalar_one_or_none()
            if existing is None:
                session.add(LeadTimeBaseline(
                    sku_code=sku_code, baseline_rmse_lt=baseline_rmse_lt, computed_at=_BASELINE_PRE_SEED_COMPUTED_AT,
                ))
                pre_seeded_lt.append(sku_code)

        pre_seeded_d = []
        for sku_code, baseline_rmse_d in _DEMAND_BASELINE_PRE_SEED.items():
            existing = (await session.execute(
                select(DemandBaseline).where(DemandBaseline.sku_code == sku_code)
            )).scalar_one_or_none()
            if existing is None:
                session.add(DemandBaseline(
                    sku_code=sku_code, baseline_rmse_d=baseline_rmse_d, computed_at=_BASELINE_PRE_SEED_COMPUTED_AT,
                ))
                pre_seeded_d.append(sku_code)

        await session.commit()
        logger.info(
            "Fill Rate seed: pre-seeded demo baselines (insert-if-missing) - LeadTimeBaseline: %s, DemandBaseline: %s",
            pre_seeded_lt or "none new", pre_seeded_d or "none new",
        )


if __name__ == "__main__":
    import asyncio
    logging.basicConfig(level=logging.INFO)
    asyncio.run(seed_fill_rate())
