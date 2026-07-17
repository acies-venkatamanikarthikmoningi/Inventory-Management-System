"""Idempotently port the repository's de-identified Phase 1 JSON seed data."""
import json
from datetime import date
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Area, Bin, BinType, InventoryPosition, Node, Sku, Zone
from app.core.config import settings
from app.db.session import SessionLocal


def _load(directory: Path, name: str):
    with (directory / name).open(encoding="utf-8") as stream:
        return json.load(stream)


async def _upsert(session, model, key, values):
    row = (await session.scalars(select(model).where(getattr(model, key) == values[key]))).first()
    if row is None:
        session.add(model(**values))
    else:
        for name, value in values.items():
            setattr(row, name, value)


async def seed_network_foundation(session: AsyncSession, source_data_dir: Path):
    areas = _load(source_data_dir, "areaMaster.json")
    bin_types = _load(source_data_dir, "binCapacityMaster.json")
    inventory = _load(source_data_dir, "inventory.json")
    skus = _load(source_data_dir, "sku.json")
    for area in areas:
        await _upsert(session, Area, "area_code", {"area_code": area["areaCode"], "description": area["description"], "type": area["type"], "active": area.get("active", True)})
    for item in bin_types:
        await _upsert(session, BinType, "type_code", {"type_code": item["typeCode"], "description": item["description"], "max_volume_m3": item["maxVolumeM3"], "max_weight_kg": item["maxWeightKg"], "bin_pallet_capacity": item["binPalletCapacity"], "storage_hu_type": item["storageHuType"], "active": item.get("active", True)})
    for item in skus:
        await _upsert(session, Sku, "sku_code", {"sku_code": item["skuCode"], "description": item.get("description") or item.get("skuName", item["skuCode"]), "active": item.get("status", "Active").lower() == "active"})
    # zoneMaster.json is absent in this seed; derive canonical zones/bins from its existing inventory references.
    for item in inventory:
        node_code = item["node"]
        await _upsert(session, Node, "node_code", {"node_code": node_code, "description": node_code, "active": True})
        face = "PICK" if "PK" in item["zoneCode"] else "RESERVE"
        await _upsert(session, Zone, "zone_code", {"zone_code": item["zoneCode"], "description": item["zoneCode"], "face": face, "area_code": item["areaCode"], "active": True})
        await _upsert(session, Bin, "bin_code", {"bin_code": item["binCode"], "description": item.get("location", item["binCode"]), "type_code": item["binTypeCode"], "zone_code": item["zoneCode"], "status": "ACTIVE"})
        await _upsert(session, InventoryPosition, "source_id", {"source_id": item["id"], "sku_code": item["skuCode"], "node_code": node_code, "bin_code": item["binCode"], "batch_code": item.get("batch", ""), "on_hand": item.get("onHandQty", 0), "on_order": 0, "in_transit": item.get("inTransitQty", 0), "allocated": item.get("reservedQty", 0), "available": item.get("availableQty", 0), "backorder": 0, "inventory_position": item.get("availableQty", 0), "status": item.get("status", "Healthy"), "expiry_date": date.fromisoformat(item["expiry"]) if item.get("expiry") else None})
    await session.commit()


async def main():
    async with SessionLocal() as session:
        await seed_network_foundation(session, settings.source_data_dir)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
