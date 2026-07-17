# Target Architecture Proposal

## Recommended boundary

Adopt a modular monolith in a new `backend/` directory while keeping the existing Vite application in place. The frontend becomes a typed consumer of `/api/v1`; it remains independently runnable during migration.

```text
React/Vite frontend
  -> typed API client + page adapters
  -> FastAPI /api/v1
       -> services -> repositories -> SQLAlchemy async -> PostgreSQL
       -> optimization -> Pyomo -> solver_adapter -> HiGHS
       -> simulation -> deterministic seeded Monte Carlo
       -> integrations -> ERP/WMS/OMS adapter ports
       -> workers -> scheduled/retryable jobs (Redis-backed)
```

## Backend layout

```text
backend/
  app/
    api/v1/             # routers and versioned request/response endpoints
    core/               # settings, logging, error handling, security
    db/                 # async session, metadata, Alembic wiring
    models/             # SQLAlchemy entities
    schemas/            # Pydantic contracts
    repositories/       # persistence access only
    services/           # business orchestration
    optimization/       # formulation, scenarios, solver abstraction
    simulation/         # policy simulation and Monte Carlo
    integrations/       # adapter interfaces and mock ERP implementation
    workers/            # async/scheduled tasks
  alembic/
  tests/
```

## Canonical model strategy

Use stable UUID primary keys and unique business keys for SKU code, node code, lane code, batch/lot code, and external reference. Model the requested entities in dependency order: reference masters (SKU, Node, Echelon, Lane, ServiceClass, Area, Zone, BinType, Bin), operational facts (Batch/Lot, InventoryPosition, InventoryTransaction, PurchaseOrder, InTransitInventory, DemandHistory, ForecastSnapshot, LeadTimeObservation, SupplierPerformance), calculated/policy objects (LeadTimeProfile, ReplenishmentPolicy, PolicySnapshot, Exception, ExpiryEvent), then run/governance objects (optimization/simulation runs and scenarios, candidates, recommendations, evidence, decisions, writeback events).

Inventory position must be a calculated or materialized projection with explicit `on_hand`, `on_order`, `in_transit`, `allocated`, `available`, `backorder`, and `inventory_position`. It references `binCode` as its location key; Zone and Area resolve through `Bin -> Zone -> Area`. Batch-level quantities retain expiry, quality status, and node/location; FEFO is enforced by allocation and transfer candidate services, never by presentation code.

## Cross-cutting decisions

* PostgreSQL is the system of record; Redis supports cache, locks, and work queues, not source-of-truth inventory.
* All endpoint contracts are Pydantic DTOs. API response mappings isolate existing display field names from canonical database fields.
* Alembic migrations must include downgrade paths and seed data must be idempotent.
* A solver adapter owns HiGHS/Pyomo details. Services consume solver-neutral run/result objects.
* Optimization and simulation persist inputs, deterministic seed, version, status, duration, objective/metrics, and evidence references for reproducibility.
* Recommendations only convert persisted policy/solver/simulation output to planner language. Any LLM, if later added, may summarize the recorded evidence but cannot set quantities or policy values.
* ERP writeback is an adapter port with idempotency key, immutable `ERPWritebackEvent`, retry-safe external event ID, and status transitions.
* FastAPI exposes `/health` (process alive) and `/ready` (database/required dependencies reachable), structured JSON logs, and request/run metrics.

## Phase 1 API boundary

Phase 1 implements `GET /api/v1/inventory/network-state` with filters for node and SKU/pagination as needed. Its response is the first authoritative UI contract and includes each requested inventory measure and risk field. A proposed supporting `GET /api/v1/network/graph` is read-only and enables Node Selection without embedding lane data in React.
