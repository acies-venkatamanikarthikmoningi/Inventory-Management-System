"""L4 Triage - combines L1 (Fill Rate), L2 (Stockout/Backorder), and L3 (Driver
Screening) into one per-SKU status. Every metric here is computed by calling those
existing functions directly - nothing is recomputed independently.
"""
from sqlalchemy.ext.asyncio import AsyncSession
from app.fill_rate.service import (
    FILL_RATE_BENCHMARK, STOCKOUT_BACKORDER_BENCHMARK, compute_fill_rate, compute_stockout_backorder_rates,
    screen_all_drivers,
)

# Maps screen_all_drivers' camelCase per-driver keys onto the snake_case driver
# identifiers RCA's decision tree checks against ("supplier_otd",
# "lead_time_variability", etc.) - the single place both Triage and RCA get this
# name mapping from, so the two layers can never disagree on what a driver is called.
DRIVER_NAME_MAP = {
    "forecastAccuracy": "forecast_accuracy",
    "demandVariability": "demand_variability",
    "supplierOtd": "supplier_otd",
    "leadTimeVariability": "lead_time_variability",
    "parameterAge": "parameter_age",
}


def flagged_driver_names(driver_row: dict) -> list[str]:
    """Given one row of screen_all_drivers' output, returns the snake_case names of
    every driver with flag=true. A driver with status="insufficient_data" has no
    "flag" key at all - .get(...) treats that as not-flagged, never as an error."""
    return [name for key, name in DRIVER_NAME_MAP.items() if driver_row.get(key, {}).get("flag")]


async def run_triage(session: AsyncSession, date_from=None, date_to=None) -> list[dict]:
    """One row per SKU present in SalesOrder for the period (the same SKU set
    screen_all_drivers already restricts itself to)."""
    driver_rows = await screen_all_drivers(session, date_from, date_to)

    results = []
    for driver_row in driver_rows:
        sku_code = driver_row["skuCode"]
        fill_rate_result = await compute_fill_rate(session, sku_code=sku_code, date_from=date_from, date_to=date_to)
        diag = await compute_stockout_backorder_rates(session, sku_code=sku_code, date_from=date_from, date_to=date_to)

        flagged_drivers = flagged_driver_names(driver_row)
        has_bad_outcome = (
            fill_rate_result["fillRate"] < FILL_RATE_BENCHMARK
            or diag["stockoutRate"] >= STOCKOUT_BACKORDER_BENCHMARK
            or diag["backorderRate"] >= STOCKOUT_BACKORDER_BENCHMARK
        )
        has_flagged_driver = len(flagged_drivers) > 0

        if has_bad_outcome and has_flagged_driver:
            status = "responsible"
        elif has_bad_outcome and not has_flagged_driver:
            status = "unexplained"
        elif not has_bad_outcome and has_flagged_driver:
            status = "watch"
        else:
            status = "healthy"

        results.append({
            "skuCode": sku_code,
            "status": status,
            "fillRate": fill_rate_result["fillRate"],
            "stockoutRate": diag["stockoutRate"],
            "backorderRate": diag["backorderRate"],
            "flaggedDrivers": flagged_drivers,
        })
    return results
