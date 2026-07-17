# Current-State Assessment

## Scope and method

Assessment completed on 2026-07-13 against the checked-out repository. This is a frontend-only React/Vite application named InventiQ. No production code was changed as part of this assessment.

## Architecture today

| Area | Current implementation | Assessment |
| --- | --- | --- |
| Frontend | React 19-style JSX application, Vite 8, React Router 7, CSS modules/global CSS | Preserve the UI, route structure, and enterprise FMCG vocabulary. |
| State | One `AppContext` holds auth, selected node, theme, toasts, sidebar state, inventory, ASNs, and replenishment config | Client state is session-only; operational data is seeded JSON. |
| Persistence | Browser `localStorage` for user, selected node, and last path | No server-side identity, audit trail, or transactional persistence. |
| API/backend | None | No FastAPI, database, migrations, integrations, workers, health checks, or OpenAPI contract exists. |
| Tests/CI | No test framework, test files, Docker, compose, or CI configuration found | Establish backend and frontend test foundations before claiming a delivery phase complete. |
| Dependencies | `lucide-react`, `react-router-dom`, `recharts`; TypeScript/Vite dev tooling | No data-fetching, API-contract, solver, or backend dependencies are present. |

An unused Vite TypeScript starter entry (`src/main.ts`, `src/counter.ts`, and starter assets) coexists with the actual React entry point (`src/main.jsx`). The build invokes `tsc && vite build`; it currently has no backend relationship.

## Routes and pages

| Route | Page | Current data/behavior | Future API/service |
| --- | --- | --- | --- |
| `/` | Welcome | Static landing page | None in Phase 1. |
| `/login` | Login | Two hardcoded demo credentials | Identity provider/auth service (outside initial inventory slice). |
| `/select-node` | Node Selection | Static India network, node KPIs, plant/DC and DC/DC lead-time presets plus geometric fallback | Network graph, nodes, echelons, lanes, lead-time profiles. |
| `/app/dashboard` | Dashboard | JSON-derived counts mixed with fixed KPI trends and activity | Network-state summary, exception summary, audit/activity feed. |
| `/app/inventory` | Inventory Snapshot | `inventory.json`, SKU reorder points, local filters/CSV export | Network state by SKU/node/batch; capacity reference data. |
| `/app/sku-explore` | SKU Master | `sku.json`, local editing display only | SKU master repository/API. |
| `/app/locations` | Location Hierarchy | Client-computed hierarchy/KPIs from inventory and static values | Node/warehouse hierarchy, inventory positions, capacity service. |
| `/app/data-upload` | Data Upload | Simulated upload, validation, history, and comparison | Staged import/validation API (later phase). |
| `/app/inbound` | Inbound | Seed ASNs and local receipt/auto-ASN state | Purchase orders, inbound inventory, ERP/WMS adapter. |
| `/app/replenishment` | Replenishment | Seed min/max config, local breach calculation, static drift scenarios, locally created ASNs | Policy/drift, replenishment recommendation, planner decision APIs. |
| `/app/batches` | Batch Tracking | Inventory JSON transformed into batches; local calendar/expiry bands | Batch/lot and expiry analytics APIs. |
| `/app/capacity` | Capacity Utilization | Fixed zones/racks; local intra-warehouse move simulation | Node capacity state and capacity-risk exceptions. |
| `/app/insights` | Inventory Insights | Ten hardcoded insight/recommendation cards and local status/comments | Exception and recommendation orchestration APIs. |
| `/app/settings` | Settings | Static audit/feature flags and local notification toggles | Policy/service-level configuration and audit API. |

## State, data, and business logic

### Context and UI state

`src/context/AppContext.jsx` seeds `inventoryData`, ASNs, and replenishment configuration from JSON. It also owns dummy login, node selection, UI preferences, and toast state. UI actions mutate React state only; there is no persistence, concurrency control, approval record, or writeback event.

### Seed datasets

| File | Records/shape | Use |
| --- | --- | --- |
| `inventory.json` | 150 inventory/batch-location rows | Inventory, snapshot, batch tracking, dashboard calculations. |
| `sku.json` | 50 SKUs | SKU Explorer, thresholds, inbound product lookup. |
| `replenishmentConfig.json` | 50 flat SKU/node min-max records | Replenishment configuration and local breach logic. |
| `inbound.json` | 5 ASNs | Inbound and replenishment-created ASN display. |
| `batches.json` | 10 batch records | Header search only; distinct schema from `inventory.json`. |
| `locations.json` | 5 warehouse hierarchy records | Static location/capacity reference. |
| `areaMaster.json`, `binCapacityMaster.json` | 3 areas, 8 bin types | Snapshot-derived capacity display. |

Data is not canonical: node names differ across sources (for example Pune Distribution Center/Pune Warehouse and Hyderabad Distribution Center/Hyderabad Plant). `normalizeNode` currently compensates only for a subset. Batch schemas also differ (`expiryDate` versus `expiry`), and no transactions, allocation, order, demand, forecast, lane, cost, service class, or lead-time observations exist.

### Identified static intelligence, rules, and simulations

| Location | Current behavior to replace or isolate |
| --- | --- |
| `pages/Replenishment/Replenishment.jsx` | `PARAMETER_DRIFT` contains three fully hardcoded recommendations, calculations, impact claims, and actions. Local min/max threshold breaches calculate `max - current`. Auto-approval creates a client-only ASN. |
| `pages/InventoryInsights/InventoryInsights.jsx` | `ALL_INSIGHTS` contains ten hardcoded operational alerts and prescribed actions. Status and comments are local only. |
| `pages/Dashboard/Dashboard.jsx` | Uses a module-level snapshot of `inventory.json`; capacity, damage, utilization, upload KPIs, sparkline history, and recent activity are hardcoded. Near-expiry is a fixed 90-day rule. |
| `pages/NodeSelection/NodeSelection.jsx` | All nodes, KPIs, plant-to-DC lanes, selected DC-to-DC lanes, and fallback travel time derived from screen coordinates are hardcoded. |
| `pages/CapacityUtilization/CapacityUtilization.jsx` | Zone/rack capacities are hardcoded and movement is a browser-only capacity simulation. |
| `pages/BatchTracking/BatchTracking.jsx` | Batch risk, supplier, quantity, and consumption are partially deterministically inferred from SKU codes; min receipt shelf life is set to 60% of total life. |
| `utils/uomDisplay.js` | Quantity/UOM values are deterministically fabricated from a hash of item fields rather than sourced from inventory/UOM conversions. |
| `utils/replenishmentStatus.js` | Uses static active ASN statuses and min/max threshold rules. It expects `config.levels`, but the actual seed configuration is flat (`min`, `max`, `uom`), so this shared helper has a schema mismatch. |
| `pages/InventorySnapshot/InventorySnapshot.jsx` | Low stock is evaluated against static SKU reorder points; near expiry is 90 days; capacity is inferred locally. |
| `pages/Inbound/Inbound.jsx`, `pages/DataUpload/DataUpload.jsx` | File handling/validation previews, receipt expiry, and history are simulated in-browser. |
| `components/Header/Header.jsx`, `pages/Settings/Settings.jsx` | Notifications, search index, audit entries, and AI feature status are static. |

## Capability gaps

The requested platform has no backend foundation yet: canonical relational model, network graph, async repositories, migrations, API versioning, authentication/authorization, event/audit persistence, observability, optimization, simulation, ERP abstraction, and automated tests are all absent. Existing UI functionality should be retained behind typed adapters as each equivalent endpoint is delivered.

## Migration guardrails

1. Keep all current routes, component hierarchy, CSS modules, navigation labels, and local interaction patterns.
2. Add a frontend API client and per-page loading, empty, error, and retry states before removing a seed import.
3. Normalize node IDs/names at the API boundary and use IDs internally; do not carry current display-name mappings into the canonical model.
4. Preserve the flat replenishment seed through a temporary adapter. The canonical policy model should expose explicit policy parameters and policy snapshots rather than inventing a `levels` shape in the UI.
5. Treat all present recommendation text, calculated UOM quantities, and simulated performance metrics as demo content, not operational facts.
