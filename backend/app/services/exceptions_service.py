from datetime import date
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Batch, Bin, InventoryPosition, Lane, Node, PolicySnapshot, Sku, Zone

NEAR_EXPIRY_DAYS = 90
CRITICAL_EXPIRY_DAYS = 30
MIN_SHELF_LIFE_FRACTION = 0.6


def shelf_life_feasible(batch: Batch, as_of: date, min_fraction: float = MIN_SHELF_LIFE_FRACTION) -> bool:
    total_life_days = (batch.expiry_date - batch.mfg_date).days
    if total_life_days <= 0:
        return False
    remaining_days = (batch.expiry_date - as_of).days
    return (remaining_days / total_life_days) >= min_fraction


async def fefo_order(session: AsyncSession, sku_code: str, node_code: str | None = None):
    """Open positions for a SKU ordered First-Expiry-First-Out for allocation/picking priority."""
    query = (select(InventoryPosition, Batch)
        .join(Batch, InventoryPosition.batch_code == Batch.batch_number)
        .where(InventoryPosition.sku_code == sku_code))
    if node_code:
        query = query.where(InventoryPosition.node_code == node_code)
    rows = (await session.execute(query.order_by(Batch.expiry_date.asc()))).all()
    return [(p, b) for p, b in rows]


def _exception(position, sku, node, exception_type, severity, message, expiry, days_remaining) -> dict:
    return {
        "positionId": position.source_id, "skuCode": sku.sku_code, "skuName": sku.description, "node": node.node_code,
        "batch": position.batch_code, "exceptionType": exception_type, "severity": severity,
        "message": message, "expiryDate": expiry, "daysRemaining": days_remaining,
        "availableQty": float(position.available),
    }


async def detect_exceptions(session: AsyncSession, as_of: date | None = None) -> list[dict]:
    as_of = as_of or date.today()
    query = (select(InventoryPosition, Sku, Node, Batch)
        .join(Sku, InventoryPosition.sku_code == Sku.sku_code)
        .join(Node, InventoryPosition.node_code == Node.node_code)
        .outerjoin(Batch, InventoryPosition.batch_code == Batch.batch_number))
    rows = (await session.execute(query.order_by(InventoryPosition.source_id))).all()

    exceptions: list[dict] = []
    for position, sku, node, batch in rows:
        expiry = position.expiry_date
        days_remaining = (expiry - as_of).days if expiry else None

        if expiry and days_remaining < 0:
            exceptions.append(_exception(position, sku, node, "EXPIRED", "Critical",
                f"{sku.description} batch {position.batch_code} expired on {expiry.isoformat()}.", expiry, days_remaining))
        elif expiry and days_remaining <= NEAR_EXPIRY_DAYS:
            severity = "Critical" if days_remaining <= CRITICAL_EXPIRY_DAYS else "High"
            exceptions.append(_exception(position, sku, node, "NEAR_EXPIRY", severity,
                f"{sku.description} batch {position.batch_code} expires in {days_remaining} day(s) ({expiry.isoformat()}).", expiry, days_remaining))

        if batch and days_remaining is not None and days_remaining >= 0 and not shelf_life_feasible(batch, as_of):
            exceptions.append(_exception(position, sku, node, "SHELF_LIFE_INFEASIBLE", "Medium",
                f"{sku.description} batch {position.batch_code} no longer meets the minimum "
                f"{int(MIN_SHELF_LIFE_FRACTION * 100)}% shelf-life-remaining threshold for outbound dispatch.",
                expiry, days_remaining))

        if (position.status or "").lower() == "critical":
            exceptions.append(_exception(position, sku, node, "BACKORDER_RISK", "High",
                f"{sku.description} at {node.node_code} is flagged Critical (available {float(position.available)}).",
                expiry, days_remaining))

    return exceptions


async def _intra_node_candidates(session: AsyncSession, as_of: date | None = None) -> list[dict]:
    """Recommend moving near-expiry/shelf-life-infeasible reserve stock to an active pick face for
    the same SKU/node, so FEFO dispatch happens before the batch is written off."""
    as_of = as_of or date.today()
    query = (select(InventoryPosition, Sku, Node, Bin, Zone, Batch)
        .join(Sku, InventoryPosition.sku_code == Sku.sku_code)
        .join(Node, InventoryPosition.node_code == Node.node_code)
        .join(Bin, InventoryPosition.bin_code == Bin.bin_code)
        .join(Zone, Bin.zone_code == Zone.zone_code)
        .join(Batch, InventoryPosition.batch_code == Batch.batch_number))
    rows = (await session.execute(query)).all()

    pick_bins_by_sku_node: dict[tuple[str, str], tuple] = {}
    reserve_rows = []
    for position, sku, node, position_bin, zone, batch in rows:
        key = (position.sku_code, position.node_code)
        if zone.face == "PICK":
            pick_bins_by_sku_node.setdefault(key, (position_bin, zone))
        else:
            reserve_rows.append((position, sku, node, position_bin, zone, batch))

    candidates: list[dict] = []
    for position, sku, node, source_bin, source_zone, batch in reserve_rows:
        days_remaining = (batch.expiry_date - as_of).days
        if days_remaining < 0 or float(position.available) <= 0:
            continue  # already expired positions are a write-off decision, not a transfer candidate
        is_near_expiry = days_remaining <= NEAR_EXPIRY_DAYS
        is_infeasible = not shelf_life_feasible(batch, as_of)
        if not (is_near_expiry or is_infeasible):
            continue
        target = pick_bins_by_sku_node.get((position.sku_code, position.node_code))
        if not target:
            continue
        target_bin, target_zone = target
        reason = f"expires in {days_remaining} day(s)" if is_near_expiry else "fails the minimum shelf-life-remaining threshold"
        candidates.append({
            "skuCode": sku.sku_code, "skuName": sku.description, "batch": position.batch_code,
            "fromNode": node.node_code, "fromZone": source_zone.zone_code, "fromBin": source_bin.bin_code,
            "toZone": target_zone.zone_code, "toBin": target_bin.bin_code,
            "suggestedQty": float(position.available),
            "reason": f"Batch {reason}; prioritize move from reserve to pick face for FEFO dispatch.",
        })
    return candidates


async def cross_node_transfer_candidates(session: AsyncSession, as_of: date | None = None) -> list[dict]:
    """Recommend moving stock between DCs for the same SKU when one node is below its
    Phase 3 enhanced Reorder Point while another node holds surplus above its own ROP -
    the genuine cross-node imbalance Phase 2's single-node (Chennai-only) seed data
    never had. Feasibility requires a Lane between the two nodes and enough shelf life
    left on the source batch to survive that lane's transit time (reuses Phase 2's
    shelf-life-on-arrival check, applied to the inter-node transit time instead of an
    intra-node move)."""
    as_of = as_of or date.today()

    query = (select(InventoryPosition, Sku, Node, Bin, Zone, Batch)
        .join(Sku, InventoryPosition.sku_code == Sku.sku_code)
        .join(Node, InventoryPosition.node_code == Node.node_code)
        .join(Bin, InventoryPosition.bin_code == Bin.bin_code)
        .join(Zone, Bin.zone_code == Zone.zone_code)
        .outerjoin(Batch, InventoryPosition.batch_code == Batch.batch_number))
    rows = (await session.execute(query)).all()

    by_pair: dict[tuple[str, str], dict] = {}
    for position, sku, node, position_bin, zone, batch in rows:
        key = (position.sku_code, position.node_code)
        entry = by_pair.setdefault(key, {"sku": sku, "node": node, "available": 0.0, "batch": None, "bin_code": position_bin.bin_code, "zone_code": zone.zone_code})
        entry["available"] += float(position.available)
        if batch is not None and (entry["batch"] is None or batch.expiry_date > entry["batch"].expiry_date):
            entry["batch"] = batch
            entry["bin_code"] = position_bin.bin_code
            entry["zone_code"] = zone.zone_code

    snapshot_rows = (await session.scalars(select(PolicySnapshot).order_by(PolicySnapshot.computed_at.desc()))).all()
    latest_snapshot: dict[tuple[str, str], PolicySnapshot] = {}
    for snap in snapshot_rows:
        latest_snapshot.setdefault((snap.sku_code, snap.node_code), snap)

    lanes = {(lane.source_node_code, lane.dest_node_code): lane for lane in (await session.scalars(select(Lane))).all()}

    by_sku: dict[str, list[tuple[str, dict]]] = {}
    for (sku_code, node_code), entry in by_pair.items():
        snapshot = latest_snapshot.get((sku_code, node_code))
        if snapshot is None:
            continue
        rop = float(snapshot.enhanced_rop)
        entry["rop"] = rop
        entry["shortage"] = max(rop - entry["available"], 0.0)
        entry["surplus"] = max(entry["available"] - rop, 0.0)
        by_sku.setdefault(sku_code, []).append((node_code, entry))

    candidates: list[dict] = []
    for sku_code, node_entries in by_sku.items():
        if len(node_entries) < 2:
            continue
        shortages = [(n, e) for n, e in node_entries if e["shortage"] > 0]
        surpluses = sorted(((n, e) for n, e in node_entries if e["surplus"] > 0), key=lambda ne: -ne[1]["surplus"])
        for short_node, short_entry in shortages:
            for surplus_node, surplus_entry in surpluses:
                if surplus_node == short_node or surplus_entry["surplus"] <= 0 or short_entry["shortage"] <= 0:
                    continue
                lane = lanes.get((surplus_node, short_node))
                if lane is None:
                    continue
                batch = surplus_entry["batch"]
                if batch is not None:
                    total_life_days = (batch.expiry_date - batch.mfg_date).days
                    remaining_after_transit = (batch.expiry_date - as_of).days - float(lane.transit_days)
                    if total_life_days <= 0 or (remaining_after_transit / total_life_days) < MIN_SHELF_LIFE_FRACTION:
                        continue  # would arrive without enough shelf life remaining - not a viable transfer
                qty = min(short_entry["shortage"], surplus_entry["surplus"])
                if qty <= 0:
                    continue
                sku = surplus_entry["sku"]
                candidates.append({
                    "skuCode": sku_code, "skuName": sku.description,
                    "batch": batch.batch_number if batch is not None else surplus_entry["bin_code"],
                    "fromNode": surplus_node, "fromZone": surplus_entry["zone_code"], "fromBin": surplus_entry["bin_code"],
                    "toNode": short_node, "toZone": short_entry["zone_code"], "toBin": short_entry["bin_code"],
                    "suggestedQty": round(qty, 3),
                    "reason": (
                        f"below its Reorder Point at {short_node} (available {short_entry['available']:.0f} vs ROP "
                        f"{short_entry['rop']:.0f}) while {surplus_node} holds surplus above its own ROP "
                        f"(available {surplus_entry['available']:.0f} vs ROP {surplus_entry['rop']:.0f}); "
                        f"recommended for cross-node transfer ({float(lane.transit_days):.1f}-day lane, shelf life permitting)."
                    ),
                })
                short_entry["shortage"] -= qty
                surplus_entry["surplus"] -= qty
    return candidates


async def transfer_candidates(session: AsyncSession, as_of: date | None = None) -> list[dict]:
    """Combines Phase 2's intra-node reserve-to-pick-face candidates with Phase 4's
    cross-node rebalancing candidates. Both share the same item shape (fromNode/
    fromZone/fromBin[/toNode]/toZone/toBin/suggestedQty/reason) so existing consumers
    of this endpoint need no changes; toNode is additive and only present on
    cross-node items."""
    as_of = as_of or date.today()
    intra = await _intra_node_candidates(session, as_of)
    cross = await cross_node_transfer_candidates(session, as_of)
    return intra + cross
