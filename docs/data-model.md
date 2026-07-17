# Phase 1 canonical data model

Phase 1 establishes UUID primary keys and immutable unique business keys. `InventoryPosition.bin_code` is the location key; Area and Zone are intentionally resolved through `Bin -> Zone -> Area`, rather than duplicated on the projection.

| Entity | Business key | Key Phase 1 fields |
| --- | --- | --- |
| Area | `areaCode` | description, type, active |
| Zone | `zoneCode` | description, face, areaCode, active |
| BinType | `typeCode` | capacity/handling-unit fields, active |
| Bin | `binCode` | description, typeCode, zoneCode, status |
| InventoryPosition | source record ID | SKU, node, bin, operational quantities and expiry |

The idempotent seed reads the existing `src/data/areaMaster.json`, `binCapacityMaster.json`, `sku.json`, and `inventory.json`. As this repository has no `zoneMaster.json`, zones and bins are derived only from the existing inventory references; no new codes are created.

## Fill Rate module - separate database, separate schema

Unlike every table above, `SalesOrder`/`OrderFulfillment`/`PurchaseOrder`/`GoodsReceipt`
(`backend/app/fill_rate/models.py`) live in their own PostgreSQL database
(`fill_rate_db`), not `inventory`, on their own SQLAlchemy `Base` (`app/fill_rate/db.py`)
and their own Alembic history (`app/fill_rate/alembic/`, run via
`alembic -c alembic_fill_rate.ini`). This is intentional component isolation, not an
oversight: the Fill Rate module's code and data must be changeable without any risk to
Phase 1-5's schema or data, and vice versa - proved live by dropping `fill_rate_db`
entirely and confirming `/api/v1/inventory/network-state` and friends kept working
unaffected (see `docs/implementation-status.md`).

| Entity | Business key | Key fields |
| --- | --- | --- |
| SalesOrder | `order_id` | order_date, day, sku_code, sku_name, node, requested_qty |
| GoodsSent | (FK, one row per shipment line) | order_id (FK to SalesOrder.order_id), shipped_qty |
| PurchaseOrder | `po_number` | sku_code, node_code, supplier_code, order_date, ordered_qty, expected_date, status |
| GoodsReceipt | (append-only fact) | purchase_order_id (FK), received_qty, receipt_date, grn_reference |
| InventorySnapshot (unused, dormant) | sku_code+node_code+snapshot_date | on_hand_qty - upsert function exists but no endpoint is wired to it; left from an earlier draft, not removed since it isn't in anyone's way |

**L1 Fill Rate's `SalesOrder`/`GoodsSent` schema is authoritative and matches the real
source files exactly** (`backend/app/fill_rate/seed_data/Order_File_Week1.xlsx`'s
"Orders" sheet and `Goods_Sent_Register.xlsx`) - the backend adapts to these files'
columns, not the other way around. `app/fill_rate/seed.py` reads both directly from
`seed_data/` and upserts idempotently at container startup; **no upload step is
required** for this data (unlike `PurchaseOrder`/`GoodsReceipt`, which remain
upload-driven via `POST /api/v1/fill-rate/upload/{purchase-orders,goods-receipts}`,
parsed by `app/fill_rate/upload.py`, upserted/inserted the same way as before). See
`docs/implementation-status.md`'s "L1 Fill Rate" section for the real row counts, the
LEFT JOIN semantics, and the earlier abandoned schema iterations this superseded
(dropping `customer_code`, then the whole `order_number`/`OrderFulfillment` shape).
