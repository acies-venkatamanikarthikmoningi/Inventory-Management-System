# Phase 1 API contract

`GET /api/v1/inventory/network-state?node=&sku=&page=1&page_size=250` returns inventory-position rows plus `areaCode`, `areaDescription`, `zoneCode`, `zoneDescription`, `binCode`, and `binDescription`. This preserves the existing Inventory Snapshot hierarchy filters when the API is enabled.

`GET /api/v1/network/graph` exposes the read-only node graph. `GET /api/v1/health` checks process liveness and `GET /api/v1/ready` checks database reachability.

Set `VITE_API_BASE_URL` to use the API. If it is unset, the documented development fallback uses existing local JSON. If configured API access fails, the UI retains the fallback but records an explicit error in the shared network-state adapter; it does not label that data as live.
