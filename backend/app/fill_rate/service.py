import math
import statistics
from datetime import date as date_, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.fill_rate.models import (
    DemandBaseline, DemandForecast, GoodsReceipt, GoodsSent, InventorySnapshot, LeadTimeBaseline, PurchaseOrder,
    SalesOrder,
)
from app.fill_rate.upload import coerce_date

FILL_RATE_BENCHMARK = 0.95
STOCKOUT_BACKORDER_BENCHMARK = 0.02
DRIVER_FORECAST_ACCURACY_BENCHMARK = 0.85
DRIVER_DEMAND_CV_BENCHMARK = 0.50
DRIVER_SUPPLIER_OTD_BENCHMARK = 0.95
DRIVER_DRIFT_BENCHMARK = 0.15

# The 4 fixed calendar weeks Demand_Forecast_Data.xlsx's own column headers name
# ("Week 1 Forecast (Jun 1-7)" etc.) - Driver 1/5's date-range-to-column lookup is
# only ever these 4 exact buckets; anything else is insufficient_data, never
# approximated.
_WEEK_FORECAST_COLUMNS = {
    (date_(2026, 6, 1), date_(2026, 6, 7)): "week1_forecast",
    (date_(2026, 6, 8), date_(2026, 6, 14)): "week2_forecast",
    (date_(2026, 6, 15), date_(2026, 6, 21)): "week3_forecast",
    (date_(2026, 6, 22), date_(2026, 6, 28)): "week4_forecast",
}


def _require(row: dict, key: str):
    value = row.get(key)
    if value is None or str(value).strip() == "":
        raise ValueError(f"'{key}' is required")
    return value


def _decimal(row: dict, key: str) -> Decimal:
    value = _require(row, key)
    try:
        return Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError(f"'{key}' must be numeric, got {value!r}") from exc


def _optional_str(row: dict, key: str) -> str | None:
    value = row.get(key)
    if value is None or str(value).strip() == "":
        return None
    return str(value).strip()


async def _received_qty_by_order(session: AsyncSession, purchase_order_id):
    result = await session.execute(
        select(func.coalesce(func.sum(GoodsReceipt.received_qty), 0))
        .where(GoodsReceipt.purchase_order_id == purchase_order_id)
    )
    return result.scalar_one()


async def list_purchase_orders(session: AsyncSession, sku: str | None = None, node: str | None = None):
    stmt = select(PurchaseOrder)
    if sku:
        stmt = stmt.where(PurchaseOrder.sku_code == sku)
    if node:
        stmt = stmt.where(PurchaseOrder.node_code == node)
    orders = (await session.execute(stmt)).scalars().all()
    items = []
    for order in orders:
        received = await _received_qty_by_order(session, order.id)
        items.append({
            "id": str(order.id),
            "poNumber": order.po_number,
            "skuCode": order.sku_code,
            "node": order.node_code,
            "supplierCode": order.supplier_code,
            "orderDate": order.order_date,
            "orderedQty": float(order.ordered_qty),
            "receivedQty": float(received),
            "expectedDate": order.expected_date,
            "status": order.status,
        })
    return items


async def _joined_fill_rate_rows(
    session: AsyncSession, node: str | None = None, sku_code: str | None = None, date_from=None, date_to=None,
) -> list[dict]:
    """LEFT JOIN SalesOrder -> GoodsSent on order_id (aggregated, in case an order
    has more than one shipment line). An order with NO matching GoodsSent row at
    all still appears here with shipped_qty=0 via COALESCE - a genuine stockout,
    not a row silently dropped from the denominator. Every L1/L2 aggregate function
    (compute_fill_rate, compute_fill_rate_by_sku, compute_stockout_backorder_rates,
    compute_stockout_backorder_rates_by_sku) calls this SAME helper so node-level,
    by-SKU, and cross-metric results can never silently disagree on which rows or
    join logic apply.
    """
    stmt = (
        select(
            SalesOrder.order_id, SalesOrder.order_date, SalesOrder.sku_code, SalesOrder.sku_name, SalesOrder.node,
            SalesOrder.requested_qty, func.coalesce(func.sum(GoodsSent.shipped_qty), 0).label("shipped_qty"),
        )
        .outerjoin(GoodsSent, GoodsSent.order_id == SalesOrder.order_id)
        .group_by(
            SalesOrder.order_id, SalesOrder.order_date, SalesOrder.sku_code, SalesOrder.sku_name, SalesOrder.node,
            SalesOrder.requested_qty,
        )
    )
    if node:
        stmt = stmt.where(SalesOrder.node == node)
    if sku_code:
        stmt = stmt.where(SalesOrder.sku_code == sku_code)
    if date_from:
        stmt = stmt.where(SalesOrder.order_date >= date_from)
    if date_to:
        stmt = stmt.where(SalesOrder.order_date <= date_to)

    rows = (await session.execute(stmt)).all()
    results = []
    for order_id, order_date, row_sku_code, sku_name, node_value, requested_qty, shipped_qty in rows:
        requested_qty = float(requested_qty)
        shipped_qty = float(shipped_qty)
        results.append({
            "orderId": order_id,
            "orderDate": order_date,
            "skuCode": row_sku_code,
            "skuName": sku_name,
            "node": node_value,
            "requestedQty": requested_qty,
            "shippedQty": shipped_qty,
            "filledComplete": 1 if shipped_qty >= requested_qty else 0,
        })
    return results


async def compute_fill_rate(
    session: AsyncSession, node: str | None = None, sku_code: str | None = None, date_from=None, date_to=None,
) -> dict:
    rows = await _joined_fill_rate_rows(session, node=node, sku_code=sku_code, date_from=date_from, date_to=date_to)
    total_orders = len(rows)
    orders_filled_complete = sum(r["filledComplete"] for r in rows)
    fill_rate = (orders_filled_complete / total_orders) if total_orders else 0.0
    return {
        "totalOrders": total_orders,
        "ordersFilledComplete": orders_filled_complete,
        "fillRate": round(fill_rate, 4),
        "isException": fill_rate < FILL_RATE_BENCHMARK,
    }


async def compute_fill_rate_by_sku(session: AsyncSession, node: str | None = None, date_from=None, date_to=None) -> list[dict]:
    rows = await _joined_fill_rate_rows(session, node=node, date_from=date_from, date_to=date_to)
    groups: dict[str, dict] = {}
    for r in rows:
        bucket = groups.setdefault(r["skuCode"], {"skuName": r["skuName"], "total": 0, "filled": 0})
        bucket["total"] += 1
        bucket["filled"] += r["filledComplete"]

    results = []
    for sku_code, bucket in sorted(groups.items()):
        fill_rate = (bucket["filled"] / bucket["total"]) if bucket["total"] else 0.0
        results.append({
            "skuCode": sku_code,
            "skuName": bucket["skuName"],
            "totalOrders": bucket["total"],
            "ordersFilledComplete": bucket["filled"],
            "fillRate": round(fill_rate, 4),
            "isException": fill_rate < FILL_RATE_BENCHMARK,
        })
    return results


# ── L2 Diagnostics: Stockout Rate, Backorder Rate, Days of Supply ──────────────

async def compute_stockout_backorder_rates(
    session: AsyncSession, node: str | None = None, sku_code: str | None = None, date_from=None, date_to=None,
) -> dict:
    """Reuses _joined_fill_rate_rows (the SAME LEFT JOIN L1 uses) - stockout and
    backorder are mutually exclusive by construction (shipped_qty==0 vs
    0 < shipped_qty < requested_qty vs shipped_qty >= requested_qty are the only
    three, non-overlapping possibilities per order), so
    stockout_count + backorder_count + filled_complete_count always equals
    total_orders (see test_rates_and_filled_complete_sum_to_total_orders)."""
    rows = await _joined_fill_rate_rows(session, node=node, sku_code=sku_code, date_from=date_from, date_to=date_to)
    total_orders = len(rows)
    stockout_count = sum(1 for r in rows if r["shippedQty"] == 0)
    backorder_count = sum(1 for r in rows if 0 < r["shippedQty"] < r["requestedQty"])
    stockout_rate = (stockout_count / total_orders) if total_orders else 0.0
    backorder_rate = (backorder_count / total_orders) if total_orders else 0.0
    return {
        "totalOrders": total_orders,
        "stockoutCount": stockout_count,
        "stockoutRate": round(stockout_rate, 4),
        "isStockoutException": stockout_rate >= STOCKOUT_BACKORDER_BENCHMARK,
        "backorderCount": backorder_count,
        "backorderRate": round(backorder_rate, 4),
        "isBackorderException": backorder_rate >= STOCKOUT_BACKORDER_BENCHMARK,
    }


async def compute_stockout_backorder_rates_by_sku(
    session: AsyncSession, node: str | None = None, date_from=None, date_to=None,
) -> list[dict]:
    """Same join/logic as compute_stockout_backorder_rates, grouped by SKU instead
    of aggregated DC-wide - matching the L1 by-SKU pattern."""
    rows = await _joined_fill_rate_rows(session, node=node, date_from=date_from, date_to=date_to)
    groups: dict[str, dict] = {}
    for r in rows:
        bucket = groups.setdefault(r["skuCode"], {"skuName": r["skuName"], "total": 0, "stockout": 0, "backorder": 0})
        bucket["total"] += 1
        if r["shippedQty"] == 0:
            bucket["stockout"] += 1
        elif r["shippedQty"] < r["requestedQty"]:
            bucket["backorder"] += 1

    results = []
    for sku_code, bucket in sorted(groups.items()):
        total = bucket["total"]
        stockout_rate = (bucket["stockout"] / total) if total else 0.0
        backorder_rate = (bucket["backorder"] / total) if total else 0.0
        results.append({
            "skuCode": sku_code,
            "skuName": bucket["skuName"],
            "totalOrders": total,
            "stockoutCount": bucket["stockout"],
            "stockoutRate": round(stockout_rate, 4),
            "isStockoutException": stockout_rate >= STOCKOUT_BACKORDER_BENCHMARK,
            "backorderCount": bucket["backorder"],
            "backorderRate": round(backorder_rate, 4),
            "isBackorderException": backorder_rate >= STOCKOUT_BACKORDER_BENCHMARK,
        })
    return results


async def compute_days_of_supply(
    session: AsyncSession, sku_code: str | None = None, date_from=None, date_to=None,
) -> list[dict]:
    """Day-by-day Days of Supply = that day's real on-hand (InventorySnapshot's
    "On-Hand Inventory (EOD)" figure) / that SAME day's real total demand
    (SUM of SalesOrder.requested_qty for that date) - deliberately NOT a rolling or
    smoothed average, so a demand spike shows up as an immediate drop on that exact
    date (see test_dos_uses_same_day_demand_not_average). sku_code=None aggregates
    on-hand and demand across every SKU present (DC-level); given a sku_code, scopes
    both sides to just that SKU. This dataset has no Node column of its own - see
    SalesOrder.node's docstring - so there is no node parameter here.

    A date with zero total demand yields dos=None (not a ZeroDivisionError and not
    a misleading 0) - see test_dos_handles_zero_demand_day_without_crashing.
    """
    demand_stmt = select(SalesOrder.order_date, func.sum(SalesOrder.requested_qty)).group_by(SalesOrder.order_date)
    onhand_stmt = select(InventorySnapshot.snapshot_date, func.sum(InventorySnapshot.on_hand_eod)).group_by(
        InventorySnapshot.snapshot_date
    )
    if sku_code:
        demand_stmt = demand_stmt.where(SalesOrder.sku_code == sku_code)
        onhand_stmt = onhand_stmt.where(InventorySnapshot.sku_code == sku_code)
    if date_from:
        demand_stmt = demand_stmt.where(SalesOrder.order_date >= date_from)
        onhand_stmt = onhand_stmt.where(InventorySnapshot.snapshot_date >= date_from)
    if date_to:
        demand_stmt = demand_stmt.where(SalesOrder.order_date <= date_to)
        onhand_stmt = onhand_stmt.where(InventorySnapshot.snapshot_date <= date_to)

    demand_by_date = {d: float(v) for d, v in (await session.execute(demand_stmt)).all()}
    onhand_by_date = {d: float(v) for d, v in (await session.execute(onhand_stmt)).all()}

    trend = []
    for d in sorted(set(demand_by_date) | set(onhand_by_date)):
        demand = demand_by_date.get(d, 0.0)
        on_hand = onhand_by_date.get(d, 0.0)
        dos = (on_hand / demand) if demand else None
        trend.append({
            "date": d,
            "onHand": on_hand,
            "demand": demand,
            "dos": round(dos, 4) if dos is not None else None,
        })
    return trend


def _build_diagnostic_message(rates: dict, dos_trend: list[dict]) -> str:
    """Built dynamically from the actual computed values - never a fixed template.
    States specifically which of Stockout/Backorder (if either) breached the
    threshold, then appends a Days of Supply trend observation only when the
    trend has at least two dated points to compare."""
    stockout_pct = rates["stockoutRate"] * 100
    backorder_pct = rates["backorderRate"] * 100
    threshold_pct = STOCKOUT_BACKORDER_BENCHMARK * 100
    stockout_exc = rates["isStockoutException"]
    backorder_exc = rates["isBackorderException"]

    if stockout_exc and backorder_exc:
        message = (
            f"Stockout Rate ({stockout_pct:.1f}%) and Backorder Rate ({backorder_pct:.1f}%) are both "
            f"above the {threshold_pct:.0f}% threshold - this is where Fill Rate decline is coming from."
        )
    elif stockout_exc:
        message = (
            f"Stockout Rate ({stockout_pct:.1f}%) is above the {threshold_pct:.0f}% threshold, while "
            f"Backorder Rate ({backorder_pct:.1f}%) is within range."
        )
    elif backorder_exc:
        message = (
            f"Backorder Rate ({backorder_pct:.1f}%) is above the {threshold_pct:.0f}% threshold, while "
            f"Stockout Rate ({stockout_pct:.1f}%) is within range."
        )
    else:
        message = (
            f"Stockout Rate ({stockout_pct:.1f}%) and Backorder Rate ({backorder_pct:.1f}%) are both "
            f"within the {threshold_pct:.0f}% threshold - no exception detected."
        )

    dos_points = [(row["date"], row["dos"]) for row in dos_trend if row["dos"] is not None]
    if len(dos_points) >= 2:
        first_date, first_dos = dos_points[0]
        last_date, last_dos = dos_points[-1]
        if last_dos < first_dos:
            message += (
                f" Days of Supply fell from {first_dos:.2f} to {last_dos:.2f} days over the period, "
                f"consistent with this pattern."
            )
        elif last_dos > first_dos:
            message += f" Days of Supply rose from {first_dos:.2f} to {last_dos:.2f} days over the period."
        else:
            message += f" Days of Supply held steady at {first_dos:.2f} days over the period."

    return message


async def get_l2_diagnostics(
    session: AsyncSession, node: str | None = None, sku_code: str | None = None, date_from=None, date_to=None,
) -> dict:
    """Combines Parts A and B into one diagnostic verdict - sku_code=None is the
    DC-level view; given a sku_code, scopes both the rates and the DoS trend to it.
    Forwards totalOrders/stockoutCount/backorderCount from compute_stockout_backorder_rates
    (previously computed here but dropped before reaching the API response) so the
    frontend's click-to-expand raw-numbers panels can show the real counts a rate was
    computed from, rather than reverse-engineering them from a rounded percentage."""
    rates = await compute_stockout_backorder_rates(session, node=node, sku_code=sku_code, date_from=date_from, date_to=date_to)
    dos_trend = await compute_days_of_supply(session, sku_code=sku_code, date_from=date_from, date_to=date_to)
    return {
        "totalOrders": rates["totalOrders"],
        "stockoutCount": rates["stockoutCount"],
        "stockoutRate": rates["stockoutRate"],
        "isStockoutException": rates["isStockoutException"],
        "backorderCount": rates["backorderCount"],
        "backorderRate": rates["backorderRate"],
        "isBackorderException": rates["isBackorderException"],
        "dosTrend": dos_trend,
        "diagnosticMessage": _build_diagnostic_message(rates, dos_trend),
    }


async def get_l2_diagnostics_by_sku(
    session: AsyncSession, node: str | None = None, date_from=None, date_to=None,
) -> list[dict]:
    """L2 diagnostics for every SKU present in the period - the triage input table
    for later (L3). Reuses get_l2_diagnostics per SKU rather than a separately
    maintained calculation."""
    rows = await _joined_fill_rate_rows(session, node=node, date_from=date_from, date_to=date_to)
    sku_names: dict[str, str] = {}
    for r in rows:
        sku_names.setdefault(r["skuCode"], r["skuName"])

    results = []
    for sku_code in sorted(sku_names):
        diagnostics = await get_l2_diagnostics(session, node=node, sku_code=sku_code, date_from=date_from, date_to=date_to)
        results.append({"skuCode": sku_code, "skuName": sku_names[sku_code], **diagnostics})
    return results


async def supplier_fill_rate_summary(session: AsyncSession, sku: str | None = None, node: str | None = None):
    """Supply-side fill rate: received qty / ordered qty, grouped by (sku, node, supplier)."""
    orders = await list_purchase_orders(session, sku, node)
    supplier_by_order = {o["id"]: o["supplierCode"] for o in orders}
    groups: dict[tuple[str, str, str], dict] = {}
    for item in orders:
        key = (item["skuCode"], item["node"], supplier_by_order[item["id"]])
        bucket = groups.setdefault(key, {"ordersCount": 0, "orderedQty": 0.0, "receivedQty": 0.0})
        bucket["ordersCount"] += 1
        bucket["orderedQty"] += item["orderedQty"]
        bucket["receivedQty"] += item["receivedQty"]
    results = []
    for (sku_code, node_code, supplier_code), bucket in sorted(groups.items()):
        fill_rate_pct = (bucket["receivedQty"] / bucket["orderedQty"] * 100) if bucket["orderedQty"] else 0.0
        results.append({
            "skuCode": sku_code,
            "node": node_code,
            "supplierCode": supplier_code,
            "ordersCount": bucket["ordersCount"],
            "orderedQty": bucket["orderedQty"],
            "receivedQty": bucket["receivedQty"],
            "fillRatePct": round(fill_rate_pct, 2),
        })
    return results


async def upsert_purchase_orders(session: AsyncSession, rows: list[dict]) -> dict:
    inserted = updated = 0
    errors = []
    for idx, row in enumerate(rows, start=2):
        try:
            po_number = str(_require(row, "po_number")).strip()
            values = dict(
                sku_code=str(_require(row, "sku_code")).strip(),
                node_code=str(_require(row, "node_code")).strip(),
                supplier_code=str(_require(row, "supplier_code")).strip(),
                order_date=coerce_date(_require(row, "order_date")),
                ordered_qty=_decimal(row, "ordered_qty"),
                expected_date=coerce_date(row.get("expected_date")),
                status=_optional_str(row, "status") or "OPEN",
            )
            existing = (await session.execute(
                select(PurchaseOrder).where(PurchaseOrder.po_number == po_number)
            )).scalar_one_or_none()
            if existing:
                for key, value in values.items():
                    setattr(existing, key, value)
                updated += 1
            else:
                session.add(PurchaseOrder(po_number=po_number, **values))
                inserted += 1
        except Exception as exc:
            errors.append({"row": idx, "message": str(exc)})
    await session.commit()
    return {"inserted": inserted, "updated": updated, "skipped": len(errors), "errors": errors}


async def insert_goods_receipts(session: AsyncSession, rows: list[dict]) -> dict:
    inserted = 0
    errors = []
    for idx, row in enumerate(rows, start=2):
        try:
            po_number = str(_require(row, "po_number")).strip()
            purchase_order = (await session.execute(
                select(PurchaseOrder).where(PurchaseOrder.po_number == po_number)
            )).scalar_one_or_none()
            if purchase_order is None:
                raise ValueError(f"No purchase order found with po_number={po_number!r} - upload purchase orders first")
            session.add(GoodsReceipt(
                purchase_order_id=purchase_order.id,
                received_qty=_decimal(row, "received_qty"),
                receipt_date=coerce_date(_require(row, "receipt_date")),
                grn_reference=_optional_str(row, "grn_reference"),
            ))
            inserted += 1
        except Exception as exc:
            errors.append({"row": idx, "message": str(exc)})
    await session.commit()
    return {"inserted": inserted, "updated": 0, "skipped": len(errors), "errors": errors}


# ── L3 Driver Screening: 5 drivers, computed per SKU ────────────────────────────

async def compute_forecast_accuracy(
    session: AsyncSession, sku_code: str, date_from: date_ | None = None, date_to: date_ | None = None,
) -> dict:
    """Driver 1 - Forecast Accuracy. actual_demand is SalesOrder's real total for
    this sku/period; forecasted_demand is looked up from DemandForecast's
    wide-format week column matching the period exactly (see
    _WEEK_FORECAST_COLUMNS). No approximation when the range doesn't cleanly match
    one of the 4 weeks, or no DemandForecast row exists for this sku - both return
    status="insufficient_data" rather than a guessed number.

    accuracy = 1 - abs(actual - forecast) / forecast: the abs() means an equally
    large over-forecast or under-forecast produces the SAME accuracy score (see
    test_forecast_accuracy_penalizes_both_over_and_under_forecast) - direction
    doesn't matter here, only magnitude of the miss.
    """
    week_column = _WEEK_FORECAST_COLUMNS.get((date_from, date_to)) if date_from and date_to else None
    if week_column is None:
        return {"status": "insufficient_data"}

    forecast = (await session.execute(
        select(DemandForecast).where(DemandForecast.sku_code == sku_code)
    )).scalar_one_or_none()
    if forecast is None:
        return {"status": "insufficient_data"}

    forecasted_demand = getattr(forecast, week_column)
    if forecasted_demand is None or float(forecasted_demand) == 0:
        return {"status": "insufficient_data"}
    forecasted_demand = float(forecasted_demand)

    actual_demand = float((await session.execute(
        select(func.coalesce(func.sum(SalesOrder.requested_qty), 0)).where(
            SalesOrder.sku_code == sku_code, SalesOrder.order_date >= date_from, SalesOrder.order_date <= date_to,
        )
    )).scalar_one())

    accuracy = 1 - (abs(actual_demand - forecasted_demand) / forecasted_demand)
    return {
        "status": "ok",
        "actualDemand": actual_demand,
        "forecastedDemand": forecasted_demand,
        "accuracy": round(accuracy, 4),
        "flag": accuracy < DRIVER_FORECAST_ACCURACY_BENCHMARK,
    }


async def compute_demand_variability(
    session: AsyncSession, sku_code: str, date_from: date_ | None = None, date_to: date_ | None = None,
) -> dict:
    """Driver 2 - Demand Variability. sigma_d is the SAMPLE standard deviation
    (statistics.stdev, matching Excel's STDEV) of this sku's per-day total demand
    across the period; cv = sigma_d / mean. Fewer than 2 distinct demand days makes
    a standard deviation meaningless, so that returns insufficient_data rather than
    a 0/undefined cv."""
    stmt = (
        select(SalesOrder.order_date, func.sum(SalesOrder.requested_qty))
        .where(SalesOrder.sku_code == sku_code)
        .group_by(SalesOrder.order_date)
    )
    if date_from:
        stmt = stmt.where(SalesOrder.order_date >= date_from)
    if date_to:
        stmt = stmt.where(SalesOrder.order_date <= date_to)
    daily_demands = [float(v) for _, v in (await session.execute(stmt)).all()]

    if len(daily_demands) < 2:
        return {"status": "insufficient_data"}

    mean_demand = statistics.mean(daily_demands)
    sigma_d = statistics.stdev(daily_demands)
    cv = (sigma_d / mean_demand) if mean_demand else 0.0
    return {
        "status": "ok",
        "sigmaD": round(sigma_d, 4),
        "meanDemand": round(mean_demand, 4),
        "cv": round(cv, 4),
        "flag": cv > DRIVER_DEMAND_CV_BENCHMARK,
    }


async def _joined_po_receipt_rows(
    session: AsyncSession, sku_code: str, date_from: date_ | None = None, date_to: date_ | None = None,
):
    """INNER join PurchaseOrder -> GoodsReceipt on purchase_order_id, filtered to a
    single sku_code - deliberately NOT a left join like L1/L2's helper: a PO with no
    receipt yet hasn't completed a cycle, so it must be excluded from OTD/lead-time
    math entirely, not counted as some kind of failure. date_from/date_to filter on
    PurchaseOrder.order_date (when the cycle was placed), matching Driver 1/2's
    period convention. Assumes one receipt row per PO, matching the real seed data
    (Goods_Receipt_Register.xlsx has exactly one receipt per Purchase_Orders.xlsx
    row)."""
    stmt = (
        select(PurchaseOrder.order_date, PurchaseOrder.expected_date, GoodsReceipt.receipt_date)
        .join(GoodsReceipt, GoodsReceipt.purchase_order_id == PurchaseOrder.id)
        .where(PurchaseOrder.sku_code == sku_code)
    )
    if date_from:
        stmt = stmt.where(PurchaseOrder.order_date >= date_from)
    if date_to:
        stmt = stmt.where(PurchaseOrder.order_date <= date_to)
    return (await session.execute(stmt)).all()


async def compute_supplier_otd(
    session: AsyncSession, sku_code: str, date_from: date_ | None = None, date_to: date_ | None = None,
) -> dict:
    """Driver 3 - Supplier On-Time Delivery. otd_pct = POs received on or before
    their expected_date / all completed PO cycles for this sku in the period. Field
    names are the real ones - expected_date (PurchaseOrder), receipt_date (mapped
    from Goods_Receipt_Register.xlsx's "Actual Delivery Date") - not
    promised_delivery_date/actual_delivery_date."""
    rows = await _joined_po_receipt_rows(session, sku_code, date_from, date_to)
    if not rows:
        return {"status": "insufficient_data"}

    on_time = sum(1 for _, expected, actual in rows if expected is not None and actual <= expected)
    po_count = len(rows)
    otd_pct = on_time / po_count
    return {
        "status": "ok",
        "poCount": po_count,
        "otdPct": round(otd_pct, 4),
        "flag": otd_pct < DRIVER_SUPPLIER_OTD_BENCHMARK,
    }


def compute_drift_flag(fresh_value: float, baseline_value: float, threshold: float = DRIVER_DRIFT_BENCHMARK) -> dict:
    """Shared drift-comparison math for Driver 4 (lead-time RMSE) and Driver 5
    (demand RMSE) - both call this SAME function so the definition of "drift" can
    never diverge between the two (see test_parameter_age_reuses_same_drift_helper_as_lead_time).
    Only the comparison itself lives here; each driver handles its own
    baseline lookup/first-run-initialization before calling in."""
    if not baseline_value:
        return {"driftPct": None, "flag": False}
    drift_pct = (fresh_value - baseline_value) / baseline_value
    return {"driftPct": round(drift_pct, 4), "flag": drift_pct > threshold}


async def compute_lead_time_variability(
    session: AsyncSession, sku_code: str, date_from: date_ | None = None, date_to: date_ | None = None,
) -> dict:
    """Driver 4 - Lead-Time Variability, via RMSE drift against a LOCAL baseline
    stored in fill_rate_db's own lead_time_baselines table. Deliberately does not
    read the main app's Phase-3 lead-time policy data - self-contained, per the
    module's database-isolation requirement. First call for a sku establishes the
    baseline (status="baseline_established", flag=False, driftPct=None); later
    calls compare fresh RMSE against that stored baseline via compute_drift_flag."""
    rows = await _joined_po_receipt_rows(session, sku_code, date_from, date_to)
    squared_errors = [
        ((actual - order).days - (expected - order).days) ** 2
        for order, expected, actual in rows if expected is not None
    ]
    if not squared_errors:
        return {"status": "insufficient_data"}
    fresh_rmse_lt = math.sqrt(sum(squared_errors) / len(squared_errors))

    baseline = (await session.execute(
        select(LeadTimeBaseline).where(LeadTimeBaseline.sku_code == sku_code)
    )).scalar_one_or_none()

    if baseline is None:
        session.add(LeadTimeBaseline(
            sku_code=sku_code, baseline_rmse_lt=fresh_rmse_lt, computed_at=datetime.now(timezone.utc).replace(tzinfo=None)
        ))
        await session.commit()
        return {"status": "baseline_established", "rmseLt": round(fresh_rmse_lt, 4), "driftPct": None, "flag": False}

    drift = compute_drift_flag(fresh_rmse_lt, float(baseline.baseline_rmse_lt))
    return {
        "status": "ok",
        "rmseLt": round(fresh_rmse_lt, 4),
        "baselineRmseLt": round(float(baseline.baseline_rmse_lt), 4),
        "driftPct": drift["driftPct"],
        "flag": drift["flag"],
    }


async def compute_replenishment_parameter_age(
    session: AsyncSession, sku_code: str, date_from: date_ | None = None, date_to: date_ | None = None,
) -> dict:
    """Driver 5 - Replenishment Parameter Age, via the SAME baseline/drift pattern
    as Driver 4 (compute_drift_flag), applied to demand RMSE instead of lead-time
    RMSE, backed by its own demand_baselines table. fresh_rmse_d compares each
    actual day's demand against that week's forecast spread evenly across the
    period's days (the forecast is only issued as one weekly total - see
    DemandForecast's docstring - so a daily rate is the like-for-like comparison
    point); days with no SalesOrder rows count as zero actual demand, not omitted,
    so a day that went completely quiet still contributes its full miss to the
    RMSE."""
    week_column = _WEEK_FORECAST_COLUMNS.get((date_from, date_to)) if date_from and date_to else None
    if week_column is None:
        return {"status": "insufficient_data"}

    forecast = (await session.execute(
        select(DemandForecast).where(DemandForecast.sku_code == sku_code)
    )).scalar_one_or_none()
    if forecast is None:
        return {"status": "insufficient_data"}
    forecasted_weekly = getattr(forecast, week_column)
    if forecasted_weekly is None:
        return {"status": "insufficient_data"}

    stmt = (
        select(SalesOrder.order_date, func.sum(SalesOrder.requested_qty))
        .where(SalesOrder.sku_code == sku_code, SalesOrder.order_date >= date_from, SalesOrder.order_date <= date_to)
        .group_by(SalesOrder.order_date)
    )
    demand_by_date = {d: float(v) for d, v in (await session.execute(stmt)).all()}
    if not demand_by_date:
        return {"status": "insufficient_data"}

    num_days = (date_to - date_from).days + 1
    forecasted_daily = float(forecasted_weekly) / num_days
    squared_errors = []
    d = date_from
    while d <= date_to:
        squared_errors.append((demand_by_date.get(d, 0.0) - forecasted_daily) ** 2)
        d += timedelta(days=1)
    fresh_rmse_d = math.sqrt(sum(squared_errors) / len(squared_errors))

    baseline = (await session.execute(
        select(DemandBaseline).where(DemandBaseline.sku_code == sku_code)
    )).scalar_one_or_none()

    if baseline is None:
        session.add(DemandBaseline(
            sku_code=sku_code, baseline_rmse_d=fresh_rmse_d, computed_at=datetime.now(timezone.utc).replace(tzinfo=None)
        ))
        await session.commit()
        return {"status": "baseline_established", "rmseD": round(fresh_rmse_d, 4), "driftPct": None, "flag": False}

    drift = compute_drift_flag(fresh_rmse_d, float(baseline.baseline_rmse_d))
    return {
        "status": "ok",
        "rmseD": round(fresh_rmse_d, 4),
        "baselineRmseD": round(float(baseline.baseline_rmse_d), 4),
        "driftPct": drift["driftPct"],
        "flag": drift["flag"],
    }


async def screen_all_drivers(
    session: AsyncSession, date_from: date_ | None = None, date_to: date_ | None = None,
) -> list[dict]:
    """Runs all 5 drivers for every SKU present in SalesOrder for this period only -
    NOT every SKU in DemandForecast (which has 11, 5 more than the order file
    covers) - see test_screen_all_drivers_covers_every_sku_in_period.

    date_from/date_to scope the 3 DEMAND-side drivers (Forecast Accuracy, Demand
    Variability, Parameter Age) to this sales period. Supplier OTD and Lead-Time
    Variability are supply-side and deliberately NOT scoped to that same window:
    a PO's procurement cycle (placed, expected, received) runs on its own calendar
    ahead of the sales week it stocks for - see Purchase_Orders.xlsx's order_dates,
    which sit weeks before Order_File_Week1.xlsx's dates - so they look at every
    completed PO cycle known for the sku instead."""
    stmt = select(SalesOrder.sku_code, SalesOrder.sku_name).distinct()
    if date_from:
        stmt = stmt.where(SalesOrder.order_date >= date_from)
    if date_to:
        stmt = stmt.where(SalesOrder.order_date <= date_to)
    sku_names = dict((await session.execute(stmt)).all())

    results = []
    for sku_code in sorted(sku_names):
        results.append({
            "skuCode": sku_code,
            "skuName": sku_names[sku_code],
            "forecastAccuracy": await compute_forecast_accuracy(session, sku_code, date_from, date_to),
            "demandVariability": await compute_demand_variability(session, sku_code, date_from, date_to),
            "supplierOtd": await compute_supplier_otd(session, sku_code),
            "leadTimeVariability": await compute_lead_time_variability(session, sku_code),
            "parameterAge": await compute_replenishment_parameter_age(session, sku_code, date_from, date_to),
        })
    return results
