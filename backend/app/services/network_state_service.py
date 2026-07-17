from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Area, Batch, Bin, InventoryPosition, Lane, Node, PolicyRecommendation, PolicySnapshot, Sku, Zone


async def _policy_and_score_lookup(session: AsyncSession, pairs: set[tuple[str, str]]) -> dict[tuple[str, str], dict]:
    """Latest policy_type (from PolicySnapshot) and the last network-wide
    evaluation's Robustness composite_score + governance_action (from
    PolicyRecommendation, written by POST /policy/recommendations/refresh)
    per (sku, node) pair present on this page only - not a full-network scan.
    A pair that has never been evaluated legitimately has no score (None),
    not a fabricated one - Inventory Snapshot must render that honestly as
    "not yet evaluated", not a made-up number."""
    if not pairs:
        return {}
    sku_codes = {p[0] for p in pairs}
    node_codes = {p[1] for p in pairs}

    snapshot_rows = (await session.scalars(
        select(PolicySnapshot)
        .where(PolicySnapshot.sku_code.in_(sku_codes), PolicySnapshot.node_code.in_(node_codes))
        .order_by(PolicySnapshot.computed_at.desc())
    )).all()
    policy_type_by_pair: dict[tuple[str, str], str] = {}
    for snap in snapshot_rows:
        key = (snap.sku_code, snap.node_code)
        policy_type_by_pair.setdefault(key, snap.policy_type)

    rec_rows = (await session.scalars(
        select(PolicyRecommendation)
        .where(PolicyRecommendation.sku_code.in_(sku_codes), PolicyRecommendation.node_code.in_(node_codes))
    )).all()
    eval_by_pair: dict[tuple[str, str], PolicyRecommendation] = {}
    for rec in rec_rows:
        eval_by_pair[(rec.sku_code, rec.node_code)] = rec

    result = {}
    for pair in pairs:
        rec = eval_by_pair.get(pair)
        # An auto-change is already applied by the evaluation cycle.  The
        # recommendation row deliberately keeps the old policy's score for
        # its audit/history card, but Inventory Snapshot represents the live
        # policy and must therefore show the score simulated for the policy
        # now in force.  This also prevents a stale sub-40 pre-change score
        # from being displayed after governance has acted.
        live_score = None
        if rec is not None:
            live_score = (
                rec.suggested_composite_score
                if rec.governance_action == "auto_changed" and rec.suggested_composite_score is not None
                else rec.current_composite_score
            )
        result[pair] = {
            "policyType": policy_type_by_pair.get(pair),
            "robustnessScore": float(live_score) if live_score is not None else None,
            "governanceAction": rec.governance_action if rec is not None else None,
        }
    return result


async def network_state(session: AsyncSession, node: str | None, sku: str | None, page: int, page_size: int):
    query = (select(InventoryPosition, Sku, Node, Bin, Zone, Area, Batch)
        .join(Sku, InventoryPosition.sku_code == Sku.sku_code)
        .join(Node, InventoryPosition.node_code == Node.node_code)
        .join(Bin, InventoryPosition.bin_code == Bin.bin_code)
        .join(Zone, Bin.zone_code == Zone.zone_code)
        .join(Area, Zone.area_code == Area.area_code)
        .outerjoin(Batch, InventoryPosition.batch_code == Batch.batch_number))
    if node:
        query = query.where(Node.node_code == node)
    if sku:
        query = query.where(InventoryPosition.sku_code == sku)
    count_query = select(func.count()).select_from(query.subquery())
    total = await session.scalar(count_query) or 0
    rows = (await session.execute(query.order_by(InventoryPosition.source_id).offset((page - 1) * page_size).limit(page_size))).all()

    pairs = {(p.sku_code, n.node_code) for p, s, n, b, z, a, batch in rows}
    policy_lookup = await _policy_and_score_lookup(session, pairs)

    items = []
    for p, s, n, b, z, a, batch in rows:
        enrichment = policy_lookup.get((p.sku_code, n.node_code), {})
        items.append({
            "id": p.source_id, "skuCode": p.sku_code, "skuName": s.description, "node": n.node_code, "batch": p.batch_code,
            "onHandQty": float(p.on_hand), "inTransitQty": float(p.in_transit), "reservedQty": float(p.allocated),
            "availableQty": float(p.available), "inventoryPositionQty": float(p.inventory_position), "status": p.status,
            "expiry": p.expiry_date, "mfgDate": batch.mfg_date if batch else None,
            "shelfLifeMonths": batch.shelf_life_months if batch else None,
            "areaCode": a.area_code, "areaDescription": a.description, "zoneCode": z.zone_code, "zoneDescription": z.description,
            "binCode": b.bin_code, "binDescription": b.description,
            "policyType": enrichment.get("policyType"), "robustnessScore": enrichment.get("robustnessScore"),
            "governanceAction": enrichment.get("governanceAction"),
        })
    return {"items": items, "total": total, "page": page, "pageSize": page_size}


async def network_graph(session: AsyncSession):
    nodes = (await session.scalars(select(Node).order_by(Node.node_code))).all()
    lanes = (await session.scalars(select(Lane).order_by(Lane.source_node_code, Lane.dest_node_code))).all()
    return {
        "nodes": [{"code": node.node_code, "description": node.description} for node in nodes],
        "edges": [{"source": lane.source_node_code, "target": lane.dest_node_code,
                   "transitDays": float(lane.transit_days), "costPerUnit": float(lane.cost_per_unit),
                   "laneType": lane.lane_type} for lane in lanes],
    }
