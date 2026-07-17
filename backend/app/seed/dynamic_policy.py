"""Phase 3 seed: demand/lead-time observation history, SKU cost profiles, and an
initial pair of PolicySnapshot rounds so /policy/drift has real data immediately.

Simulated/seeded, not real historical data: this repo has no real daily demand
feed, delivery history, or costing data anywhere in src/data/*.json (checked).
Same honesty standard as Phase 2's Batch seeding - values are deterministic
(hash-seeded per SKU/node), reproducible, and documented as synthetic here.
"""
from datetime import date, datetime, time, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.db.session import SessionLocal
from app.models import DemandObservation, LeadTimeObservation, PolicySnapshot, Sku, SkuCostProfile
from app.seed.network_foundation import _load, _upsert
from app.services.policy_service import refresh_policy
from app.services.policy_service import sku_node_pairs as _sku_node_pairs

DEMAND_HISTORY_DAYS = 63  # 56-day rolling window + 7-day gap for a second, earlier snapshot
LEAD_TIME_DELIVERIES = 20
LEAD_TIME_DELIVERY_SPACING_DAYS = 5

CLASSIFICATION_ADD_RANGE = {
    "Fast Moving": (400.0, 1200.0),
    "Medium Moving": (100.0, 400.0),
    "Slow Moving": (10.0, 100.0),
}
DEFAULT_ADD_RANGE = (100.0, 400.0)

HOLDING_COST_PCT = 0.20  # documented assumption: 20% of unit cost per year
ORDERING_COST = 500.0  # documented assumption: flat cost per purchase order


def _hash(value: str) -> int:
    h = 2166136261
    for ch in value:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def _rand(seed: str) -> float:
    return _hash(seed) / 4294967295


async def _backfill_classification(session: AsyncSession, skus_master: dict):
    existing = {sku.sku_code: sku for sku in (await session.scalars(select(Sku))).all()}
    for sku_code, row in skus_master.items():
        sku = existing.get(sku_code)
        if sku is not None:
            sku.classification = row.get("classification")


async def _seed_demand_and_lead_time(session: AsyncSession, sku_code: str, node_code: str, classification: str | None, as_of: date):
    lo, hi = CLASSIFICATION_ADD_RANGE.get(classification, DEFAULT_ADD_RANGE)
    base_add = lo + _rand(f"{sku_code}|base-add") * (hi - lo)
    noise_scale = base_add * (0.08 + _rand(f"{sku_code}|noise-scale") * 0.12)

    await session.execute(
        DemandObservation.__table__.delete().where(
            DemandObservation.sku_code == sku_code, DemandObservation.node_code == node_code
        )
    )
    for offset in range(DEMAND_HISTORY_DAYS):
        day = as_of - timedelta(days=DEMAND_HISTORY_DAYS - 1 - offset)
        trend = 1 + 0.15 * (_rand(f"{sku_code}|{node_code}|trend|{offset // 14}") - 0.5)
        forecast = base_add * trend
        noise = (_rand(f"{sku_code}|{node_code}|noise|{offset}") * 2 - 1) * noise_scale
        actual = max(0.0, forecast + noise)
        session.add(DemandObservation(
            sku_code=sku_code, node_code=node_code, observed_date=day,
            forecast_qty=round(forecast, 3), actual_qty=round(actual, 3),
        ))

    promised_lt = 3 + _rand(f"{sku_code}|promised-lt") * 4
    lt_noise_scale = 0.5 + _rand(f"{sku_code}|lt-noise-scale") * 1.5
    fill_base = 0.75 + _rand(f"{sku_code}|fill-base") * 0.23
    ordered_qty = base_add * 7

    await session.execute(
        LeadTimeObservation.__table__.delete().where(
            LeadTimeObservation.sku_code == sku_code, LeadTimeObservation.node_code == node_code
        )
    )
    for i in range(LEAD_TIME_DELIVERIES):
        order_date = as_of - timedelta(days=LEAD_TIME_DELIVERY_SPACING_DAYS * i)
        lt_noise = (_rand(f"{sku_code}|{node_code}|lt-noise|{i}") * 2 - 1) * lt_noise_scale
        actual_lt = max(0.5, promised_lt + lt_noise)
        fill_noise = (_rand(f"{sku_code}|{node_code}|fill-noise|{i}") * 2 - 1) * 0.05
        fill_fraction = min(1.0, max(0.5, fill_base + fill_noise))
        session.add(LeadTimeObservation(
            sku_code=sku_code, node_code=node_code, order_date=order_date,
            promised_lead_time_days=round(promised_lt, 2), actual_lead_time_days=round(actual_lt, 2),
            ordered_qty=round(ordered_qty, 3), received_qty=round(ordered_qty * fill_fraction, 3),
        ))


async def _seed_cost_profile(session: AsyncSession, sku_code: str):
    unit_cost = round(20 + _rand(f"{sku_code}|unit-cost") * 480, 2)
    # Phase 4 additions: shortage/expiry penalties documented as a multiple of unit
    # cost (no real penalty feed exists), MOQ documented as a flat case-pack assumption.
    shortage_penalty = round(unit_cost * 1.5, 2)  # stocking out costs more than holding it
    expiry_penalty = round(unit_cost * 1.0, 2)  # write-off loses the full unit cost
    moq_units = 24.0  # flat case-pack assumption
    await _upsert(session, SkuCostProfile, "sku_code", {
        "sku_code": sku_code, "unit_cost": unit_cost,
        "holding_cost_pct": HOLDING_COST_PCT, "ordering_cost": ORDERING_COST,
        "shortage_penalty_per_unit": shortage_penalty, "expiry_penalty_per_unit": expiry_penalty,
        "moq_units": moq_units,
    })


async def seed_dynamic_policy(session: AsyncSession, source_data_dir):
    today = date.today()
    skus_master = {row["skuCode"]: row for row in _load(source_data_dir, "sku.json")}

    await _backfill_classification(session, skus_master)
    await session.commit()

    pairs = await _sku_node_pairs(session)
    for sku_code, node_code in pairs:
        classification = skus_master.get(sku_code, {}).get("classification")
        await _seed_demand_and_lead_time(session, sku_code, node_code, classification, today)
        await _seed_cost_profile(session, sku_code)
    await session.commit()

    # Reset prior seed-created snapshots so re-running this seed (e.g. a container restart
    # on the same day) can't leave two identical "current" rounds where /policy/drift
    # expects a genuine previous-vs-current comparison. Snapshots created later by a live
    # POST /policy/refresh call are untouched - only this seed's own two rounds are reset.
    await session.execute(PolicySnapshot.__table__.delete())
    await session.commit()

    # Two rounds so /policy/drift has a real previous-vs-current comparison out of the box.
    previous_as_of = today - timedelta(days=7)
    await refresh_policy(session, None, None, computed_at=datetime.combine(previous_as_of, time(9, 0)), as_of=previous_as_of)
    await refresh_policy(session, None, None, computed_at=datetime.now(timezone.utc).replace(tzinfo=None), as_of=today)


async def main():
    async with SessionLocal() as session:
        await seed_dynamic_policy(session, settings.source_data_dir)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
