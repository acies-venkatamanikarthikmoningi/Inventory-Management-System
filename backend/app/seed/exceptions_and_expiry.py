"""Idempotently derive canonical Batch master data from the repository's existing inventory seed."""
from datetime import date
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.db.session import SessionLocal
from app.seed.network_foundation import _load, _upsert
from app.models import Batch


async def seed_batches(session: AsyncSession, source_data_dir: Path):
    inventory = _load(source_data_dir, "inventory.json")
    # batchMaster.json is absent in this seed; derive one canonical batch per de-duplicated
    # batch code from inventory.json, the same way Phase 1 derived Zone/Bin when
    # zoneMaster.json was absent.
    batches: dict[str, dict] = {}
    for item in inventory:
        code = item.get("batch")
        if not code:
            continue
        batch = batches.setdefault(code, {
            "batch_number": code,
            "sku_code": item["skuCode"],
            "node_code": item["node"],
            "mfg_date": date.fromisoformat(item["mfgDate"]),
            "expiry_date": date.fromisoformat(item["expiry"]),
            "shelf_life_months": item.get("shelfLife", 0),
            "total_qty": 0,
        })
        batch["total_qty"] += item.get("onHandQty", 0)
    for values in batches.values():
        await _upsert(session, Batch, "batch_number", values)
    await session.commit()


async def main():
    async with SessionLocal() as session:
        await seed_batches(session, settings.source_data_dir)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
