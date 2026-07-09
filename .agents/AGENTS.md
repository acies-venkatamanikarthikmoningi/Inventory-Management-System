# Project Custom Rules: InventiQ FMCG Enterprise Focus

Ensure all future features, terminology, and UI alignments adhere to enterprise supply chain standards (inspired by SAP, Blue Yonder, Oracle).

## Terminology Alignment
* **SKU / Material Master**: Refer to products/items with Enterprise FMCG standards. Use SKU Code, Material ID, or GTIN.
* **Nodes**: Represent nodes as Plants (Manufacturing Nodes), Distribution Centers (DC), or Central Warehouses.
* **Warehouse Hierarchy**: Use Area, Storage Zone, Storage Bin / Rack, and Level.
* **Inventory Categories**:
  * Unrestricted Use (Available Stock)
  * Blocked Stock (Damaged / Quality Issues)
  * Quality Inspection (Quarantined)
  * Reserved Stock (Committed to Active Orders / Deliveries)
* **Planning Metrics**:
  * Safety Stock (SS)
  * Reorder Point (ROP)
  * Economic Order Quantity (EOQ)
  * Days of Supply / Days of Inventory (DOS / DOI)
  * Lead Time (LT)
  * Service Level (SL)
* **Batch Operations**: Use FEFO (First Expired First Out) rules for tracking and batch allocation priority.

## UI Design & Standards
* Preserve clean grids, structured tables, and data density typical of SAP Fiori / professional enterprise visibility grids.
* Provide quick actions for replenishment triggers, stock transfers (STO), write-offs, and quality inspections.
