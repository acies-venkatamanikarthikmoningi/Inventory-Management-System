import math
from datetime import date, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import DemandObservation, LeadTimeObservation

DEMAND_ROLLING_WINDOW_DAYS = 56  # trailing 8 weeks, per the Safety Stock formula spec
LEAD_TIME_TRAILING_DELIVERIES = 12


async def demand_variability(session: AsyncSession, sku_code: str, node_code: str, as_of: date | None = None):
    """ADD_rolling and RMSE_D from trailing actual-vs-forecast daily demand.
    RMSE_D measures forecast ERROR (actual - forecast), not raw demand variance."""
    as_of = as_of or date.today()
    window_start = as_of - timedelta(days=DEMAND_ROLLING_WINDOW_DAYS)
    rows = (await session.scalars(
        select(DemandObservation)
        .where(
            DemandObservation.sku_code == sku_code,
            DemandObservation.node_code == node_code,
            DemandObservation.observed_date > window_start,
            DemandObservation.observed_date <= as_of,
        )
        .order_by(DemandObservation.observed_date)
    )).all()
    if not rows:
        return None
    errors = [float(r.actual_qty) - float(r.forecast_qty) for r in rows]
    add_rolling = sum(float(r.actual_qty) for r in rows) / len(rows)
    rmse_d = math.sqrt(sum(e * e for e in errors) / len(errors))
    return {"add_rolling": add_rolling, "rmse_d": rmse_d, "sample_size": len(rows)}


async def lead_time_variability(session: AsyncSession, sku_code: str, node_code: str, as_of: date | None = None, trailing: int = LEAD_TIME_TRAILING_DELIVERIES):
    """L_actual, RMSE_LT, and fill rate FR from trailing delivery history.
    RMSE_LT measures lead-time prediction error (actual - promised)."""
    as_of = as_of or date.today()
    rows = (await session.scalars(
        select(LeadTimeObservation)
        .where(
            LeadTimeObservation.sku_code == sku_code,
            LeadTimeObservation.node_code == node_code,
            LeadTimeObservation.order_date <= as_of,
        )
        .order_by(LeadTimeObservation.order_date.desc())
        .limit(trailing)
    )).all()
    if not rows:
        return None
    errors = [float(r.actual_lead_time_days) - float(r.promised_lead_time_days) for r in rows]
    l_actual = sum(float(r.actual_lead_time_days) for r in rows) / len(rows)
    rmse_lt = math.sqrt(sum(e * e for e in errors) / len(errors))
    total_ordered = sum(float(r.ordered_qty) for r in rows)
    total_received = sum(float(r.received_qty) for r in rows)
    fill_rate = (total_received / total_ordered) if total_ordered > 0 else 1.0
    return {"l_actual": l_actual, "rmse_lt": rmse_lt, "fill_rate": fill_rate, "sample_size": len(rows)}
