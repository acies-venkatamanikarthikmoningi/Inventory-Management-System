"""Phase 4 prerequisite: seed Bangalore and Hyderabad Distribution Centers
(Area/Zone/Bin/InventoryPosition/Batch), plus inter-node Lane transit
times/costs, so multi-echelon optimization has more than one node to balance
across.

Node names match src/pages/NodeSelection/NodeSelection.jsx exactly
("Bangalore Distribution Center", "Hyderabad Distribution Center"); lane
transit days reuse the figures already hardcoded there
(getDCtoDCTransferLeadTime's presetTimes for CHEN-DC<->BANG-DC/HYD-DC; the
Bangalore<->Hyderabad pair has no direct preset in that file, so it is
estimated the same way that file's own fallback does - via the map's
xPct/yPct distance formula). Transfer cost per unit is a documented flat
assumption (no real freight-cost feed exists anywhere in src/data/*.json).

Quantities at the two new nodes are deterministically hash-seeded (same
FNV-1a approach as app/seed/dynamic_policy.py) for most SKUs, EXCEPT a
curated subset of 12 SKUs that are deliberately engineered into
shortage-at-one-node / surplus-at-the-other scenarios, so the exceptions,
transfer-candidates, and Phase 4 optimization layers have a genuine,
reportable cross-node imbalance to detect and solve - not left to chance.
This is a simulated seed, same honesty standard as Phase 2/3's seed data.
"""
from datetime import date, timedelta
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.db.session import SessionLocal
from app.models import Area, Batch, Bin, InventoryPosition, Lane, Node, Zone
from app.seed.network_foundation import _load, _upsert
# Reuses dynamic_policy.py's exact base_add formula/hash so this seed's on-hand
# quantities land in the SAME FMCG-demand scale as Phase 3's independently
# computed ROP - using Chennai's small retail-mock on-hand figures as a scale
# reference here would reproduce the same magnitude mismatch Phase 3 already
# documented for capacity, this time against ROP, and defeat the point of
# engineering a genuine shortage/surplus scenario.
from app.seed.dynamic_policy import CLASSIFICATION_ADD_RANGE, DEFAULT_ADD_RANGE
from app.seed.dynamic_policy import _rand as _base_add_rand

CHENNAI = "Chennai Distribution Center"
BANGALORE = "Bangalore Distribution Center"
HYDERABAD = "Hyderabad Distribution Center"

NODE_SUFFIX = {BANGALORE: "BLR", HYDERABAD: "HYD"}

# Transit days/cost per lane. CHEN<->BANG and CHEN<->HYD reuse
# NodeSelection.jsx's getDCtoDCTransferLeadTime presetTimes exactly
# (0.8 day, 1.0 day). BANG<->HYD has no preset there; 1.5 days approximates
# that file's own distance-based fallback for two DCs this far apart.
# cost_per_unit is a documented flat per-case assumption (INR-scale, matching
# Phase 3's cost profile order of magnitude), not sourced from any real feed.
LANES = [
    (CHENNAI, BANGALORE, 0.8, 4.50),
    (BANGALORE, CHENNAI, 0.8, 4.50),
    (CHENNAI, HYDERABAD, 1.0, 5.00),
    (HYDERABAD, CHENNAI, 1.0, 5.00),
    (BANGALORE, HYDERABAD, 1.5, 5.50),
    (HYDERABAD, BANGALORE, 1.5, 5.50),
]

BIN_TYPES_CYCLE = ["AISLE", "RACK2D", "STAGE4P", "BULKUNL"]

PRESENCE_THRESHOLD = {BANGALORE: 0.70, HYDERABAD: 0.60}  # ~70%/~60% of the 50 SKUs stocked at each new DC


def _hash(value: str) -> int:
    h = 2166136261
    for ch in value:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def _rand(seed: str) -> float:
    return _hash(seed) / 4294967295


async def _seed_topology(session: AsyncSession):
    for node_name in (BANGALORE, HYDERABAD):
        suffix = NODE_SUFFIX[node_name]
        await _upsert(session, Node, "node_code", {"node_code": node_name, "description": node_name, "active": True})
        area_code = f"AREA-RS1-{suffix}"
        await _upsert(session, Area, "area_code", {"area_code": area_code, "description": "Reserve Storage", "type": "INVENTORY", "active": True})
        zone_code = f"ZONE-RS01-{suffix}"
        await _upsert(session, Zone, "zone_code", {"zone_code": zone_code, "description": zone_code, "face": "RESERVE", "area_code": area_code, "active": True})
    await session.commit()


def _base_add(sku_code: str, classification: str | None) -> float:
    lo, hi = CLASSIFICATION_ADD_RANGE.get(classification, DEFAULT_ADD_RANGE)
    return lo + _base_add_rand(f"{sku_code}|base-add") * (hi - lo)


async def _seed_inventory(session: AsyncSession, source_data_dir: Path):
    skus_master = _load(source_data_dir, "sku.json")

    sku_codes = [row["skuCode"] for row in skus_master]
    # Engineered, not hash-derived: first 6 SKUs get an explicit Bangalore
    # shortage / Hyderabad surplus, next 6 the reverse - guarantees concrete
    # cross-node transfer candidates regardless of how the random seed falls.
    engineered_short_blr = set(sku_codes[0:6])
    engineered_short_hyd = set(sku_codes[6:12])

    today = date.today()

    for node_name in (BANGALORE, HYDERABAD):
        suffix = NODE_SUFFIX[node_name]
        zone_code = f"ZONE-RS01-{suffix}"
        for row in skus_master:
            sku_code = row["skuCode"]
            present = _rand(f"{sku_code}|{suffix}|present") < PRESENCE_THRESHOLD[node_name]
            is_engineered = sku_code in engineered_short_blr or sku_code in engineered_short_hyd
            if not present and not is_engineered:
                continue

            base_add = _base_add(sku_code, row.get("classification"))
            # "Days of cover" (on-hand / daily demand), NOT a days-of-cover figure
            # borrowed from Chennai's small retail-mock on-hand quantities - those
            # are a different, incompatible scale from Phase 3's ADD-driven ROP.
            # Normal spread ~2-16 days naturally straddles the ~4-15 day ROP/ADD
            # ratio observed from Phase 3's real formula, producing a genuine mix
            # of below-ROP and above-ROP positions without any hand-picking.
            cover_days = 2.0 + _rand(f"{sku_code}|{suffix}|cover") * 14.0
            status = "Healthy"

            if sku_code in engineered_short_blr:
                cover_days = 1.0 if node_name == BANGALORE else 25.0
                if node_name == BANGALORE:
                    status = "Critical"
            elif sku_code in engineered_short_hyd:
                cover_days = 1.0 if node_name == HYDERABAD else 25.0
                if node_name == HYDERABAD:
                    status = "Critical"

            on_hand = round(max(base_add * cover_days, 5.0), 3)

            bin_type_code = BIN_TYPES_CYCLE[_hash(f"{sku_code}|{suffix}|bintype") % len(BIN_TYPES_CYCLE)]
            suffix_code = sku_code[-4:]
            bin_code = f"RS1-{suffix}-{suffix_code}"
            await _upsert(session, Bin, "bin_code", {"bin_code": bin_code, "description": bin_code, "type_code": bin_type_code, "zone_code": zone_code, "status": "ACTIVE"})

            shelf_life_months = row.get("shelfLife") or 12
            mfg_date = today - timedelta(days=5)
            expiry_date = mfg_date + timedelta(days=shelf_life_months * 30)
            batch_number = f"BCH-{suffix}-{suffix_code}"
            await _upsert(session, Batch, "batch_number", {
                "batch_number": batch_number, "sku_code": sku_code, "node_code": node_name,
                "mfg_date": mfg_date, "expiry_date": expiry_date,
                "shelf_life_months": shelf_life_months, "total_qty": on_hand,
            })

            source_id = f"INV-{suffix}-{suffix_code}"
            await _upsert(session, InventoryPosition, "source_id", {
                "source_id": source_id, "sku_code": sku_code, "node_code": node_name, "bin_code": bin_code,
                "batch_code": batch_number, "on_hand": on_hand, "on_order": 0, "in_transit": 0,
                "allocated": 0, "available": on_hand, "backorder": 0, "inventory_position": on_hand,
                "status": status, "expiry_date": expiry_date,
            })
    await session.commit()


async def _seed_lanes(session: AsyncSession):
    for source, dest, transit_days, cost_per_unit in LANES:
        row = (await session.scalars(select(Lane).where(Lane.source_node_code == source, Lane.dest_node_code == dest))).first()
        if row is None:
            session.add(Lane(source_node_code=source, dest_node_code=dest, transit_days=transit_days, cost_per_unit=cost_per_unit, lane_type="DC_TO_DC"))
        else:
            row.transit_days = transit_days
            row.cost_per_unit = cost_per_unit
    await session.commit()


async def seed_multi_node(session: AsyncSession, source_data_dir: Path):
    await _seed_topology(session)
    await _seed_inventory(session, source_data_dir)
    await _seed_lanes(session)


async def main():
    async with SessionLocal() as session:
        await seed_multi_node(session, settings.source_data_dir)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
