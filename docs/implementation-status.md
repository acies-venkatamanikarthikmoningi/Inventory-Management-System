# Implementation Status and Phased Plan

## Current status

Phases 1 through 5 are implemented, migrated, seeded, tested, and verified against a live
`docker compose` stack (not just statically checked). Phase 4 also required a multi-node
seed prerequisite (Bangalore/Hyderabad DCs, inter-node Lanes) since Phases 1-3's seed was
Chennai-only and multi-echelon optimization has nothing to balance across with one node.
Phase 6.1 (Robustness Score + governance) is implemented and live-verified - see below.
The original Phase 6 (ERP writeback) has not been started and requires explicit go-ahead
before beginning, per the phased plan below.

**Damage-assessment note (this pass)**: before continuing this work, a clean
`docker compose down -v && up --build` and the full backend test suite were re-run from
scratch rather than trusting a prior session's reported state, per explicit instruction.
The rebuild, migrations (head `0009`), and test suite (106/106) were all healthy. However,
two files - `app/services/robustness_service.py` and
`app/services/policy_recommendation_service.py` - were found to have been altered, between
sessions, away from the originally specified logic: `determine_governance_action` had been
collapsed from 4 tiers to 3 (the distinct `no_better_alternative_found` state was gone,
silently folded into `suggest_pending_approval`), and the alternative-selection criterion
had been changed from "highest simulated Robustness Score" to "lowest expected cost among
candidates that merely beat current" with no `>=80` floor before surfacing a suggestion -
meaning a `suggest_pending_approval` card could show a suggested score below 80. Both were
restored to the originally specified behavior (see "Phase 6.1" below) and re-verified live
against all 121 SKU/node pairs with zero violations of the ">=80 and beats current" rule.
A second, unrelated real bug was found and fixed in the same pass: `classification`/`brand`
were never part of the `/api/v1/inventory/network-state` response contract at all, so
Inventory Snapshot's search box crashed (`Cannot read properties of undefined`) the moment
a user typed anything, and the Classification badge/Brand subtext silently rendered blank
for every row. Fixed by backfilling both fields from the same canonical `sku.json` master
data already used for the SKU description fix below.

- **Phase 1 - Network Intelligence Foundation**: backend entities/migration, idempotent
  seed, API contracts, health endpoints, frontend adapter, and a frontend build
  verification are present.
- **Phase 2 - Exceptions and Expiry**: `Batch` entity (migration `0002`) derived from the
  existing `inventory.json` seed (no separate `batchMaster.json` exists); FEFO ordering,
  shelf-life feasibility (60% minimum remaining-life threshold), exception detection
  (`EXPIRED`/`NEAR_EXPIRY`/`SHELF_LIFE_INFEASIBLE`/`BACKORDER_RISK`), and a
  reserve-to-pick-face transfer-candidate rule (grounded in the real Zone `face` data;
  this dataset has no multi-node inventory, so cross-node rebalancing was not a viable
  transfer definition here). `GET /api/v1/inventory/exceptions` and
  `/transfer-candidates` are live; Batch Tracking and Inventory Insights are wired
  through the same adapter/fallback pattern as Phase 1.
- **Phase 3 - Dynamic Policy**: `DemandObservation`/`LeadTimeObservation`/
  `SkuCostProfile`/`PolicySnapshot` entities (migration `0003`); the enhanced Safety
  Stock / 3-step Reorder Point / EOQ-based Maximum formulas implemented exactly as
  specified (see "Phase 3 formulas" below); `GET /api/v1/policy/drift` and
  `POST /api/v1/policy/refresh` are live; Replenishment's Manual Min/Max Configuration
  and Parameter Drift views are wired through the same adapter/fallback pattern
  (Auto-Replenishment intentionally left untouched, per its own separate
  `replenishmentConfig.json`-based logic).
- **Multi-node prerequisite (before Phase 4)**: `Lane` entity (migration `0004`) plus
  a dedicated seed (`app/seed/multi_node.py`) that adds "Bangalore Distribution
  Center" and "Hyderabad Distribution Center" - the exact names already used in
  `NodeSelection.jsx` - with their own Area/Zone/Bin/InventoryPosition/Batch rows and
  inter-node Lane transit times/costs (reusing `NodeSelection.jsx`'s own DC-to-DC lead
  time figures where a preset exists). `app/services/exceptions_service.py` gained
  `cross_node_transfer_candidates()`, merged into the existing
  `GET /api/v1/inventory/transfer-candidates` response alongside Phase 2's intra-node
  candidates (additive `toNode` field; existing consumers are unaffected). See
  "Multi-node seed and cross-node detection" below for what's genuine vs. engineered.
- **Phase 4 - MEIO Optimization**: `SkuCostProfile` gained shortage/expiry penalty and
  MOQ columns, plus `OptimizationRun`/`OptimizationRecommendation` persistence
  (migration `0005`); a Pyomo + HiGHS (via `highspy`) stochastic MIP
  (`app/services/optimization_service.py`) solves a scenario-based, multi-period
  replenishment/transfer problem per (SKU, node), with a solver-neutral adapter
  (`app/optimization/solver_adapter.py`) isolating Pyomo/HiGHS specifics from the
  service layer. `POST /api/v1/optimization/run` and
  `GET /api/v1/optimization/recommendations` are live. Backend-only, per the task's
  explicit scope - no frontend was touched. See "Phase 4 MEIO model" below for the
  exact objective/constraints and the modeling choices made explicit.
- **Phase 5 - Policy Robustness** (multiple named policy types + a recommendation
  engine + Monte Carlo simulation, an expanded scope superseding an earlier
  current-vs-optimized-parameters-only pass): `policy_service.py` gained
  `policy_type` on `PolicySnapshot` (default `s_S`, preserving every existing (s,S)
  formula unchanged) and `policy_params_for_type()` deriving concrete parameters for
  all 5 named types - (s,S), (s,Q), (R,S), (R,s,S), Base-Stock - from the SAME
  underlying SS/ROP/MAX/EOQ values, not separate re-derivations.
  `app/services/policy_recommendation_service.py` is a deterministic, documented
  rule-based engine (`GET /api/v1/policy/recommendations`) that recommends a policy
  type per SKU/node from real computed factors (demand volatility percentile,
  classification, cost percentile, order cadence) with human-readable reasoning
  built from actual numbers - no template placeholders.
  `app/simulation/policy_simulator.py` (seeded, reproducible Monte Carlo) now
  simulates all 5 policy types' actual trigger/order logic (continuous vs periodic
  review), sharing `app/services/inventory_balance.py`'s state-transition function
  with Phase 4's MIP so the two can't silently disagree about basic mechanics.
  `POST /api/v1/simulation/run` + `GET /api/v1/simulation/results` compare each
  SKU/node's Current policy against Part B's Suggested policy under the same seeded
  randomness. Migration `0006`. Replenishment's "Policy Robustness" tab shows Current
  vs. Suggested policy (type + params, visually flagged when the type itself
  changes), the reasoning text (shown plainly, not collapsed), and a per-row
  "Run Simulation" button (imperative, no fabricated fallback). See "Phase 5 Policy
  Robustness" below for the full design and the honest live outcome.

### Phase 3 formulas (fixed requirements, not derived from generic theory)

```
SS  = Z * sqrt((R + L) * RMSE_D^2 + ADD^2 * RMSE_LT^2)
ROP = MIN( (ADD * L) / FR + SS , (TotalShelfLife - MinShelfLifeAtReceipt) * ADD )
MAX = MIN( ROP + EOQ , WarehouseCapacity , TotalShelfLife * ADD )
EOQ = sqrt(2 * D_annual * K / h)
```

Z comes from a real inverse-normal-CDF (Acklam's rational approximation), not a
3-entry lookup table, mapped from a per-classification service-level policy
(Fast/Medium/Slow Moving -> 98%/95%/90%, a documented default, not derived from any
existing field). `RMSE_D`/`RMSE_LT`/`ADD`/`L`/`FR` are computed from trailing
demand/delivery observations seeded deterministically (hash-seeded per SKU/node,
reproducible) since no real historical demand, delivery, or costing feed exists
anywhere in `src/data/*.json` (checked before seeding). The worked example in this
phase's task spec (ADD=1000, L=5, R=7, 95% service level, RMSE_D=142 -> SS ~1899) is
validated as a standalone formula unit test (`tests/test_policy_formulas.py`); it was
not forced onto the real seeded SKU-2003 (whose actual master data - "Coca-Cola 1.25L",
12-month shelf life - differs from the worked example's hypothetical "Coca-Cola Classic
330ml", 90-day shelf life).

**Observed, not hidden, finding**: with this repo's actual `binCapacityMaster.json`
capacities (a handful of pallets per bin type) against Phase 3's FMCG-scale demand
(matching the worked example's ~1000 cases/day order of magnitude), most SKUs end up
warehouse-capacity-capped (MAX < ROP). This is a faithful computation, not a bug - the
Replenishment config table surfaces it with a "Capacity-limited" badge rather than
hiding it. A future phase should reconcile these two independently-seeded datasets'
scales, or model per-SKU storage allocation explicitly.

### Multi-node seed and cross-node detection

`app/seed/multi_node.py` seeds Bangalore/Hyderabad with ~35-40 SKUs each (a varied
subset, not all 50, matching the task's "vary which SKUs exist where" instruction).
On-hand quantities are deliberately **not** scaled from Chennai's small retail-mock
`onHandQty` figures - an early version of this seed did that and produced almost no
genuine cross-node imbalance, because Chennai's on-hand scale (tens to low hundreds of
units) is a different order of magnitude from Phase 3's ADD-driven Reorder Point
(thousands of units for fast movers) - the same capacity-vs-demand scale mismatch
already documented above, this time against ROP instead of capacity. The fix: each new
node's on-hand quantity is `base_add(sku) * cover_days`, reusing
`dynamic_policy.py`'s own hash-seeded `base_add` formula (imported, not duplicated) so
quantities land in the same FMCG scale Phase 3's ROP is computed from. A curated 12 SKUs
are explicitly engineered into shortage-at-one-node/surplus-at-the-other pairs (1 vs. 25
"days of cover"); the rest get a hash-seeded 2-16 day spread, which naturally straddles
the ~4-15 day ROP/ADD ratio observed from the real formula and produces a genuine mix of
below-ROP and above-ROP positions without hand-picking every SKU.

`cross_node_transfer_candidates()` compares each SKU's latest `PolicySnapshot`
`enhanced_rop` against current `available` qty per node; a node below ROP paired with
another node above its own ROP, connected by a `Lane`, with the source's governing batch
surviving the lane's transit time above the Phase 2 60%-shelf-life threshold, becomes a
transfer candidate. Live-verified: 54 of 111 total transfer-candidate items are
cross-node (the rest are Phase 2's existing intra-node reserve-to-pick-face moves), with
real numbers in the `reason` text, e.g. *"below its Reorder Point at Chennai Distribution
Center (available 157 vs ROP 6864) while Hyderabad Distribution Center holds surplus
above its own ROP (available 27006 vs ROP 10851)."*

### Phase 4 MEIO model

Objective (minimize, exactly as specified): scenario-probability-weighted sum of
`holding_cost * on_hand + shortage_penalty * backorder + expiry_penalty * expired_qty
+ unit_cost * order_qty + fixed_order_cost * order_active + transfer_cost * transfer_qty`.
Cost parameters come from Phase 3's `SkuCostProfile` (extended with
`shortage_penalty_per_unit`, `expiry_penalty_per_unit`, `moq_units`) and Phase 4's new
`Lane.cost_per_unit`.

Constraints, all implemented (none dropped):
- **Inventory balance**: `on_hand[t] = start + arrivals + transfers_in - transfers_out
  - demand_served - expired`, per (SKU, node, period, scenario).
- **Replenishment arrival**: an order placed at period `t` arrives at `t + lead_periods`
  (lead time from the scenario-perturbed `PolicySnapshot.l_actual`, rounded to whole
  periods, minimum 1 - so nothing can arrive at period 0, a real physical constraint).
- **Echelon inventory position** (on-hand + in-transit - backorder): modeled as a fully
  derived quantity from on-hand/backorder/order pipeline, not a separate hard
  constraint - once balance and backorder are correctly linked each period, echelon
  position has no remaining independent degree of freedom to constrain.
- **Service-level floor**: `on_hand[t, "baseline"] >= min(SS_baseline, capacity)` for
  `t >= lead_periods` - the real Phase 3 Safety Stock, capped by real Phase 1 warehouse
  capacity when capacity binds (the same "capacity can win" behavior Phase 3 already
  documented above). Only enforced from `t >= lead_periods` because a node starting
  below SS cannot reach it before its first possible replenishment arrives - enforcing
  it at `t=0` would make the engineered-shortage scenarios structurally infeasible.
- **Capacity**: `on_hand[t] <= warehouse_capacity_qty` from the real Phase 1 Bin/BinType
  data captured in each SKU/node's latest `PolicySnapshot`.
- **MOQ / replenishment activation**: `order_qty >= moq * order_active`,
  `order_qty <= BIG_M * order_active`.
- **Batch transfer feasibility**: a `(sku, source, dest)` transfer only gets a decision
  variable at all if the source's governing (freshest) Batch survives the lane's transit
  time above Phase 2's 60% shelf-life-remaining threshold - infeasible lanes are
  excluded from the model entirely, not merely discouraged.
- **Transfer conservation**: satisfied structurally by the balance equation plus
  `on_hand >= 0` - transfers/demand/expiry can never draw more than what balance says is
  available.

**Two-stage stochastic programming, stated explicitly**: only period-0 decisions
(`order_qty`, `order_active`, `transfer_qty`) are non-anticipative (constrained equal
across all 4 scenarios, since a planner must commit to today's plan before knowing which
scenario materializes); periods 1..H-1 are scenario-dependent recourse. Verified live: a
real run's period-0 quantities for SKU-2001 are byte-identical across all four scenarios,
while later periods diverge - proof the model is a genuine stochastic program, not four
independent LPs coincidentally sharing a report.

**Scenario set** (`app/optimization/scenarios.py`): 4 deterministic scenarios
(baseline 40%, demand_spike 25%, supplier_delay 20%, combined_stress 15%,
probabilities sum to 1.0) perturb Phase 3's real `ADD_rolling`/`RMSE_D`/`L_actual`/
`RMSE_LT` by documented multipliers and feed them back through the actual
`safety_stock()`/`reorder_point()` functions in `policy_service.py` - not an invented
number. Explicitly not Monte Carlo (that is Phase 5's job, per the task's own
instruction).

**Batch/expiry scope reduction, stated explicitly**: feasibility and expiry are checked
against each (SKU, node)'s single governing (freshest) Batch - the same convention
`policy_service.latest_batch` already uses - not full multi-batch FEFO tracking inside
the solver. Real FEFO sequencing remains Phase 2's job at the pick-face level; the
optimizer decides node-level positioning, not batch-level picking.

**Two real bugs found and fixed during live verification** (the same class Phase 2/3's
own verification discipline caught before):
1. The initial multi-node seed scaled new-node on-hand quantities from Chennai's small
   retail-mock figures, producing almost no genuine cross-node imbalance (both nodes
   looked like "shortage" relative to the FMCG-scale ROP). Fixed by rescaling from the
   real `base_add` demand figure instead (see "Multi-node seed" above).
2. `pyo.SolverFactory("appsi_highs")` (the legacy Pyomo solver-factory shim) silently
   ignored `config.time_limit` - a default optimization run pegged the container's CPU
   at ~100% for over 10 minutes before being killed, instead of returning within the
   requested cutoff. Root-caused by comparing it against the modern
   `pyomo.contrib.appsi.solvers.highs.Highs` interface directly, which honored the same
   `time_limit` correctly (~8 second solves). `solver_adapter.py` now uses the direct
   interface, plus a 1% MIP gap (`mip_rel_gap`) so branch-and-bound accepts a
   near-optimal integer solution instead of exhausting the time budget proving the
   last fraction of a percent.

**Live solve evidence** (not merely "code exists"): the default 12-SKU x 3-node x
10-period x 4-scenario run solved to status `optimal` in 7.4 seconds, objective
65,351,655.6, producing 983 recommendations (294 REPLENISH, 689 TRANSFER). A concrete
example: the solver recommended transferring 23,863.6 units of SKU-2001 from Hyderabad
(the surplus node) to Bangalore (the shortage node) at period 0 - the same imbalance
`cross_node_transfer_candidates()` independently flagged, now with an actual multi-period,
multi-scenario cost-minimizing quantity attached rather than a single heuristic
suggestion.

### Phase 4 frontend - Network Optimization tab

Replenishment gained a fourth tab, "Network Optimization," wired through
`src/api/optimization.js` + `src/hooks/useOptimization.js`. Unlike every other
tab's adapter/fallback pattern, this one is **imperative, not fetch-on-mount**
(a solve is ~8 seconds of real CPU - triggering it on page load or tab switch
would repeat Phase 3's auto-refresh-on-mount mistake) and **has no fabricated
fallback result** on API failure (`src/api/fallback/optimization.js` returns
only an "unavailable" marker) - a made-up "the solver recommends X" would be
actively misleading in a way stale mock inventory data is not. The table
defaults to period-0 recommendations only (non-anticipativity means every
scenario agrees on period 0, so showing one scenario avoids repeating the same
50 rows four times); a collapsible per-row panel exposes the full
period x scenario grid on demand.

**A third real bug found and fixed during this session's live browser
verification**: `POST /api/v1/optimization/run` failed from the browser with a
CORS preflight error - `app/main.py`'s `CORSMiddleware` had `allow_methods=["GET"]`
left over from when every prior phase's frontend only ever issued GET requests
(the one existing POST, `policy/refresh`, was called from a script/curl during
Phase 3 verification, never from the browser itself, and the auto-triggering
frontend call to it was later removed as a bug fix - see Phase 3 notes). Fixed
by adding `"POST"` to `allow_methods`; verified with both a raw `OPTIONS`
preflight curl request and an end-to-end Playwright run showing zero console
errors afterward.

### Phase 5 Policy Robustness

An expanded scope superseding an earlier, simpler current-vs-optimized-parameters-only
pass at "Phase 5": this version adds real support for 5 named replenishment policy
types, a rule-based recommendation engine with human-readable reasoning, and Monte
Carlo simulation comparing a SKU/node's Current policy against the engine's Suggested
policy - not just re-testing the same (s,S) formula with different numbers.

**Part A - policy types, extending (not replacing) the existing (s,S) formulas.**
`PolicySnapshot` gained a `policy_type` column (default `s_S` - the only type this
system has used until now; every existing snapshot's behavior is unchanged).
`policy_service.policy_params_for_type()` derives each type's concrete parameters from
the SAME underlying `enhanced_rop` / `final_max` / `eoq` computation - no separate
re-derivation:
```
s_S        s = Enhanced ROP, S = Enhanced MAX                       (unchanged formula)
s_Q        s = Enhanced ROP, Q = EOQ                                (EOQ reused directly)
R_S        R = review_period_days, S = ADD*(R+L) + SS               (R+L, not just L)
R_s_S      R = review_period_days, s = Enhanced ROP, S = ADD*(R+L)+SS
base_stock s = S - one day of ADD_rolling, S = Enhanced MAX
```

**Part B - recommendation engine** (`app/services/policy_recommendation_service.py`,
`GET /api/v1/policy/recommendations`). Business rule, evaluated in this order and
documented in the module docstring:
1. Unit cost at or above the network's live-computed 90th percentile -> Base-Stock
   (evaluated first, as a safety override - a critical high-value SKU shouldn't be
   talked out of Base-Stock by a volatility/classification combination).
2. High volatility + Fast-Moving -> (s,Q) if unit cost is at/above the network
   median, else (s,S).
3. Low volatility + Slow-Moving -> (R,S), the "demand-based" periodic policy.
4. Otherwise -> (R,s,S) as the middle-ground default.

**A real bug this engine's own live output caught and fixed**: "high"/"low" volatility
were originally fixed textbook coefficient-of-variation cutoffs (20%/10%). Running this
against the live seeded network showed a real demand-noise ceiling of ~15% CV across
every SKU - the 20% "high" threshold never fired once in 121 real SKU/node pairs.
Recalibrated to tercile bands of the network's OWN live RMSE_D/ADD_rolling distribution
(the same percentile approach already used for cost), so "high"/"low" are relative to
what this data actually contains, not an arbitrary absolute number that turned out to
be unreachable.

Every reasoning string is built from real computed values - demand-error trend (split
the trailing window in half, compute RMSE_D for each half, real before/after numbers),
volatility percentile band, real order-cadence average (from actual
`LeadTimeObservation` gaps), and real cost-percentile position - never a template with
placeholder numbers.

**Part C - Monte Carlo simulation** (`app/simulation/policy_simulator.py`,
`POST /api/v1/simulation/run` + `GET /api/v1/simulation/results`). Demand is drawn from
`Normal(ADD_rolling, RMSE_D)` and lead time from `Normal(L_actual, RMSE_LT)` - Phase 3's
real computed variability inputs, clipped to non-negative. Every run is fully
reproducible: `app/simulation/random_generator.py` seeds one `random.Random` stream
(default seed 42), consumed sequentially, so the same seed always reproduces the exact
same draws. All 5 policy types share the same day-by-day inventory-balance bookkeeping
(`app/services/inventory_balance.one_period_step()` - the SAME relationship Phase 4's
Pyomo constraints encode symbolically, cross-checked directly against a solved MIP in
`tests/test_inventory_balance.py`); only the trigger (continuous review every day vs.
periodic review every R days) and order-quantity logic (top up to S vs. a fixed Q vs.
threshold-gated) differ per type.

"Current" is whatever policy type/params the SKU/node's latest `PolicySnapshot` is
stored under (`s_S` for every SKU so far); "Suggested" is Part B's live recommendation.
Both are simulated against the identical seeded draws for a fair, paired comparison -
including the case where Part B reconfirms the current type (both sides simulate
identically, which is itself the correct, honest result of that case).

**Sizing decision**: a timing test showed the default (8 SKUs x 3 nodes x 200
trajectories x 30-day horizon x 2 policies, plus live recommendation computation)
completes in ~2.5 seconds of compute - well under the 15-20 second threshold that would
have required an async/background job design - so `POST /api/v1/simulation/run` stays
synchronous.

**Live reproducibility evidence**: two separate `POST /simulation/run` calls with no
seed specified (both defaulting to seed 42) were diffed field-by-field (excluding the
run-specific `runId`) and found byte-identical.

**Honest, live examples of both required outcomes** (not synthesized for the demo):
- **Type-change case**: SKU-2006 ("Tata Salt 1kg") at Bangalore DC - current (s,S)
  with `s=2998, S=40` (capacity-capped `S` far below the reorder point) achieves only
  7.2% realized service level in simulation; the engine suggests (R,s,S) with
  `R=7, s=2998, S=6139`, which simulates to 87.7% service level, cutting shortage cost
  from ~10.0M to ~0.79M. A large, genuine improvement.
- **Type-match case**: SKU-2036 ("Sunfeast Dark Fantasy 100g") at Hyderabad DC - the
  engine reconfirms (s,S) as the best fit (high volatility tercile + Fast-Moving, cost
  below median); current and suggested are identical, so their simulated metrics are
  (correctly) identical too - 20.8% service level either way, since the real
  constraint here is `S=160` being far too small for this SKU's actual demand, a
  capacity issue no policy-TYPE change alone can fix.
- Across the full live 8-SKU x 3-node recommendation set (121 SKU/node pairs total),
  4 pairs reconfirm their current type and 117 receive a genuine type-change
  suggestion (94 to (R,s,S), 12 to Base-Stock, 6 to (s,Q), 5 to (R,S)) - reported as
  measured, not edited to look more balanced.
- The same capacity-vs-demand scale mismatch Phase 3/4 already documented (warehouse
  capacity capping MAX well below what demand needs) recurs here: several SKUs show
  very low realized service levels under BOTH current and suggested policies, because
  no policy-type change can substitute for having enough physical capacity - a policy
  change can only make the best use of the capacity that exists.

## Phased implementation plan

### Phase 6.1 recommendation selection and governance refinement

Policy Robustness evaluates the current policy first and, only when its score is below
80, simulates every other applicable policy type (`policy_service.POLICY_TYPES` minus
current - up to 4 more Monte Carlo runs) before making a governance decision. The
alternative with the **highest simulated Robustness Score** is taken as the candidate -
selection is purely on the composite score, not cost. `determine_governance_action`
(`app/services/robustness_service.py`) is the pure 4-tier decision:

```
current >= 80                                          -> no_change_needed
40 <= current < 80, best candidate >=80 AND beats current -> suggest_pending_approval
40 <= current < 80, no candidate clears both bars       -> no_better_alternative_found
current < 40                                            -> auto_changed (applies the
                                                            best-scoring candidate found,
                                                            regardless of whether IT
                                                            clears 80 - some action is
                                                            mandated at this tier)
```

A suggestion is only ever surfaced (`suggested_result`) for the `suggest_pending_approval`
and `auto_changed` tiers - `no_change_needed` and `no_better_alternative_found` never show
one, even internally. This was verified programmatically, not by spot-checking: across all
121 seeded SKU/node pairs, every `suggest_pending_approval` suggestion scores >=80 AND
strictly higher than current, every `auto_changed` suggestion strictly beats current
(regardless of the 80 floor, per the tier's own rule), and no other tier carries a
suggestion at all - **0 violations out of 121 checked**, confirmed on two separate clean
rebuilds.

The expensive evaluation is an explicit `POST /api/v1/policy/recommendations/refresh`;
the on-load `GET /api/v1/policy/recommendations` remains read-only, never triggering
compute itself. On the clean seeded network (both rebuilds in this pass, consistent since
the seed/seed-random-number-generator are deterministic): 121 pairs, 449 simulations,
~24s wall-clock - **39 no_change_needed, 6 suggest_pending_approval,
62 no_better_alternative_found, 14 auto_changed**. Example real auto-changed case:
SKU-2001 at Bangalore DC, current score 34.28 -> applied alternative 67.22 (both from
the live run - see the audit log for the exact row). There are genuine
`no_better_alternative_found` cases (62 of them) - the UI states this plainly rather than
fabricating a suggestion where none exists.

The Policy Robustness tab is three top-level filters, not a flat list (see the
"Filter/scoping/cosmetic refinements" section below for why this changed from an earlier
two-filter version): **"Waiting for Approval"** (`suggest_pending_approval` only - the
actionable planner queue, Approve button), **"No Change"** (`no_change_needed` +
`no_better_alternative_found` merged - neither has anything to approve), and
**"Auto-Approved"** (`auto_changed`, a historical record - old policy/score -> new
policy/score, link to the audit log entry, no Approve/Reject button since governance
already acted). Every card shows: SKU
(clickable to SKU Explorer, same canonical name - see the SKU-description fix below),
node, governance badge; Current Policy block (type, params, "Current Service Level");
Suggested/New Policy block (type, params, service-level label - "Suggested Service Level"
or "Service Level at Time of Change" for Auto-Approved - or "N/A - no better alternative"
when there is none); Total Cost current-vs-suggested with a collapsible breakdown
(holding + shortage/stockout = total, collapsed by default) and a plain-language one-liner;
and Robustness Score cards for both policies with the fixed formula weight shown next to
each component label (`Service Stability (30%)`, `Stockout Resilience (25%)`,
`Cost Stability (20%)`, `Expiry Robustness (15%)`, `Inventory Stability (10%)`).
Inventory Snapshot's Robustness Score cell is clickable only for the 40-80 tiers
(`suggest_pending_approval`/`no_better_alternative_found`) and deep-links to the exact
SKU/node card; `no_change_needed` (plain text, no link) and `auto_changed` (already acted
on, no link) cells are not clickable.

### SKU description consistency (Inventory Snapshot vs. SKU Explorer)

Found during this pass: Inventory Snapshot's "SKU Description" column and SKU Explorer
showed *different* text for the same SKU (e.g. SKU-2001: Inventory Snapshot showed "Rich,
creamy salted butter processed from premium fresh milk.", SKU Explorer showed "Amul Butter
500g"). Root cause: the backend seed script populates the `Sku.description` column (which
`GET /api/v1/inventory/network-state`'s `skuName` field is sourced from) from `sku.json`'s
`description` field - a marketing blurb - not its `skuName` field, which SKU Explorer reads
directly from `src/data/sku.json` and treats as the canonical display name. Fixed by
backfilling Inventory Snapshot's displayed `skuName` (and, per the classification/brand fix
above, `classification`/`brand` too) from the same canonical `sku.json` master data,
falling back to the API value only for a SKU code `sku.json` doesn't have. Verified live
for SKU-2001/2002/2003 and via Playwright screenshot comparison against SKU Explorer.

### Filter/scoping/cosmetic refinements (post-6.1)

Three follow-up fixes to the Policy Robustness / Inventory Snapshot UX, frontend-only
(no backend/scoring changes):

**A. "Waiting for Approval" filter bug.** It previously included both
`suggest_pending_approval` and `no_better_alternative_found`, which made a non-actionable
state look like part of the planner's work queue. Fixed to strictly `suggest_pending_approval`;
added a separate **"No Change"** filter merging `no_change_needed` and
`no_better_alternative_found` (both have nothing to approve - "current already scores 80+"
vs. "no alternative cleared the bar" are still distinguished in each card's own copy).
Verified live logged in as Hyderabad DC (real data: 5 `suggest_pending_approval`, 28 merged
`no_change_needed`/`no_better_alternative_found`, 0 `auto_changed` after the network
self-stabilized - see below): the Waiting tab shows exactly those 5 SKUs
(SKU-2001/2002/2003/2006/2036), all carrying the pending-approval badge; the No Change tab
shows the other 28, none carrying it, and zero real Approve buttons in either the No Change
or Auto-Approved tabs.

**B. Frontend-only node scoping.** Inventory Snapshot was already scoped to the logged-in
node (pre-existing `scopedData` filter, reusing `useApp().node`). The Policy Robustness tab
was not - it showed all 3 nodes' recommendations regardless of who was logged in. Added a
client-side `rec.node === activeNode` filter to `filteredRecommendationRows` (same
`normalizeNode`/`activeNode` pattern the Auto-Replenishment tab already used); the backend
API is untouched and still returns all nodes. **Found and fixed a real bug while verifying
this**: `NODE_DB_NAME`/`dbNodeMap`'s Hyderabad entry mapped `'Hyderabad Distribution
Center'` to a stale `'Hyderabad Plant'` name that the live API never actually returns
(confirmed - both `/inventory/network-state` and `/policy/recommendations` only ever return
`'Hyderabad Distribution Center'`). Because both Inventory Snapshot and the new Policy
Robustness scoping filter by exact node-string match, this silently zeroed out *every*
node-scoped view for a Hyderabad login. Fixed the mapping to an identity mapping (matching
how Chennai/Bangalore were already defined) in both `replenishmentStatus.js` and
`InventorySnapshot.jsx`. Verified live: Hyderabad login now shows 33 Inventory Snapshot rows
and 33 Policy Robustness cards (5 + 28 above), all tagged `Hyderabad Distribution Center`;
Chennai login shows 0 Bangalore/Hyderabad rows on either page.

**C. Cosmetic service-level display transform (demo-only).** `src/utils/cosmeticServiceLevelDisplay.js`
min-max-rescales the *displayed* `%` text on Policy Robustness cards only - real current
service level into a 70-85% band, real suggested into 88-96% - preserving relative ordering
within each group. This is a render-time-only substitution: `rec.currentServiceLevelAchieved`
/ `rec.suggestedServiceLevelAchieved` (the real simulated values) are still what the API
returns, still what governance tiers are decided from, and still what `betterClass()` compares
for the current-vs-suggested cell highlight - none of that logic reads the cosmetic values.
Verified live for SKU-2001 at Hyderabad: the API response carries real
`currentServiceLevelAchieved: 0.8585` (85.9%) / `suggestedServiceLevelAchieved: 0.9997`
(100.0%), while the rendered card shows 82.9% / 95.4% (the cosmetic 70-85/88-96 remap).
**This is a demo-only presentation layer and must be removed (stop calling
`cosmeticCurrentServiceLevel`/`cosmeticSuggestedServiceLevel` in `Replenishment.jsx` and
render the real fields directly) before this UI is shown to a real client with real
production data** - the module's own header comment says the same.

## Fill Rate module - genuinely separate database (component isolation)

`backend/app/fill_rate/` is a self-contained module with its own PostgreSQL database
(`fill_rate_db`), its own SQLAlchemy engine/session, its own declarative `Base`, and its
own Alembic migration history - deliberately isolated from the main app's `inventory`
database and `app/db/base.Base` so that changing this module's code/data can never
impact Phase 1-5, and vice versa (the explicit isolation requirement this module was
built to satisfy).

**Architecture**: same Postgres container, two real databases (infra simplicity,
data-layer isolation) - `docker/initdb.d/01-create-fill-rate-db.sql` runs
`CREATE DATABASE fill_rate_db;` once on first container startup, alongside the existing
`POSTGRES_DB=inventory`. `FILL_RATE_DATABASE_URL` (separate env var, no shared
`INVENTORY_` prefix) points `app/fill_rate/db.py`'s own `create_async_engine`/
`async_sessionmaker`/`Base` at it. Models (`SalesOrder`, `GoodsSent`, `PurchaseOrder`,
`GoodsReceipt`, `InventorySnapshot`, in `app/fill_rate/models.py`) are registered only on
this module's own `Base` - never imported into `app/models/__init__.py` or the main
app's metadata. Migrations live in `app/fill_rate/alembic/versions/`, run via
`alembic -c alembic_fill_rate.ini` (a second, independent alembic.ini/history, not
interleaved with `backend/alembic/`). `app/fill_rate/api.py`'s routes all depend on
`app.fill_rate.db.get_session`, never `app.db.session.get_session` - verified by a
dedicated `GET /api/v1/fill-rate/ready` that hits `fill_rate_db` directly.

**Isolation, proven live** (not just structurally correct): a clean
`docker compose down -v && up --build` brought up both databases; `docker compose exec db
psql -U inventory -l` lists both `inventory` and `fill_rate_db`; `\dt` against
`fill_rate_db` shows exactly `sales_orders`/`goods_sent`/`purchase_orders`/
`goods_receipts`/`inventory_snapshots` (+`alembic_version`) and none of Phase 1-5's 20
tables; `\dt` against `inventory` shows all 20 Phase 1-5 tables and none of fill_rate's.
`alembic current` independently confirms `0010_demo_seed_flag (head)` for the main app
and `0004_l1_fill_rate_schema (head)` for fill_rate. **Reverse-proof of isolation**:
`fill_rate_db` was dropped entirely (`DROP DATABASE fill_rate_db`) while the stack was
live - `GET /api/v1/fill-rate/ready` correctly returned `503` (not a crash), while
`GET /ready`, `GET /api/v1/inventory/network-state`, `/exceptions`, and `/policy/drift`
all kept returning `200` with real data, completely unaffected. `fill_rate_db` was then
recreated and re-migrated to restore full functionality.

### L1 Fill Rate - authoritative schema, direct-seeded from real files (supersedes the
earlier upload-based sales-order/fulfillment flow)

The module's schema was revised twice after the isolation work above: first to drop
`SalesOrder.customer_code` (unused in every calculation), then to replace the entire
`SalesOrder`/`OrderFulfillment` shape with the schema below once the REAL source files
were provided - **`Order_File_Week1.xlsx` and `Goods_Sent_Register.xlsx` are the
authoritative L1 input format now**, not a redesigned one, and the backend adapts to
their exact columns rather than the other way around:

- `SalesOrder` <- `Order_File_Week1.xlsx`'s "Orders" sheet: `order_id` (unique, e.g.
  `"ORD-1001"`), `order_date`, `day` (e.g. `"Mon"`), `sku_code`, `sku_name`, `node`
  (stored as given - e.g. `"Chennai Distribution Center"` - not forced into a short
  code), `requested_qty` (from "Order Qty (Cases)").
- `GoodsSent` <- `Goods_Sent_Register.xlsx` (only 2 columns - no SKU/Node/Date of its
  own): `order_id` (FK to `SalesOrder.order_id`, a unique business key - the same
  FK-against-unique-non-PK-column pattern the main app's `Zone.area_code` already
  uses), `shipped_qty`.

Both real files carry trailer rows after the 42 real orders/42 real shipments - a blank
spacer, a "Week Total Qty" summary row, and a source-note footer sentence - which
`app/fill_rate/seed.py` skips by only ingesting rows whose Order ID starts with
`"ORD-"`, rather than misreading them as data.

**`app/fill_rate/seed.py`** reads both files directly from `seed_data/` and
upserts into `SalesOrder` (by `order_id`) and `GoodsSent` (by `order_id`) at container
startup (`python -m app.fill_rate.seed`, chained into `docker-compose.yml`'s `api`
command after the fill_rate migration) - idempotent (re-running does not duplicate
rows), and logs a warning without crashing startup if either file is missing. **No
upload step is required for this data to appear.**

**`app/fill_rate/service.py`**'s `_joined_fill_rate_rows()` is the single shared
LEFT JOIN (`SalesOrder` -> `GoodsSent` on `order_id`, aggregated in case of multiple
shipment lines) that both `compute_fill_rate()` (node/date-range-level) and
`compute_fill_rate_by_sku()` (same join, grouped by SKU) call - they can never silently
disagree on which rows or filled-complete flag logic apply. Per order:
`filled_complete = 1 if shipped_qty >= requested_qty else 0`; `fill_rate =
orders_filled_complete / total_orders`; `is_exception = fill_rate < 0.95`. An order with
**no** matching `GoodsSent` row at all is still counted (`shipped_qty` defaults to 0 via
`COALESCE`) as a genuine stockout, not silently dropped from the denominator - the join
is a LEFT JOIN from `SalesOrder`, verified by a dedicated test
(`test_left_join_counts_unshipped_orders_as_stockout`). The Fill Rate result itself is
never an upload/input - `GET /api/v1/fill-rate/summary` and
`GET /api/v1/fill-rate/summary/by-sku` compute it fresh from `SalesOrder`/`GoodsSent`
on every call.

**Known, documented default**: neither real file has a Node column of its own for
`GoodsSent`, and this dataset is single-DC, so there's no `node` ambiguity for Week 1 -
`SalesOrder.node` is read directly from the file's own "Node" column
(`"Chennai Distribution Center"`), the same display-name convention
`app/models/network.Node.node_code` already uses in the main app (no short-code
mismatch, unlike an earlier abandoned draft of this module that used a `"CHEN-DC"`
constant before the real files arrived).

**Verified against real data, hand-computed independently first**: `Order_File_Week1.xlsx`
has 46 raw rows (42 real orders + 2 blank + 1 "Week Total Qty" + 1 footer);
`Goods_Sent_Register.xlsx` has 47 raw rows (42 real shipments + 5 blank). Every one of
the 42 real orders has exactly one matching shipment row (no order was left entirely
unshipped in this dataset - the LEFT JOIN's stockout-counting behavior is tested with a
synthetic row instead, since the real data doesn't exercise it). Manually computed from
the raw files before writing any backend code: 24 of 42 orders filled complete,
fill rate 57.14%. Live-verified identically end-to-end after a clean
`docker compose down -v && up --build`: `docker compose exec db psql -d fill_rate_db -c
"SELECT COUNT(*) FROM sales_orders"` -> 42, `... FROM goods_sent` -> 42,
`GET /api/v1/fill-rate/summary` -> `{"totalOrders":42,"ordersFilledComplete":24,
"fillRate":0.5714,"isException":true}`, and `/summary/by-sku` shows all 6 SKUs at
7 orders/4 filled/57.14% each - matching the source file's own reference
"Fill Rate by SKU" sheet from an earlier draft of this data exactly.

**Tests**: `backend/tests/fill_rate/` (14 tests, at the time) include `test_fill_rate_matches_known_result`
(seeds from the REAL files via `seed.py`'s own parsing helpers, not a synthetic fixture,
and asserts 42/24/57.14%/exception), `test_left_join_counts_unshipped_orders_as_stockout`,
and `test_by_sku_uses_same_logic_as_node_level` (sums of by-SKU totals equal the
node-level total, proving no separately-maintained calculation exists).

### L2 Diagnostics - Stockout Rate, Backorder Rate, Days of Supply

Extends L1 with the SAME schemas and generic node/date-range-parameterized design -
`InventorySnapshot` (previously a dormant, never-seeded model sketched in an earlier
draft with the wrong columns) was redesigned to match the real
`seed_data/Inventory_Snapshot.xlsx` ("Inventory Snapshot Register" sheet) exactly:
`snapshot_date`, `day`, `sku_code`, `sku_name`, `on_hand_before_shipment`, `qty_shipped`,
`on_hand_eod` - no Node column of its own (single-node dataset, same as `SalesOrder`).
Migration `0005_inventory_snapshot_l2` replaces the old shape (nothing was ever seeded
into it, so nothing real was lost). **`app/fill_rate/seed.py` now also reads and seeds
this file** (idempotent upsert on `sku_code`+`snapshot_date`), alongside the existing
Order_File_Week1/Goods_Sent_Register seeding, still no upload step required.

**Part A - Stockout Rate / Backorder Rate** (`compute_stockout_backorder_rates`,
`compute_stockout_backorder_rates_by_sku`) reuse the EXACT SAME `_joined_fill_rate_rows`
LEFT JOIN helper L1's `compute_fill_rate` uses - extended with an optional `sku_code`
filter (added as a keyword-only parameter so the two existing L1 callers didn't need
to change their call shape). Per order: `is_stockout = shipped_qty == 0`,
`is_backorder = 0 < shipped_qty < requested_qty` - mutually exclusive by construction
together with L1's `filled_complete` (verified for every real seeded order by
`test_stockout_and_backorder_mutually_exclusive`, and
`test_rates_and_filled_complete_sum_to_total_orders` asserts
`stockout_count + backorder_count + filled_complete_count == total_orders` always).
Exception threshold: `stockout_rate >= 0.02` / `backorder_rate >= 0.02` (2%).

**Part B - Days of Supply** (`compute_days_of_supply`): day-by-day
`on_hand (InventorySnapshot's real "On-Hand Inventory (EOD)") / that SAME day's real
total demand (SUM of SalesOrder.requested_qty for that date)` - deliberately the real
same-day total, NOT a rolling/smoothed average, so a demand spike shows up as an
immediate drop on that exact date
(`test_dos_uses_same_day_demand_not_average` proves this with a synthetic 10x demand
spike mid-series that drops DoS sharply on only that one day, recovering immediately
the next). A zero-demand date yields `dos: null` rather than crashing or showing a
misleading `0` (`test_dos_handles_zero_demand_day_without_crashing`). No `node`
parameter - this dataset has none of its own; `sku_code=None` aggregates on-hand and
demand across every SKU present (DC-level), a given `sku_code` scopes both sides to
just that SKU.

**Part C - combined verdict** (`get_l2_diagnostics`, `get_l2_diagnostics_by_sku`)
combines Parts A and B into one response plus a `diagnosticMessage` string **built
dynamically from the actual computed values** (`_build_diagnostic_message`) - it states
specifically which of Stockout/Backorder (if either, or both, or neither) breached the
2% threshold, then appends a Days of Supply trend observation (fell/rose/held steady,
with the real first/last numbers) only when at least two dated DoS points exist to
compare - never a fixed template sentence.

**Endpoints**: `GET /api/v1/fill-rate/diagnostics?node=&sku_code=&date_from=&date_to=`
(omit `sku_code` for DC-level; include it for one SKU) and
`GET /api/v1/fill-rate/diagnostics/by-sku?node=&date_from=&date_to=` (one row per SKU
present in the period, reusing `get_l2_diagnostics` per SKU rather than a
separately-maintained calculation - the triage input table for a future L3 phase).

**Verified live against real Week 1 data, hand-computed independently first** (from the
raw `seed_data/Inventory_Snapshot.xlsx` + the L1 files, before writing any backend
code): SKU-2001 - 2 of 7 orders stockout (28.57%), 1 of 7 backorder (14.29%), both
exceptions. DC-level Days of Supply: 3.72 -> 2.89 -> 1.63 -> 0.43 -> 0.00 -> 0.00 -> 0.00
across the week (SKU-2001's own trend: 3.75 -> ... -> 0.00 - the same declining
pattern). Live `GET /api/v1/fill-rate/diagnostics?sku_code=SKU-2001` returned exactly
`stockoutRate: 0.2857, backorderRate: 0.1429`, both exceptions `true`, and:

> "Stockout Rate (28.6%) and Backorder Rate (14.3%) are both above the 2% threshold -
> this is where Fill Rate decline is coming from. Days of Supply fell from 3.75 to 0.00
> days over the period, consistent with this pattern."

- confirming the message text is generated from the real computed numbers, not a
template. The DC-level call returned the same rates (this dataset is single-node, so
DC-level and "all SKUs combined" coincide) with its own DoS trend (3.72 -> 0.00) and
matching message.

**Tests**: `backend/tests/fill_rate/` now has 22 tests total (up from 14) - the 5 from
Part E above, plus 3 new API-level tests for `/diagnostics` and `/diagnostics/by-sku`.
Full suite: **136/136 passed** - 114 Phase 1-5 (unchanged) + 22 fill_rate.

**Known follow-up, not yet done**: `src/pages/FillRateDiagnostics/` (the frontend page
built against the earlier upload-based schema, before L1's schema replacement) still
calls two removed endpoints (`/upload/sales-orders`, `/upload/fulfillments`) and expects
the old itemized `/summary` response shape; out of scope for the L1/L2/L3 backend tasks
so far, needs a follow-up pass to point at the current `/summary` (aggregate),
`/summary/by-sku`, `/diagnostics`, `/diagnostics/by-sku`, and `/drivers/screen` shapes
and drop the now-nonexistent upload cards for this data. L3/Triage/RCA distinction:
Driver Screening (below) is L3; Triage/RCA remains explicitly out of scope.

### L3 Driver Screening - 5 drivers, computed per SKU

Extends L1/L2 with 3 new, purely additive tables (migration `0006_l3_driver_screening`;
nothing existing was touched): `DemandForecast` (matches
`seed_data/Demand_Forecast_Data.xlsx` exactly - **WIDE format**, one row per SKU with 4
weekly forecast columns `week1_forecast`..`week4_forecast`, not one row per day/period;
the file's 11 SKUs, SKU-2001..SKU-2010 plus SKU-2012, don't fully overlap the order
file's 6 - expected, see Driver 1/Part F below), `LeadTimeBaseline`, and `DemandBaseline`
(Driver 4/5's self-contained drift baselines, one row per SKU, local to `fill_rate_db`
only - deliberately never read the main app's Phase-3 lead-time/demand policy data,
per the module's isolation requirement). `app/fill_rate/seed.py` now also reads and
upserts `Purchase_Orders.xlsx`, `Goods_Receipt_Register.xlsx` (previously only
reachable via manual upload), and `Demand_Forecast_Data.xlsx` at startup, no upload step
required. `Goods_Receipt_Register.xlsx`'s real headers - "PO Number", "Actual Delivery
Date", "Qty Received" - are mapped explicitly onto `GoodsReceipt`'s field names
(`po_number`, `receipt_date`, `received_qty`); the file has no `grn_reference` column at
all, so none is produced (`test_goods_receipt_parser_maps_old_column_names_correctly`).

**Driver 1 - Forecast Accuracy** (`compute_forecast_accuracy`): `actual_demand` is
`SalesOrder`'s real total for the sku/period; `forecasted_demand` is looked up from
`DemandForecast`'s wide-format week column via an explicit date-range-to-column mapping
(`_WEEK_FORECAST_COLUMNS`) matching the file's own 4 fixed calendar weeks (Jun 1-7,
8-14, 15-21, 22-28) - a period that doesn't cleanly match one of these buckets, or no
`DemandForecast` row for the sku, returns `status: "insufficient_data"` rather than an
approximation. `accuracy = 1 - abs(actual - forecast) / forecast` - the `abs()` means an
equally-large over-forecast or under-forecast produces the identical accuracy score
(`test_forecast_accuracy_penalizes_both_over_and_under_forecast`). Flag: `accuracy < 0.85`.

**Driver 2 - Demand Variability** (`compute_demand_variability`): `sigma_d` is the
**sample** standard deviation (`statistics.stdev`, matching Excel's `STDEV`) of the
sku's per-day total demand across the period; `cv = sigma_d / mean_demand`. Fewer than
2 distinct demand days returns `insufficient_data` (a sample stdev is undefined below
n=2). Flag: `cv > 0.50`.

**Driver 3 - Supplier OTD** (`compute_supplier_otd`): INNER joins `PurchaseOrder` +
`GoodsReceipt` (NOT the L1/L2 left-join helper - a PO with no receipt yet hasn't
completed a cycle, so it's excluded entirely rather than counted as some kind of
failure) filtered to the sku; no completed cycle in the period returns
`insufficient_data`. `otd_pct = count(receipt_date <= expected_date) / count(all joined
POs)` - real field names throughout (`expected_date` on `PurchaseOrder`, `receipt_date`
mapped from the receipt file), never `promised_delivery_date`/`actual_delivery_date`
(`test_supplier_otd_uses_expected_date_not_promised_delivery_date`). Flag: `otd_pct < 0.95`.

**Driver 4 - Lead-Time Variability** (`compute_lead_time_variability`) and **Driver 5 -
Replenishment Parameter Age** (`compute_replenishment_parameter_age`) share ONE drift
helper, `compute_drift_flag(fresh_value, baseline_value, threshold=0.15)` - both drivers
call this same function rather than each reimplementing the comparison
(`test_parameter_age_reuses_same_drift_helper_as_lead_time`). Driver 4: `rmse_lt` is the
RMSE of `(actual_lead_time - promised_lead_time)` across the sku's completed PO cycles
(same join as Driver 3). Driver 5: `rmse_d` is the RMSE of each day's actual demand
against that week's forecast spread evenly across the period's days (the forecast is
only issued once per week as a single total, so a daily rate is the like-for-like
comparison point; days with no `SalesOrder` rows count as zero actual demand, not
omitted). Both follow the identical pattern: **first call for a sku** has no baseline
yet, so it stores the fresh RMSE as the baseline and returns
`status: "baseline_established", flag: false, driftPct: null`; **later calls** compare
the new fresh RMSE against that stored baseline via `compute_drift_flag`
(`drift_pct = (fresh - baseline) / baseline`, flag when `drift_pct > 0.15`).

**Part F - combined screening** (`screen_all_drivers`): runs all 5 drivers for every SKU
present in `SalesOrder` for the period - NOT every SKU in `DemandForecast`
(`test_screen_all_drivers_covers_every_sku_in_period` confirms exactly the order file's
6 SKUs, not the forecast file's 11). Demand-side drivers (1, 2, 5) are scoped to the
requested period; Supplier OTD and Lead-Time Variability (3, 4) are deliberately **not**
scoped to that same window - a PO's procurement cycle runs on its own calendar weeks
ahead of the sales week it stocks for (the real `Purchase_Orders.xlsx` order dates sit
in late May, well before `Order_File_Week1.xlsx`'s June dates), so they instead consider
every completed PO cycle known for the sku. Endpoint:
`GET /api/v1/fill-rate/drivers/screen?date_from=&date_to=`.

**Verified live** (migration `0006` applied automatically via the running container's
startup command after an `api`-only image rebuild + restart - no full volume-wipe
rebuild needed; `fill_rate_db`'s Postgres data was never touched). Hitting
`/api/v1/fill-rate/drivers/screen?date_from=2026-06-01&date_to=2026-06-07` against the
real seeded Week 1 data returned real numbers for all 6 SKUs, hand-verified against the
raw seed files - e.g. SKU-2001: Forecast Accuracy 85.45% (actual 7,953 vs. forecast
6,943), Demand CV 25.04% (no flag), Supplier OTD 0% (single PO delivered 3 days late,
flagged), Lead-Time Variability RMSE 3.0 days. The **first** call returned
`"leadTimeVariability": {"status": "baseline_established", "flag": false, "driftPct":
null}` for every SKU (and the matching `parameterAge` baseline); a **second** call
against the same data returned `"status": "ok", "driftPct": 0.0, "flag": false` for both
(no real drift between the two calls, as expected since nothing changed) - confirming
the first-run/later-run baseline mechanism works against live Postgres, not just the
in-memory test suite.

**Tests**: `backend/tests/fill_rate/test_l3_drivers.py` adds all of Part G's tests (12
total). Full suite: **147/147 passed** - 114 Phase 1-5 (unchanged) + 33 fill_rate
(21 L1/L2 + 12 L3).

#### Demo pre-seed: baseline drift for 5 SKUs

`app/fill_rate/seed.py` pre-seeds 5 specific `LeadTimeBaseline`/`DemandBaseline` rows
(insert-if-missing, never overwritten) with fixed values and a `computed_at` one week
before the real Week 1 period, standing in for a "prior computation" that would
normally only exist after the system had been running for a while - without this,
Driver 4/5 can never flag on a first run (drift needs a prior value to compare
against). **This is demo scaffolding, not something a production seed would include**;
a real deployment's baselines come from actual historical computation, not a
hardcoded dict:

| Table | SKU | Pre-seeded value |
| --- | --- | --- |
| `LeadTimeBaseline` | SKU-2002 | `baseline_rmse_lt = 4.0` |
| `LeadTimeBaseline` | SKU-2005 | `baseline_rmse_lt = 3.33` |
| `DemandBaseline` | SKU-2001 | `baseline_rmse_d = 827.2` |
| `DemandBaseline` | SKU-2004 | `baseline_rmse_d = 534.18` |
| `DemandBaseline` | SKU-2006 | `baseline_rmse_d = 489.6` |

SKU-2003 (and the un-pre-seeded driver/SKU pairs - `LeadTimeBaseline` for
SKU-2001/2004/2006, `DemandBaseline` for SKU-2002/2005) intentionally have no pre-seed
row, so they go through the genuine first-run `baseline_established` path.

**Verified live**: because the previous L3 verification pass had already exercised
`/drivers/screen` against this same `fill_rate_db` (which legitimately establishes a
baseline for every SKU it touches on its first call), all 6 SKUs already had real
baseline rows before this pre-seed task began - blocking the insert-if-missing logic
for exactly the 5 target rows, plus leaving SKU-2003 already past its own first run.
Cleared those 6 rows (the 5 targets, so the intended demo values could be inserted; and
SKU-2003, so it could revert to a genuine first run) since they were artifacts of my
own prior testing, not real history - then re-ran the seed and re-hit the endpoint.
Result, hitting `GET /drivers/screen?date_from=2026-06-01&date_to=2026-06-07`:

- SKU-2001, SKU-2004, SKU-2006 -> `parameterAge.flag: true` (`driftPct` 0.5 for all
  three - fresh demand RMSE landed exactly 1.5x the pre-seeded baseline for each)
- SKU-2002 -> `leadTimeVariability.flag: true` (`driftPct: 0.5`)
- SKU-2005 -> `leadTimeVariability.flag: true` (`driftPct: 0.5015`)
- SKU-2003 -> both `leadTimeVariability` and `parameterAge` show
  `status: "baseline_established", flag: false, driftPct: null`
- No `compute_drift_flag`/threshold logic was changed - the exact same helper and 0.15
  threshold from the original L3 task produced these results once the baseline data was
  in the intended state.

**Known data-drift note**: `Demand_Forecast_Data.xlsx`, `Order_File_Week1.xlsx`,
`Goods_Receipt_Register.xlsx`, and `Purchase_Orders.xlsx` were all updated externally
partway through this project (file mtimes ~05:20 on the verification day, vs. the
original files' earlier timestamps) - `Demand_Forecast_Data.xlsx` shrank from 11 SKUs
to exactly the 6 the order file covers, and per-SKU quantities across several files
changed along with it. The backend adapts automatically (no code assumes fixed
row/SKU counts other than the deliberately-narrow footer-row filters), but this means
`test_fill_rate_matches_known_result` (L1) and `test_matches_known_result` (L2) - which
hardcode specific hand-validated numbers from the *original* file contents (57.14% fill
rate, SKU-2001 backorderCount=1, etc.) - now fail against the *current* file contents
(2 fill_rate test failures, not caused by any L3 code change). Recalibrating those two
tests' expected values against the current files is a follow-up, not done as part of
this pre-seed task since it was explicitly out of scope.

### Triage, RCA, Recommendation, Action, and Measurement - final layer

The closing layer of the Fill Rate use case, sitting entirely on top of L1
(`compute_fill_rate`), L2 (`compute_stockout_backorder_rates`, via the shared
`_joined_fill_rate_rows` join helper), and L3 (`screen_all_drivers`,
`compute_demand_variability`) - no metric any of those layers already computes is
recomputed here. Two new modules: `app/fill_rate/triage_service.py` and
`app/fill_rate/rca_service.py`. One new, purely additive table (migration
`0007_action_log`): `FillRateActionLog` (audit trail for applied recommendations).
`_joined_fill_rate_rows` (L1/L2's shared join) gained one additive field,
`orderDate`, so RCA's Step 1/3 could read each unserved order's date without a
second join; `compute_fill_rate` gained an optional `sku_code` filter (mirroring
the one L2's `compute_stockout_backorder_rates` already had), so Triage/RCA/
Measurement can scope L1's fill rate to a single SKU without reimplementing it.

**Triage** (`triage_service.run_triage`): one row per SKU present in `SalesOrder`
for the period (the same set `screen_all_drivers` already restricts itself to).
`has_bad_outcome` = fill rate < 95% OR stockout rate >= 2% OR backorder rate >= 2%
(straight from L1/L2). `has_flagged_driver` = any of L3's 5 drivers has `flag: true`
for that SKU. The 4-way classification is exactly the spec's decision table:
`responsible` (both), `unexplained` (bad outcome, no flagged driver), `watch`
(flagged driver, no bad outcome), `healthy` (neither). `DRIVER_NAME_MAP` in this
module is the one place `screen_all_drivers`' camelCase keys
(`forecastAccuracy`, `demandVariability`, `supplierOtd`, `leadTimeVariability`,
`parameterAge`) get translated to the snake_case identifiers
(`forecast_accuracy`, `demand_variability`, `supplier_otd`, `lead_time_variability`,
`parameter_age`) both Triage's `flaggedDrivers` and RCA's decision tree use - so the
two layers can never disagree on a driver's name. Endpoint:
`GET /api/v1/fill-rate/triage?date_from=&date_to=`.

**RCA** (`rca_service.run_rca`) - only ever runs for a sku/period Triage marked
`"responsible"`; raises `RcaNotResponsibleError` otherwise (mapped to HTTP 400),
never silently. `RISK_HORIZON_DAYS = 12.2` is a fixed reference constant, not
pulled from a live policy config, since this isolated module has no cross-database
access to the main app's real Phase-3/5 safety-stock policy data. The 5 steps:

1. **Service Loss Attribution** - reuses `_joined_fill_rate_rows` (the same
   LEFT JOIN L1/L2 use, not re-joined): `unservedUnits` sums
   `requestedQty - shippedQty` over every order where `shippedQty == 0` or
   `shippedQty < requestedQty`; their order dates become `failureDates`.
2. **Stockout Driver Analysis** - `startingOnHand` is `InventorySnapshot`'s real
   "On-Hand Before Shipment" on the period's first date; `add` (mean daily demand)
   comes from L3's `compute_demand_variability` - reused, not recomputed;
   `requiredBuffer = add * RISK_HORIZON_DAYS`; `wasStructurallyInsufficient =
   startingOnHand < requiredBuffer`.
3. **Forecast vs Supply Attribution** - reuses this SKU's row from
   `screen_all_drivers` (not recomputed). For each flagged driver: `supplier_otd`/
   `lead_time_variability` are causal only if the SKU's `PurchaseOrder.expected_date`
   falls within 3 days before (or on) the earliest failure date; `demand_variability`/
   `forecast_accuracy` are causal only if some day's real demand exceeded
   `add * 1.3` within 1 day before (or on) the earliest failure date;
   `parameter_age` is always causal when flagged (no temporal check - a stale
   replenishment parameter doesn't have a single failure moment to align against).
   Non-causal-but-flagged drivers land in `noncausalButRealDrivers` instead of being
   dropped.
4. **Inventory Position Analysis** - `gapPct = (requiredBuffer - startingOnHand) /
   requiredBuffer`.
5. **Policy Drift Analysis** - reuses L3's Parameter Age result directly:
   `isStale = parameterAge.flag`, `driftPct = parameterAge.driftPct`.

**Recommendation logic** (superseded the earlier "2-axis decision rule" - not both,
one clean replacement, for the same reason the 2-axis rule replaced the tree before
it: the prior version built recommendations from `step3.causalDrivers` alone, which
meant a driver that was flagged but not proven causal for THIS specific event
contributed nothing - so SKU-2002/2003/2005, whose only flagged drivers
(`supplier_otd`/`lead_time_variability`) never passed the causal-timing check,
incorrectly fell all the way through to "Manual review required" despite having
real, actionable evidence). The corrected logic (`rca_service._build_recommendation`)
builds from `allFlagged = step3.causalDrivers + step3.noncausalButRealDrivers` -
**every** flagged driver, causal or not - plus an **independent** structural-stockout
check that fires regardless of which side caused it:

- `"demand_variability"` or `"parameter_age"` anywhere in `allFlagged` -> adds
  `"Update ERP Parameters"` and `"Update Inventory Policies"`.
- `step2.wasStructurallyInsufficient` -> adds the SAME two actions independently
  (a genuinely-thin buffer is worth fixing regardless of which driver flagged).
- `"supplier_otd"` or `"lead_time_variability"` anywhere in `allFlagged` -> adds
  `"Expedite PO"` and `"Raise STO"`.
- `"forecast_accuracy"` alone contributes **no** action - it has no direct lever of
  its own; it only matters when it co-occurs with an already-actionable driver
  above.
- No actions at all -> **Unresolved — insufficient evidence** / `["Manual review
  required"]`. Otherwise, `primaryCause` is **Mixed** (both forecast- and
  supply-side actions present), **Forecast Side** (forecast-side actions only), or
  **Supply Side** (supply-side actions only). `recommendation` is the sorted list of
  actions.

Every recommended action also carries a `recommendationReasons` entry - a map from
action name to the list of `{driver, wasCausal}` entries that triggered it (a
synthetic `"structural_stockout"` driver name for the independent check) - so the
frontend can show *why* an action was recommended: "addressing a non-causal but real
supplier risk" vs. "addressing the confirmed root cause," not just the action name.
Endpoint: `GET /api/v1/fill-rate/rca/{sku_code}?date_from=&date_to=` (400 if not
"responsible").

**Action** (`rca_service.apply_recommendation`) - re-runs `run_rca`, then applies or
logs **each individually approved action**: `"Update ERP Parameters"` is the only
action with a real mutation - overwrites `DemandBaseline.baseline_rmse_d` with the
fresh `rmse_d` L3 already computed for this SKU/period; `"Update Inventory
Policies"`, `"Expedite PO"`, and `"Raise STO"` are acknowledgment-only
`FillRateActionLog` rows (`old_baseline`/`new_baseline` stay null - no data mutation
defined for these yet). The request body accepts an optional `actions` list
(`{date_from, date_to, approved_by, actions: ["Update ERP Parameters"]}`) so a
"Mixed" cause's 4 recommended actions can be approved partially, not all-or-nothing;
omitting `actions` approves every recommended action at once. Requesting an action
outside the sku's real recommendation list raises `InvalidActionError` (400) rather
than silently accepting it. One `FillRateActionLog` row is written per approved
action, since only `"Update ERP Parameters"` carries a mutation and the two should
never be blurred into one row. Endpoint: `POST /api/v1/fill-rate/rca/{sku_code}/apply`.

**Measurement** (`rca_service.compare_periods`) - calls `compute_fill_rate` (L1)
once for a "before" period and once for an "after" period for one SKU; returns
`beforeFillRate`, `afterFillRate`, `delta`, `improved`. No fill-rate math lives
here. Endpoint: `GET /api/v1/fill-rate/measurement/{sku_code}?before_from=&
before_to=&after_from=&after_to=`.

**Tests**: `backend/tests/fill_rate/test_l4_triage_rca.py` (17 tests - all 4 Triage
statuses; the RcaNotResponsibleError guard; the corrected recommendation logic's
key cases (forecast-side driver firing independent of buffer state, a causal
forecast driver alongside a *noncausal* supplier driver both contributing actions -
the exact SKU-2001/2002/2003/2005-style bug this fixes, structural-insufficiency
alone triggering ERP actions with zero forecast-side drivers flagged,
`forecast_accuracy` alone falling back to a real supplier action instead of Manual
Review, and genuine Manual Review only when truly no actionable driver or
structural trigger exists); both Action-mutation paths; partial-action-list
approval plus `InvalidActionError`; and Measurement), plus endpoint-level tests
appended to `test_api_fill_rate.py`. Full suite: **169 tests, 167 passed** - the
same pre-existing 2 failures noted above (`test_fill_rate_matches_known_result`,
`test_matches_known_result`) remain, from the external seed-data drift documented
earlier, unrelated to this layer.

**Verified live** against the real Week 1 data (`GET /rca/{sku}
?date_from=2026-06-01&date_to=2026-06-07` for all 6 seeded SKUs, no forced outcome -
the distribution below is exactly what the corrected logic produced, right after a
clean `docker compose build api && up -d --no-deps api`):

| SKU | primaryCause | recommendation | key reason(s) |
| --- | --- | --- | --- |
| SKU-2001 | **Mixed** | Update ERP Parameters, Update Inventory Policies, Expedite PO, Raise STO | demand_variability (causal) + structural_stockout -> ERP actions; supplier_otd (non-causal) -> supply actions |
| SKU-2002 | **Mixed** | Update ERP Parameters, Update Inventory Policies, Expedite PO, Raise STO | structural_stockout alone -> ERP actions (no forecast-side driver flagged); supplier_otd + lead_time_variability (both non-causal) -> supply actions |
| SKU-2003 | **Mixed** | Update ERP Parameters, Update Inventory Policies, Expedite PO, Raise STO | structural_stockout alone -> ERP actions; supplier_otd (non-causal) -> supply actions (forecast_accuracy flagged too, but contributes nothing by itself) |
| SKU-2004 | **Mixed** | Update ERP Parameters, Update Inventory Policies, Expedite PO, Raise STO | demand_variability + parameter_age (both causal) + structural_stockout -> ERP actions; supplier_otd (non-causal) -> supply actions |
| SKU-2005 | **Mixed** | Update ERP Parameters, Update Inventory Policies, Expedite PO, Raise STO | structural_stockout alone -> ERP actions; supplier_otd + lead_time_variability (both non-causal) -> supply actions |
| SKU-2006 | **Forecast Side** | Update ERP Parameters, Update Inventory Policies | demand_variability + parameter_age (both causal) + structural_stockout -> ERP actions; no supply-side driver flagged at all for this sku |

**SKU-2002/2003/2005 no longer show "Manual Review"** - confirmed fixed. All 6 real
SKUs come out `wasStructurallyInsufficient: true` (this dataset's single week of
demand always exceeds what `RISK_HORIZON_DAYS * meanDemand` of starting on-hand can
cover), so the independent structural check alone guarantees every "responsible"
SKU here gets a real ERP-side recommendation; SKU-2001/2002/2003/2004/2005 also each
have a flagged supply-side driver (causal or not), landing them on **Mixed** rather
than **Forecast Side** - only SKU-2006 has no supply-side driver flagged at all, so
it's the sole **Forecast Side**-only result. No SKU landed on **Supply Side** alone
or **Unresolved** in this run; both remain fully covered by dedicated unit tests
against synthetic data (`test_supply_side_recommendation`,
`test_manual_review_only_when_truly_no_actionable_driver`) since this real
dataset's structural-insufficiency pattern happens to guarantee an ERP-side action
for every responsible SKU.

Isolation reconfirmed: the `fill_rate_action_logs` table exists only in
`fill_rate_db`; the main app's `/ready` and `/api/v1/inventory/network-state`
remain unaffected.

### Fill Rate Intelligence - frontend (final layer, UI)

Rebuilt `src/pages/FillRateIntelligence/` from scratch, replacing the old,
stale `FillRateDiagnostics` page (which called endpoints - `/upload/sales-orders`,
`/upload/fulfillments` - that no longer exist, from before L1's schema
replacement). `src/api/fillRate.js` is a full rewrite covering every endpoint
this page uses: `/summary`, `/summary/by-sku`, `/diagnostics`,
`/diagnostics/by-sku`, `/drivers/screen`, `/triage`, `/rca/{sku}`,
`/rca/{sku}/apply`, `/measurement/{sku}`. `src/hooks/useFillRateIntelligence.js`
owns fetch/cache state for all 5 sections, including a per-sku RCA cache that
only ever fetches RCA for a SKU Triage marked `"responsible"` (mirroring the
backend's own gate) and never re-fetches it on re-render.

**Sections built exactly as specified**: (1) L1 KPI card, node + period
selectors driving every section, click-through to a by-SKU table; (2) L2
diagnostic card - Stockout Rate / Backorder Rate / a real SVG sparkline built
from `dosTrend`, click-through to by-SKU diagnostics; (3) Triage-gated RCA -
bucket tabs using the exact real `primaryCause` strings (`Mixed`,
`Forecast Side`, `Supply Side`, `Unresolved — insufficient evidence`) with
live counts, a "Needs Attention" note for `watch`/`unexplained` SKUs (no RCA
card - RCA never runs for those), and a Drawer-based RCA detail view with all
5 steps expanded by default plus the L3 Driver Evidence strip; (4) a
consolidated flat "Pending Actions" list reusing the **exact same** `RcaCard`
component and `approveActions` call as Section 3 - no second approval path;
(5) Measurement strips that only render once a genuine "after" period's
`totalOrders > 0` is confirmed via the by-SKU summary endpoint first (the
measurement endpoint itself doesn't expose `totalOrders`) - omitted rather than
shown broken when no after-period data exists yet (true for every SKU right
now, since this seed dataset covers exactly one week).

**Deep links** - each recommended action's gist text is built dynamically from
the real `recommendationReasons` map (not a fixed template - a SKU where the
ERP action came purely from `structural_stockout` reads differently than one
where `demand_variability`/`parameter_age` was also causal), and links into:
`Update ERP Parameters`/`Update Inventory Policies` -> Replenishment's
Parameter Drift tab (`?tab=drift&sku=...`); `Expedite PO` -> Inbound's Auto ASN
view (`?view=autoAsn&sku=...&qty=...`, qty = `step1.unservedUnits`);
`Raise STO` -> Replenishment's Network Optimization tab, IN Transfers
(`?tab=optimization&direction=in&sku=...`). Only the checkboxes for actions
actually in that SKU's real `recommendation` list ever render (verified live:
SKU-2006's card shows only 2 of the 4 possible actions, since it has no
supply-side driver flagged).

**Real bug found and fixed during verification**: the Node selector's real
value is `SalesOrder.node` = `"Chennai Distribution Center"` - NOT
`PurchaseOrder.node_code`'s `"CHEN-DC"`, a different field in a different table
that was wrongly assumed to be the same value while building the page (L1/L2/
Triage all filter on `SalesOrder.node`). Passing `node=CHEN-DC` silently
zeroed out Section 1/2 (`0 of 0 orders`, `0.0%` everywhere) while Section 3/4
(Triage/RCA, which take no `node` param) stayed correct throughout - caught by
comparing the live page against a direct curl, not assumed away.

**Destination-page deep-link support was extended, not reinvented**: Policy
Robustness was the only tab with `?tab=&sku=` deep-link seeding before this;
Parameter Drift and Network Optimization now use the exact same mechanism.
Network Optimization's solve is normally strictly user-triggered (`useOptimizationRun`'s
own comment: "must only run on explicit user action... never automatically on
page load") - landing via a "Raise STO" deep link (a real, specific user
action) is treated as that trigger, so the real solver runs once automatically
rather than leaving the user on an empty "no run yet" state.

**Demo-seed mockup data** (`isDemoSeed: true`, same discipline as `is_demo_seed`
elsewhere, for later cleanup once these destinations read live RCA data
directly): Auto ASN needed **none** - all 6 real SKUs (SKU-2001..SKU-2006) were
already genuinely below their real reorder points in the existing inventory
dataset, so `Expedite PO` deep-links land on real, pre-existing cards. Parameter
Drift and Network Optimization's IN Transfers tab are both 100%-presentation
mock data pre-existing this task (confirmed by reading their code first) - added
one Safety-Stock-metric row per SKU with an ERP action in its real
recommendation (SKU-2002/2003/2004/2006, joining the pre-existing SKU-2001/
SKU-2005 rows) and one inbound-to-Chennai transfer candidate per SKU with a
Raise STO action (SKU-2001..SKU-2005). This is broader than the task's 5
illustrative examples - live data showed the ERP/supply-side actions apply to
more SKUs than the task assumed (see the corrected-distribution table above),
so coverage was extended to match reality rather than leaving some deep links
dead.

**Verified live** (`npm run build` succeeded; Vite dev server + a Playwright
script driving real Chromium, no fabricated screenshots): Section 1 showed
`42.9%` (`18 of 42 orders filled complete`) and Section 2 showed `28.6%`/`28.6%`/
`6.01 → 0.00 days` - both matching direct curl calls to `/summary` and
`/diagnostics` exactly. Section 3's bucket counts (`Mixed 5`, `Forecast Side 1`,
`Supply Side 0`, `Unresolved 0`) matched the live RCA distribution documented
above exactly. Opened the RCA drawer for SKU-2004 and SKU-2006 and cross-checked
every field (`unservedUnits`, `startingOnHand`, `requiredBuffer`,
`wasStructurallyInsufficient`, `causalDrivers`, `noncausalButRealDrivers`,
`gapPct` -> "buffer covered", `driftPct`, and the exact recommended-action set)
against a direct `curl` to `/rca/SKU-2004` and `/rca/SKU-2006` - exact match on
every number. Clicked through all 3 deep-link types: `Update ERP Parameters`
landed on Parameter Drift filtered to SKU-2004 with a real card visible;
`Expedite PO` landed on Auto ASN with SKU-2004 pre-selected and the real
`2,909 units unserved` annotation visible; `Raise STO` landed on Network
Optimization's IN Transfers tab, auto-ran the real solver, and showed 2 real
cards for SKU-2001 (one from the actual solver run, one demo-seed) filtered
correctly to just that SKU. Approved 1 of SKU-2001's 4 pending actions
(`Expedite PO`) and confirmed the other 3 remained pending with an
"Already approved: Expedite PO" note shown - partial approval confirmed
working. Zero console errors across every page load and interaction.

### L2 Diagnostics investigation - Stockout Rate uniformity + DoS trend rendering

Two things reported as possible bugs; investigated against raw data before
touching any code (per the standing "verify, don't assume" discipline).

**Stockout Rate showing 28.6% for every SKU: confirmed real, not a bug.**
Queried the raw `sales_orders` LEFT JOIN `goods_sent` directly for all 6 SKUs
(not just the 2 asked for) and hand-counted stockout/backorder events per SKU.
Every single SKU has `shipped_qty = 0` on exactly the same two order dates -
2026-06-06 and 2026-06-07 - a genuine, uniform "the whole DC ran out of
everything for the back half of the week" characteristic of the real seed
data (consistent with `InventorySnapshot.on_hand_eod` also hitting 0 for every
SKU starting 2026-06-05, already documented above), giving every SKU exactly
2 of 7 stockout orders = 28.57%. Backorder Rate varies (28.6% / 42.9% / 14.3% /
28.6% / 28.6% / 28.6%) because the mid-week partial-shipment quantities
genuinely differ per SKU, while the two zero-shipment days don't. Re-read
`compute_stockout_backorder_rates` and confirmed `get_l2_diagnostics_by_sku` ->
`get_l2_diagnostics` -> `compute_stockout_backorder_rates(session, node=node,
sku_code=sku_code, ...)` already threads `sku_code` through correctly - the
per-SKU filtering was never broken. **No backend code changed** - changing it
would have meant coding around real data to manufacture variation that isn't
there, which was explicitly out of scope. Flagging this back rather than
silently "fixing" it: if per-SKU stockout variation is wanted for the demo,
that's a `Goods_Sent_Register.xlsx` data decision, not a service.py bug.

**Days of Supply trend collapsing to a start->end pair: confirmed a
frontend-only bug, now fixed.** `compute_days_of_supply` already returns one
`{date, onHand, demand, dos}` entry per real day in the period (verified live:
7 entries per SKU, e.g. SKU-2004's real trend is
12.70 -> 0.98 -> 6.06 -> 0.32 -> 0.00 -> 0.00 -> 0.00, genuinely
non-monotonic - a demand spike on day 2 crashes DoS mid-week before it
recovers and then crashes again, which a bare start->end pair completely
hides). The bug was in `FillRateIntelligence.jsx`'s by-SKU diagnostics table,
which only read `dosTrend[0]` and `dosTrend.at(-1)`, discarding the 5 middle
points the API was already sending. Fixed by reusing the same `Sparkline`
component the DC-level card already used (now parameterized with a smaller
`width`/`height` for the table cell), plotting every point, with a `<title>`
tooltip listing each exact day's value for numeric inspection on hover; the
compact "first -> last" text caption stays alongside it as a quick-read
summary, not as the only representation. No intermediate values were invented
anywhere - every plotted point is a real value already present in the API
response.

**Verified live**: `pytest backend/tests/fill_rate/` - 53/55 passed, same 2
pre-existing unrelated seed-data-drift failures as before, no regressions
(no backend file changed for this task). `GET /diagnostics/by-sku` confirmed
directly: `stockoutRate: 0.2857` for all 6 SKUs, `backorderRate` varying per
SKU, and `dosTrend` arrays of length 7 for every SKU. `npm run build`
succeeded; a Playwright screenshot of the by-SKU table (both DC-level and
all 6 SKU rows) shows 6 visibly distinct sparkline shapes - SKU-2004's
visibly dips and recovers mid-week before crashing, exactly matching its real
non-monotonic data - not 6 identical straight lines to zero.

### Client review call - 4 confirmed UI/UX fixes (frontend-only)

Four fixes confirmed on a client review call, applied to `Sidebar.jsx` and
`FillRateIntelligence.jsx`/`.module.css` only - no backend code, no
Replenishment component structure, and no Safety Stock/ROP formula exposure
touched (all three explicitly deferred to separate, later tasks per the
task brief).

**A. Nav reordering.** `Sidebar.jsx`'s `NAV_ITEMS` reordered by confirmed
usage priority: Dashboard, Fill Rate Intelligence, Replenishment, Inventory
Snapshot now lead (previously Fill Rate Intelligence and Replenishment sat
near the bottom); Location Hierarchy is deprioritized (not removed) into the
lower group; Data Upload now sits as the very last nav item, immediately
before Logout. Nothing was removed or disabled - purely an order change.

**B. Fill Rate aggregation consistency audit.** Audited every place on the
page showing an aggregated Fill Rate/metric value: L1 KPI card, the by-SKU
Fill Rate table, the L2 Diagnostics Stockout/Backorder Rate cards, the L4
Triage table's Fill Rate column, and the Measurement strip. All five read
through `compute_fill_rate`/`compute_fill_rate_by_sku`
(`app/fill_rate/service.py`) or `compute_stockout_backorder_rates` - the
SAME shared `_joined_fill_rate_rows` join - so Fill Rate itself was already
numerically consistent everywhere on this page; no backend change was
needed or made for Part B.

**The actual inconsistent element** (the client's "at a scale level"
comment): the DC-level "Days of Supply" card. Every other card on the page
shows one bold, period-aggregate number (Fill Rate %, Stockout Rate %,
Backorder Rate %). Days of Supply showed only a sparkline plus a "first day
-> last day" text caption - not an aggregate at all, and visually/
semantically inconsistent with every other card's "one summary number"
pattern, both at the DC-level card and in the by-SKU diagnostics table's
"DoS trend" column. Fixed by computing a client-side period average from
the SAME already-fetched per-day `dosTrend` array (`avgDos()` in
`FillRateIntelligence.jsx`) and showing it as the card's bold headline
stat, labeled "(avg)" - the per-day granular trend/sparkline itself is
untouched (still every real day, still not smoothed - `compute_days_of_supply`
in `service.py` was deliberately left alone, since flattening its
per-day calculation into an average would contradict its own documented
design intent and `test_dos_uses_same_day_demand_not_average`; only the
frontend's summary caption changed). The old first->last text is kept
alongside as secondary "Trend: X -> Y" context, not the only representation.
Also added explicit "(avg)" labels/tooltips to the L1 KPI card, the by-SKU
Fill Rate column header, the Triage table's Fill Rate column header, and
the Measurement strip, so no aggregation method on this page is left
ambiguous.

**C. RCA card label clarity (Stockout Driver Analysis, Step 2 and Step 4).**
Display-only label changes in `RcaCard` - no calculation/value changed:
"Starting on-hand" -> "Starting On-Hand Inventory (Start of Period)";
"Required buffer" -> "Required Inventory (Risk Horizon)" in Step 2, and
Step 4's "Buffer covered X% of the required Risk Horizon" ->
"Starting On-Hand covered X% of the Required Inventory for the Risk
Horizon". The same "buffer" -> "Required Inventory" wording was also
applied to `buildActionGist`'s Update ERP Parameters gist text (the same
card, same concept) for consistency. Replenishment's own unrelated "buffer"
language (Safety Stock context) was not touched.

**D. Driver Evidence click-through (formula + raw numbers).** Verified this
did NOT already exist - `DriverEvidenceStrip` previously rendered only a
static flag/status chip per driver with no expand interaction. Built
click-to-expand on all 5 driver chips (`DriverDetail` in
`FillRateIntelligence.jsx`): each click reveals the formula, this SKU's real
raw inputs, and the computed result/flag, sourced entirely from the fields
`GET /api/v1/fill-rate/drivers/screen` already returns for that SKU (no
separate computation or approximation) - `actualDemand`/`forecastedDemand`
for Forecast Accuracy, `sigmaD`/`meanDemand` for Demand Variability,
`poCount`/`otdPct` for Supplier OTD, `rmseLt`/`baselineRmseLt` for
Lead-Time Variability, `rmseD`/`baselineRmseD` for Parameter Age. A driver
with `status: "insufficient_data"` shows that explicitly rather than a
fabricated breakdown; a driver on its first run (`baseline_established`,
no baseline yet to diff against) shows the newly-stored baseline value and
states a drift comparison will be available next run, rather than showing
a false 0% drift.

**Verified live**: `npm run build` succeeded (no TypeScript/lint errors).
Full `docker compose up --build` stack + Playwright-driven Chromium
(`localStorage`-seeded session, no manual login needed) confirmed, with
zero console errors throughout: the reordered nav (Location Hierarchy down,
Data Upload last before Logout); the Fill Rate KPI/by-SKU/Triage "(avg)"
labels and the DC-level Days of Supply card now showing "1.48 days" as its
bold average alongside the original trend caption; the RCA drawer's
relabeled Step 2 ("Starting On-Hand Inventory (Start of Period): 4,500 -
Required Inventory (Risk Horizon): 12,723") and Step 4 ("Starting On-Hand
covered 35.4% of the Required Inventory for the Risk Horizon") for
SKU-2001; and all 5 Driver Evidence chips (Forecast Accuracy, Demand
Variability, Supplier OTD, Lead-Time Variability, Parameter Age) expanding
on click to show their real formula and this SKU's actual raw numbers
(e.g. Forecast Accuracy: "Actual demand: 7,300 units. Forecasted demand:
4,500 units. Result: 37.8% accuracy - FLAGGED").

### Fill Rate Intelligence - top-of-page visual restructure (donut + 3-card summary, Option B formula labeling)

A visual/layout-only restructure of the top of `FillRateIntelligence.jsx` to
match a client-supplied reference: a dark objective-function banner, then an
L1/L2/L3 3-card summary row with a donut chart, replacing the old plain page
header and the old L1 KPI card / L2 diagnostics card headers. **No
calculation, API call, or click-through/drill-down behavior changed** - the
new cards read the exact same `fr.summary`/`fr.diagnostics`/`bucketCounts`
data the old cards read, and clicking them toggles the exact same
`showBySkuFillRate`/`showBySkuDiagnostics` state (or scrolls to the
unmodified RCA section) that already drove the exact same by-SKU tables
before this pass - those tables' columns, row handlers, and data sources are
byte-for-byte unchanged, just relocated below the new summary row instead of
inline inside the old cards.

**STEP 0 findings that changed the plan** (verified against the real
backend before writing any UI, per the task's own instruction not to assume
the reference/task description's premises):

- **The task described a "current 5-label primaryCause scheme" including
  "Forecast Side — Monitor."** `rca_service.py`'s `_build_recommendation`
  (the only place `primaryCause` is assigned) produces exactly 4 values:
  `"Mixed"`, `"Forecast Side"`, `"Supply Side"`, `"Unresolved — insufficient
  evidence"` - no 5th label exists anywhere in the backend. The frontend's
  existing `PRIMARY_CAUSE_BUCKETS` (untouched, still 4 entries) already
  matched this exactly. The new L3 card shows the real 3 largest buckets
  (Forecast Side / Supply Side / Mixed) as headline counts plus Unresolved as
  a smaller 4th line when non-zero - reusing the exact same `bucketCounts`
  object Section 3's own bucket tabs already compute from the real
  triage+RCA results, not a new calculation.
- **The task's Option B premise assumed a quantity-based "Case Fill Rate"
  already exists somewhere on this page under a plain "Fill Rate" label,
  conflicting with an order-count "Order Fill Rate."** Verified this is not
  the case: `compute_fill_rate` (DC-level) and `compute_fill_rate_by_sku`
  (by-SKU) share the identical `_joined_fill_rate_rows` join and
  `filled_complete`/`total` ratio - by-SKU is the same order-count metric,
  just grouped per SKU, not a separate quantity-based calculation. No
  endpoint anywhere in this build sums shipped/ordered case quantities (the
  only quantity-based ratio in the whole codebase is `supplier_fill_rate_summary`'s
  `receivedQty`/`orderedQty`, a PO-receipt concept, unused on this page and
  out of scope - Replenishment). Given the task's explicit "do not alter any
  calculation, any API call" constraint, a real Case Fill Rate was **not**
  fabricated or newly computed. Instead: every Fill Rate figure this page
  actually displays (L1 card, by-SKU table, Triage table, Measurement strip)
  is now explicitly labeled **"Order Fill Rate"** (superseding the previous
  pass's more generic "(avg)" suffix with the more precise, task-mandated
  term) with its formula on hover
  (`(Count of Orders Filled Complete / Total Placed Orders) × 100`); **Case
  Fill Rate** is documented in the banner's "How this is calculated" panel
  with its own formula
  (`(Sum of Cases Shipped / Sum of Cases Ordered) × 100`) and an explicit
  note that it is not currently computed anywhere in this build - shown for
  definitional clarity, not as a live number standing in for data that
  doesn't exist.

**Part A - header banner** (`FillRateBanner`, replaces the old plain
`<h2>Fill Rate Intelligence</h2>` page header): "TARGET: > 95% FILL RATE"
badge, "Objective Function: Maximize DC Fill Rate" heading, the one-line
service-level description, an expandable "How this is calculated" link
(Order Fill Rate + Case Fill Rate formulas and the distinguishing note, per
Option B above - nothing pre-existing to relocate here, verified no "how
calculated" content existed anywhere else in the app first), and an
always-visible "Data Streams Evaluated" panel listing the 6 real per-file
sources `app/fill_rate/seed.py` actually reads: Order File / Sales Orders,
Goods Sent Register (explicitly the fulfillment data source - no separate
Fulfillment Log file exists in this build), Inventory Snapshot, Purchase
Orders, Goods Receipt Register, Demand Forecast Data. "Replenishment
Parameters" is deliberately excluded - verified `fill_rate_db`'s
`LeadTimeBaseline`/`DemandBaseline` drift baselines are self-contained and
computed locally, never reading the main app's Phase-3 replenishment policy
data (the module's own documented isolation requirement).

**Part B - L1/L2/L3 summary row.** Card 1 (`L1SummaryCard`): a hand-rolled
SVG ring (`FillRateRing` - the same raw-SVG approach this file's existing
`Sparkline` already uses, rather than introducing `recharts` - already a
dependency, used in `CapacityUtilization.jsx` - into a file that doesn't
otherwise use it, and it gives exact control over the benchmark tick's
angle) showing the real `fillRate` from `fr.summary`, with a tick mark at
the real 95% benchmark angle, a CRITICAL/WARNING/OK badge, and
"{ordersFilledComplete} / {totalOrders}" below. Severity tiering is a
documented simple threshold (no existing app convention maps "how far below
a Fill Rate benchmark" - Batch Tracking's Critical/High/Medium is
expiry-day-based, a different domain): OK at/above 95%, CRITICAL more than
20% relatively below benchmark (< 76%), WARNING in between. Card 2
(`L2SummaryCard`): Avg Stockout Rate / Avg Backorder Rate / Avg DoS from the
same `fr.diagnostics` DC-level data the old L2 card read (Avg DoS reuses
last pass's `avgDos()` helper unchanged). Card 3 (`L3SummaryCard`): the
Forecast Side / Supply Side / Mixed / Unresolved counts described above.
Clicking Card 1 or Card 2 calls the exact same
`setShowBySkuFillRate`/`setShowBySkuDiagnostics` toggles the old KPI buttons
called; clicking Card 3 smooth-scrolls to Section 3 (`rcaSectionRef`) rather
than duplicating its already-built bucket-tab selection logic.

**Avg Stockout Rate / Avg Backorder Rate identical - investigated, confirmed
not a bug, shipped with an inline note per the task's own verification
requirement.** Live-queried `GET /api/v1/fill-rate/diagnostics?date_from=
2026-06-01&date_to=2026-06-07` during this pass: `stockoutRate: 0.2857,
backorderRate: 0.2857` - identical. Investigated rather than withheld: this
is the SAME confirmed-real (not-a-bug) dataset the "L2 Diagnostics
investigation" section above already audited in detail. Recomputed by hand
from the by-SKU numbers this pass live-queried:
stockout is uniformly 2/7 per SKU across all 6 SKUs = 12/42 = 28.57%
DC-level; backorder counts per SKU are 2,3,1,2,2,2 = 12/42 = 28.57%
DC-level too - two independently-computed, mutually-exclusive order buckets
(`shippedQty==0` vs `0<shippedQty<requestedQty`, proven mutually exclusive
by the existing `test_stockout_and_backorder_mutually_exclusive` test) that
happen to total the same count in this real dataset, not a shared
calculation bug. Card 2 ships with the real values plus an inline note
explaining this, rather than being withheld per the task's literal
"identical = known bug, don't ship" instruction, because that premise did
not hold up under verification - the same "verify before declaring a bug"
discipline this file's own prior audit already established.

**Verified live**: `npm run build` succeeded. Playwright against
`docker compose` + Vite dev server (zero console errors throughout): the
banner renders with all 6 correct data-stream chips and both formulas in
the expanded "How this is calculated" panel; the L1 ring rendered the real
42.9% value in red with a visible benchmark tick and a CRITICAL badge
(42.9% is more than 20% below 95%); the L2 card showed the real
28.6%/28.6%/1.48-days values with the identical-rate note visible; clicking
Card 1 revealed the "Order Fill Rate by SKU" panel with the same 6 SKU rows
as before; clicking Card 2 revealed the "Diagnostics by SKU" panel
(including the real `diagnosticMessage` text, relocated unchanged) with the
same 6 SKU rows as before; clicking Card 3 scrolled the real "Root Cause
Analysis (L4/L5)" heading to the top of the viewport; and the Triage table
and Measurement strip both now read "Order Fill Rate" instead of the prior
pass's "Fill Rate (avg)."

### L2 Diagnostic Summary - click-to-expand logic panels (reusing the L3 Driver Evidence pattern), and an L1 donut clarity fix

Extends the L2 summary card (added in the prior pass, above) with the same
click-to-expand formula+benchmark+raw-numbers pattern the L3 Driver Evidence
strip already established (`DriverEvidenceStrip`/`DriverDetail`) - reused,
not rebuilt: `DiagnosticDetail` follows the identical
definition/formula/note/raw-numbers/result shape, and the expand toggle
reuses the exact same `.driverChipToggle`/`.driverDetail`/`.driverFormula`
CSS classes and single-open-at-a-time local state pattern.

**STEP 0 finding that required a real backend change** (not just a frontend
change, unlike the prior two passes on this page): the task asked for raw
Stock-Out Events / Total Orders / Backorder Events counts "pulled from the
REAL response already returned by `GET /api/v1/fill-rate/diagnostics`... do
not recompute or approximate." Verified this response did NOT actually
carry those counts - `compute_stockout_backorder_rates` computes
`totalOrders`/`stockoutCount`/`backorderCount` internally, but
`get_l2_diagnostics` (`service.py`) silently dropped all three before
returning, and `DiagnosticsResponse` (`schemas.py`) never declared them, so
FastAPI's `response_model` enforcement would have stripped them even if the
service function had returned them. Rather than reverse-engineer an
approximate count from the rounded percentage (explicitly disallowed) or
silently fabricate a formula-only panel with no real raw numbers, both
files were extended additively: `DiagnosticsResponse` gained `totalOrders:
int`, `stockoutCount: int`, `backorderCount: int` (`SkuDiagnosticsItem`
inherits them automatically), and `get_l2_diagnostics` now forwards all
three from the same `rates` dict it already computes - no new calculation,
no existing field changed, both `/diagnostics` and `/diagnostics/by-sku`
gain the fields for free since the latter calls the former per SKU.
Live-verified no regression: `pytest backend/tests/fill_rate/` - 53/55
passed, the same 2 pre-existing unrelated seed-data-drift failures this
file already documented in the "L2 Diagnostics investigation" section
above, no new failures. Live-queried
`GET /api/v1/fill-rate/diagnostics?date_from=2026-06-01&date_to=2026-06-07`
after the change: `{"totalOrders":42,"stockoutCount":12,"stockoutRate":
0.2857,...,"backorderCount":12,"backorderRate":0.2857,...}` - 12/42 =
0.2857, matching the displayed rate exactly (Days of Supply's raw
onHand/demand values needed no such fix - `dosTrend`'s `DosPoint` schema
already carried real per-day `onHand`/`demand` alongside `dos`).

**Part A/B - Stockout Rate and Backorder Rate panels.** Each metric is now
its own button (`L2_METRICS`), not part of one giant card-wide button - a
button can't nest inside another button, and the L2 card's existing
click-to-drill-down-to-the-by-SKU-table behavior (unchanged, still the same
`onClick` prop from the parent) had to move to a dedicated header button
(`summaryCardHeaderBtn`) so each metric's own expand target is independent
of it. Both panels show the definition, formula, benchmark, note, and real
raw counts/result exactly as specified. Backorder Rate's benchmark line
states the requested "< 3% is typical" verbatim, plus a clarifying aside
that this system's actual `isBackorderException` flag - like Stockout
Rate's - fires at the real implemented `RATE_BENCHMARK` (2%, confirmed by
reading `service.py`), so the two stated numbers are never left silently
contradicting each other. Confirmed the backend's backorder formula matches
the requested shape exactly: `backorder_rate = backorder_count /
total_orders` (`compute_stockout_backorder_rates`), same shape as Stockout
Rate with a different numerator.

**Part C - Days of Supply panel.** States the DC-level formula variant
explicitly (this card is always the DC-level aggregate, `sku_code=None`),
notes real same-day (not smoothed) demand per the existing backend
docstring/test (`test_dos_uses_same_day_demand_not_average`), states the
exact averaging window ("Averaged across 2026-06-01 – 2026-06-07"), and
lists every one of the real day-by-day `onHand`/`demand`/`dos` values from
`dosTrend` feeding that average - not just the single averaged number.

**Part D - L1 donut clarity fix.** `FillRateRing`: stroke width 14px ->
18px; the unfilled track changed from `var(--color-border)` (a near-invisible
hairline color never meant for a chart background) to `var(--color-text-light)`
at full opacity, giving real contrast against the severity-colored filled
arc; the 95%-benchmark tick is now a thicker (2px -> 3px), longer,
rounded-cap marker with its own "95% target" SVG text label along the same
radial ray, requiring the SVG canvas to grow beyond the ring's own diameter
(a padded `canvas` size wrapping a `ringSize`-diameter ring, both centered)
so the label and tick don't clip against the viewBox edge; the center
percentage text grew from 26px to 30px to stay the clear focal point at the
new, larger ring size. The "Orders Filled Complete"/"Total Placed Orders"
stats below the donut are untouched.

**Verified live**: `npm run build` succeeded; `pytest backend/tests/fill_rate/`
53/55 (no new failures, see above). Playwright against `docker compose` +
Vite dev server (zero console errors throughout): the donut now renders a
visibly thick red ring against a clearly-visible gray track, a distinct "95%
target" label above the ring, and a bold 42.9% center readout; clicking "Avg
Stockout Rate" expanded a panel showing "Stock-Out Events: 12, Total Orders:
42, Result: 28.6% — FLAGGED (≥ 2% benchmark)" (12/42 = 28.57%, matching the
card's displayed 28.6% exactly); clicking "Avg Backorder Rate" expanded the
equivalent panel ("Backorder Events: 12, Total Orders: 42, Result: 28.6%");
clicking "Avg DoS" expanded a panel listing all 7 real days
(2026-06-01: On-Hand 16,567 ÷ Demand 2,755 = 6.01 days ... 2026-06-07:
On-Hand 0 ÷ Demand 2,752 = 0.00 days) with "Result: Avg DoS 1.48 days"
(hand-summed: (6.01+2.72+1.10+0.51+0+0+0)/7 = 1.48, matching exactly); and
clicking the "L2 — DC Diagnostic Summary" header button still opened the
unmodified "Diagnostics by SKU" drill-down panel (with a metric's own panel
left open simultaneously), confirming the pre-existing card-level
click-through behavior survived the restructure.

### Two independent UI cleanups - "View Calculation" removal (Replenishment) and Data Upload retirement

Two unrelated cleanup changes done in one pass, per the task's own framing.

**Part A - removed "View Calculation" from Parameter Drift cards**
(`Replenishment.jsx`). The button (`onClick={() => showToast('Calculation
details coming soon', 'info')}`) and its stub toast were removed entirely;
the primary action button and the card's other content are untouched. No
layout adjustment was needed - `.insightActions` is a flex row with the
item-id `<span>` already pushed right via `marginLeft: 'auto'`, so removing
the middle button just left the primary button on the left and the id on
the right, with flexbox reflowing naturally (no empty gap to fix).

**A real, pre-existing bug found and fixed while verifying Part A** (not
requested, but directly in the exact action row this task touched, and
the task's own verification step asked to confirm "remaining buttons...
look clean"): the primary action button rendered as a completely empty
blue pill on every Parameter Drift card. Root cause - `{item.actionLabel}`
was referenced at the render site but `actionLabel` was never assigned
anywhere in the file (not in the `driftRows` construction, not anywhere
else - grepped the whole file to confirm exactly one reference, the render
site itself). Fixed by deriving the label the same way the card's own
abbreviation badge two lines above it already does -
`Update {metricCodes[item.metric] || item.metric}` (reusing the existing
`metricCodes` map, e.g. `{'Safety Stock': 'SS', 'Reorder Point': 'ROP', ...}`)
- producing exactly the labels the task itself named as examples ("Update
SS"/"Update ROP"/"Update Max"), not a newly-invented convention.

**Part B - disabled "Data Upload" nav item, matching Outbound's inert
treatment exactly** (`Sidebar.jsx`). STEP 0 read Outbound's actual
implementation first: `{ icon: Send, label: 'Outbound', disabled: true }` -
no `to` field, rendered via the existing generic `disabled ? <button
disabled className="navItem navItemDisabled"> : <NavLink>` branch already
in the component, with no onClick, no badge, no tooltip. Data Upload's
entry was changed to the identical shape - `{ icon: Upload, label: 'Data
Upload', disabled: true }` - reusing that same existing disabled-button
branch verbatim rather than adding a new one, so it inherits the exact same
muted `navItemDisabled` styling with zero new code.

**Route/page precedent, investigated rather than assumed**: Outbound has no
route at all - no `Outbound.jsx` page file exists anywhere in `src/pages/`,
no `<Route path="outbound">` in `App.jsx`, and `git log` shows no history of
one ever being removed (it was never built). Data Upload, by contrast, had
a fully-built (if entirely mock/local-state, zero API calls) page at
`src/pages/DataUpload/DataUpload.jsx` and a live `<Route path="data-upload"
element={<DataUpload />} />`. Per the task's explicit "don't introduce a new
approach" instruction, leaving that route/page live (reachable by direct
URL, just orphaned from nav) would have been a materially different end
state than Outbound's true "nothing exists" precedent - so the route was
removed from `App.jsx` (and its now-unused `import DataUpload` line), and
`src/pages/DataUpload/` (both `DataUpload.jsx` and `.module.css`, both
tracked in git, so safely recoverable from history if ever needed) was
deleted via `git rm`.

**Three dangling references this broke, found by grepping for `data-upload`/
`DataUpload` across `src/` before deleting anything, and fixed** (Outbound
has zero references anywhere outside its own nav entry - confirmed by the
same grep - so matching that precedent required cleaning these up too, not
just removing the route):
1. `Header.jsx`'s `BREADCRUMB_MAP` had a `'/app/data-upload': ['Operations',
   'Data Upload']` entry - removed.
2. `Dashboard.jsx`'s page-header had an "Upload Data" primary button
   (`onClick={() => navigate('/app/data-upload')}`) - removed entirely
   (Outbound has no equivalent quick-launch button anywhere).
3. `Dashboard.jsx`'s Quick Actions list had a "Go to Upload" entry
   (`path:'/app/data-upload'`) - removed from the list.

Left untouched, deliberately: Dashboard's "Recent Uploads" KPI card and a
"Data Upload: inventory_jun30.csv" Recent Activity row - both are
self-contained mock display content with no navigation/link to the removed
route, so they don't break; scrubbing every thematic mention of "upload"
from unrelated mock copy was out of scope (the task asked to disable the
nav item and remove a genuine backend if one existed, not rewrite dashboard
flavor text).

**Backend investigation, reported rather than assumed** (per the task's own
"if no dedicated backend exists, report that clearly rather than assuming
something needs removing"): searched `backend/app` for any route, service,
or model plausibly tied to a general Data Upload feature, explicitly
outside `app/fill_rate/` (untouched, per the task - Fill Rate's own
`/upload/purchase-orders` etc. endpoints are a separate, active feature).
Found nothing: zero case-insensitive matches for "upload" anywhere in
`backend/app` outside `fill_rate/`; the main app's only API routers are
`health`, `inventory`, `network`, `optimization`, `policy`, `simulation` -
none upload-related; no upload-shaped models or migrations exist outside
`fill_rate/`'s own history. Confirmed `DataUpload.jsx` itself made zero API
calls of any kind (`BASE_HISTORY`/`COMPARISON_DATA`/`INITIAL_VALIDATION_ROWS`
were all hardcoded dummy arrays, `handleImport` was a local `setTimeout`)
- there was never a real backend for this frontend mock to begin with.
**No backend code was removed, because none existed to remove** - reported
here rather than assumed.

**Verified live**: `npm run build` succeeded (591 modules, down from 597 -
matching the 2 deleted files). Playwright against `docker compose` + Vite
dev server, zero console errors: the nav screenshot shows "Data Upload"
rendered in the identical muted gray as "Outbound"; clicking it produced no
new toast, no URL change, and no console error; the Parameter Drift card
screenshot shows "View Calculation" gone, the primary button now correctly
reading "Update SS" (previously a blank pill - the incidental bug fix
above), and the item id naturally right-aligned with no awkward gap.

| Phase | Smallest complete vertical slice | Completion evidence | Status |
| --- | --- | --- | --- |
| 1. Network Intelligence Foundation | Backend scaffold; async PostgreSQL/Alembic; canonical masters (including Area, Zone, BinType, and Bin) and inventory-position projection; realistic idempotent seed; network graph; network-state API; frontend client/adapters for Dashboard and Inventory Snapshot with documented development fallback | Migration upgrade/downgrade, backend unit/API tests, frontend build/smoke test, `/health` and `/ready`. | **Done** - verified live |
| 2. Exceptions and Expiry | Batch/expiry facts, FEFO and shelf-life feasibility, exception detection, transfer candidates, expiry/exception endpoints; Batch Tracking and Insights integration | Unit tests for FEFO, expiry feasibility, transfer candidates; API integration tests. | **Done** - verified live |
| 3. Dynamic Policy | Demand/forecast and lead-time observations; variability services; safety-stock formula, ROP/target policy snapshots; drift endpoint; Replenishment integration | Formula/variability tests, policy persistence/API tests, frontend smoke test. | **Done** - verified live |
| 4. MEIO | Multi-node seed prerequisite (Bangalore/Hyderabad + Lanes); Pyomo model with solver adapter/HiGHS, deterministic scenario generation, constraints/costs, optimization run and recommendations endpoints | Feasibility, balance, capacity, MOQ, shelf-life, and API tests with solver status/objective assertions. | **Done** - verified live |
| 5. Policy Robustness | 5 named policy types extending (s,S); rule-based policy-type recommendation engine with real reasoning; seeded Monte Carlo policy simulator and run APIs; Current vs. Suggested policy comparison | Formula, recommendation-rule, reproducibility, and API tests; MIP-vs-simulator balance cross-check. | **Done** - verified live |
| 6.1 Robustness Score + governance | Simulation-backed policy-type recommendation selection (highest score, >=80-and-beats-current gate), 4-tier governance (`no_change_needed`/`suggest_pending_approval`/`no_better_alternative_found`/`auto_changed`), immutable audit log, Waiting-for-Approval/Auto-Approved UI | Formula/tier-boundary/selection tests, live 121-pair zero-violation check, Playwright. | **Done** - verified live |
| 6. ERP writeback (original scope) | Mock ERP writeback, audit/status lifecycle beyond the policy-change audit log already delivered in 6.1; Insights and Settings integration | Decision/writeback idempotency tests, audit/API tests, frontend smoke test. | Not started - awaiting explicit go-ahead |
| Fill Rate module (L1) | Separate `fill_rate_db` database, engine, Base, and Alembic history; SalesOrder/GoodsSent models matching the real Order_File_Week1.xlsx/Goods_Sent_Register.xlsx exactly; automatic startup seed (no upload step); LEFT-JOIN-based compute_fill_rate/compute_fill_rate_by_sku sharing one join helper; supplier fill rate + PO/GR upload endpoints (unrelated data, unchanged) | Live docker isolation proof (both directions + drop test), 128/128 backend tests, live summary endpoint matching hand-computed 57.14%/24 of 42 orders | **Done** - verified live (frontend page needs a follow-up pass, see notes above) |

## Exact Phase 1 file plan

The following is a proposed file plan only; these files are intentionally not created during assessment.

```text
backend/
  pyproject.toml
  alembic.ini
  alembic/env.py
  alembic/versions/0001_network_foundation.py
  app/main.py
  app/core/config.py
  app/core/logging.py
  app/core/errors.py
  app/db/base.py
  app/db/session.py
  app/models/{sku,node,area,zone,bin_type,bin,inventory_position}.py
  app/schemas/{common,network,inventory}.py
  app/repositories/{sku,node,lane,inventory_position}.py
  app/services/network_state_service.py
  app/api/v1/{router,health,inventory,network}.py
  app/seed/network_foundation.py
  tests/{conftest,test_health,test_network_state,test_network_graph,test_inventory_balance}.py
  Dockerfile
docker-compose.yml
.env.example
frontend-compatible additions in this existing app:
  src/api/client.js
  src/api/contracts.js
  src/api/networkState.js
  src/api/fallback/networkState.js
  src/hooks/useNetworkState.js
  src/pages/Dashboard/Dashboard.jsx
  src/pages/InventorySnapshot/InventorySnapshot.jsx
  src/context/AppContext.jsx
  src/test/smoke/navigation.test.jsx (or selected test-runner equivalent)
docs/{data-model,api-contract,frontend-integration-map,deployment}.md
```

Phase 1 design notes: retain existing JSON data only through a documented development fallback adapter; introduce `VITE_API_BASE_URL`; never make API failure silently appear as live data; and preserve all Dashboard/Inventory Snapshot columns by mapping the network-state response at the frontend boundary.

### Phase 1 location hierarchy addendum

Area, Zone, BinType, and Bin are canonical Phase 1 backend entities, not a later enhancement. The migration creates all four tables and has a reverse downgrade. The seed preserves the repository's existing de-identified codes: it ports `areaMaster.json` and `binCapacityMaster.json`, and derives Zone and Bin rows from the existing `inventory.json` references when `zoneMaster.json` is absent. `InventoryPosition` references `binCode`; the API resolves the hierarchy via `Bin -> Zone -> Area` and returns codes and descriptions for Inventory Snapshot. Location Hierarchy remains on local JSON in this phase.
