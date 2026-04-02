# Trading Floor Truth Layers — Concrete Implementation Task List

Date: 2026-03-31
Prepared by: Henry
Deadline target: Morning (next working session)
Audience: Weather Edge team / implementation owners
Priority: High

## Objective
Implement the Trading Floor truth-layer redesign so the dashboard cleanly separates:
1. authoritative Kalshi account truth
2. local exposure audit truth
3. realized-only performance truth

This task is not about re-debugging ghost positions. The ghost open-exposure issue was already investigated and largely hardened. This build is about **semantics, presentation, and honest degraded behavior**.

---

## Owner Recommendations
- **Forge 🔧** — API contract cleanup, dashboard/server reliability, fallback semantics
- **Pixel 💻** — Trading Floor UI restructuring, labels, cards, tooltips, visual grouping
- **Gater 🚧** — verify truth-layer separation, degraded-mode honesty, and no mixed semantics in the UI

---

# Workstream A — API Contract Cleanup (Forge)

## A1. `projects/mission-control-app/src/app/api/trading/kalshi-portfolio/route.ts`

### Goal
Expose the response in 3 grouped truth layers while preserving compatibility.

### Required changes
1. Add `account` group
   - `cash`
   - `portfolioValue`
   - `totalValue`
   - `pnl`
   - `source`
2. Add `localExposure` group
   - `openRowCount`
   - `openCostBasis`
   - `filledAwaitingSettlementCount`
   - `filledAwaitingSettlementCostBasis`
   - `trueRestingOrderCount`
   - `trueRestingOrderCostBasis`
   - `source`
3. Add `realized` group
   - `pnl`
   - `bankroll`
   - `won`
   - `lost`
   - `pnl24h`
   - `source`
4. Preserve current flat fields temporarily, but mark them as transitional in comments/types
5. Ensure degraded mode returns:
   - `account.* = null/unknown` when authoritative bankroll is unavailable
   - `localExposure.*` still available
   - `realized.*` still available
6. Keep `cashAvailable` and explicit `source`

### Important semantic rules
- `positions` must no longer be the primary semantic key in the UI; it is too ambiguous
- `costBasis` must be treated as local audit cost basis, not account value
- `unrealizedPnl` must be documented as account-level delta, not row-level MTM

### Acceptance criteria
- API response makes the 3 truth layers explicit
- No fake zero-cash fallback
- Flat keys remain only for migration support

---

## A2. `projects/mission-control-app/src/app/api/trading/weather-stats/route.ts`

### Goal
Make realized-only semantics explicit and stop implying that realized-only bankroll is current account value.

### Required changes
1. Add `realized` group containing:
   - `pnl`
   - `bankroll`
   - `won`
   - `lost`
   - `pnl24h` if available
2. Keep `awaitingSettlement`
3. Keep `openBreakdown`
4. Deprecate ambiguous top-level `bankroll` or annotate it as realized-only
5. Keep `realizedBankroll` if needed for compatibility, but ensure UI consumes the grouped `realized` object instead

### Acceptance criteria
- No ambiguous current-account interpretation of realized-only bankroll
- `awaitingSettlement` remains accurate
- `openBreakdown` remains visible

---

## A3. Shared naming / typings

### Files likely involved
- `projects/mission-control-app/src/lib/live-trade-status.ts`
- any shared frontend types/interfaces for trading responses

### Required changes
1. Create/standardize type definitions for:
   - `AccountTruth`
   - `LocalExposureTruth`
   - `RealizedPerformanceTruth`
2. Use one naming system across all touched trading APIs
3. Add code comments explaining that Kalshi positions/value and local row-model exposure are different truth models by design

### Acceptance criteria
- no silent naming drift across routes
- future developers can tell which fields are authoritative vs local audit

---

# Workstream B — Trading Floor UI Refactor (Pixel)

## B1. Trading Floor KPI/card area

### Goal
Replace blended metrics with explicit truth-layer sections.

### Required layout

#### Section 1 — Account Truth (`KALSHI` badge)
Cards:
- Cash
- Portfolio Value
- Account Value
- Account P&L

#### Section 2 — Exposure Audit (`LOCAL AUDIT` badge)
Cards:
- Open Cost Basis
- Filled Awaiting Settlement
- True Resting Orders
- Open Local Rows

#### Section 3 — Realized Performance (`REALIZED` badge)
Cards:
- Realized P&L
- Realized Bankroll
- Won / Lost
- 24h Realized P&L

### Required behavior
1. Consume grouped API sections from `kalshi-portfolio`
2. Never place local cost-basis cards in the authoritative account row
3. Show clear source badges for each section
4. Add small helper text / tooltip copy:
   - Portfolio Value = exchange-reported current open-position value
   - Open Cost Basis = local unresolved entry-cost basis
   - Realized Bankroll = initial deposit + settled P&L only
5. If account truth unavailable:
   - display `Unknown` / fallback badge
   - do not show zero as if it were truth

### Acceptance criteria
- user can answer at a glance:
  1. what is the account worth?
  2. what is still live locally?
  3. what has been realized?
- no visual blending of truth layers

---

## B2. Labels / field names

### Goal
Reduce semantic confusion in visible labels.

### Required changes
- prefer labels like:
  - `Account Value`
  - `Portfolio Value`
  - `Open Cost Basis`
  - `Filled Awaiting Settlement`
  - `True Resting Orders`
  - `Realized Bankroll`
- avoid ambiguous standalone labels like:
  - `Positions`
  - `Bankroll`
  - `Exposure` without context

### Acceptance criteria
- a tired human reading the page late at night should not need to infer which source model a number came from

---

# Workstream C — Dashboard/Source Reliability (Forge)

## C1. `projects/weather-trading/src/dashboard/server.py`

### Goal
Preserve the source-of-truth dashboard as stable and honest.

### Already hardened in audit
- `/api/bankroll` open/deployed logic corrected
- explicit bucket fields added
- `/api/activity-feed` market-enrichment caching + cap added
- `/api/risk-status` aligned away from poisoned broad open filter

### Remaining tasks
1. Confirm 8050 run strategy is durable during active use
   - if there is a preferred launcher script, document it
   - if not, add a small run note or helper script so the process is not started ad hoc and forgotten
2. Confirm activity-feed market request pressure is materially reduced
3. If another endpoint is still causing avoidable fanout, add light caching there too
4. Preserve honest degraded behavior from upstream to Mission Control

### Acceptance criteria
- 8050 remains available during active dashboard use
- bankroll endpoint stays reachable
- no fake zero-cash catastrophe when upstream is degraded

---

# Workstream D — QA / Verification (Gater)

## D1. API verification

### Validate
1. `GET /api/trading/kalshi-portfolio`
   - grouped truth-layer sections present
   - authoritative account values align with `/api/bankroll`
   - local exposure values align with normalized local DB logic
2. `GET /api/trading/weather-stats`
   - realized-only semantics explicit
   - `awaitingSettlement` preserved
3. `GET /api/bankroll`
   - bucket fields present and sensible

### Expected relationships
- `account.totalValue = account.cash + account.portfolioValue`
- `realized.bankroll = initialDeposit + realized.pnl`
- `localExposure.openCostBasis = filledAwaitingSettlementCostBasis + trueRestingOrderCostBasis` (modulo any pending rows)

## D2. UI verification

### Validate visually
- 3 clearly labeled sections exist
- source badges visible: `KALSHI`, `LOCAL AUDIT`, `REALIZED`
- no card in the wrong section
- degraded mode shows unknown/null honestly, not fake zeroes

## D3. Regression watchouts
- no reintroduction of bogus `resting + fill_quantity > 0` rows counting as open
- no fallback path that computes fake catastrophic P&L from missing cash
- no relabeling of realized-only bankroll as total account value

---

# Deliverables by Morning

## Must-have
1. Grouped API truth layers in `kalshi-portfolio`
2. Realized-only semantics cleaned in `weather-stats`
3. Trading Floor UI split into 3 labeled sections
4. Honest degraded behavior when authoritative account source is unavailable

## Nice-to-have if time permits
1. lightweight helper tooltips / info text
2. small launcher/run note for durable 8050 usage
3. additional endpoint caching if any hotspot still appears

---

# Suggested handoff message to team

Build the Trading Floor truth-layer redesign by morning.

Do **not** spend time rediscovering the ghost-position bug; that forensic work is already done. Treat this as a semantic separation build:
- Kalshi account truth
- local exposure audit
- realized-only performance

Primary files:
- `projects/mission-control-app/src/app/api/trading/kalshi-portfolio/route.ts`
- `projects/mission-control-app/src/app/api/trading/weather-stats/route.ts`
- Trading Floor UI components/page in mission-control-app
- `projects/weather-trading/src/dashboard/server.py` only as needed for reliability follow-through

Priority order:
1. API grouping
2. UI separation
3. degraded-mode honesty
4. source reliability polish

The mission is not to force every number to match.
The mission is to present each number in the correct truth layer so the dashboard is readable and trustworthy.
