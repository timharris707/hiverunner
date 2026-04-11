# Trading Floor Truth Layers Build Plan

Date: 2026-03-31
Owner: Henry
Status: Ready for implementation planning

## Objective
Implement the Trading Floor truth-layer model so the dashboard cleanly separates:
1. authoritative Kalshi account truth
2. local exposure audit truth
3. realized-only performance truth

## Build Phases

### Phase 1 — API contract cleanup (minimal breakage)

#### 1. `projects/mission-control-app/src/app/api/trading/kalshi-portfolio/route.ts`

**Current problems**
- mixes Kalshi account value with local row-model counts/cost basis in one flat response
- `positions` is ambiguous (actually Kalshi portfolio value)
- `unrealizedPnl` is account-level delta but not labeled that way

**Required changes**
- Add grouped sections:
  - `account`
  - `localExposure`
  - `realized`
- Preserve current flat fields temporarily for compatibility
- Add explicit semantics in code comments/types:
  - `positions` = deprecated alias of `account.portfolioValue`
  - `costBasis` = deprecated alias of `localExposure.openCostBasis`
  - `unrealizedPnl` = account-level unrealized/open delta, not per-row MTM
- Ensure degraded mode keeps:
  - local exposure fields
  - realized fields
  - null authoritative account fields if bankroll source unavailable

**Acceptance checks**
- `cash`, `portfolio`, `pnl` become clearly part of `account`
- local open row count/cost basis live under `localExposure`
- `realizedPnl`, `won`, `lost`, `pnl24h` live under `realized`

#### 2. `projects/mission-control-app/src/app/api/trading/weather-stats/route.ts`

**Current problems**
- `bankroll` is realized-only but sounds like current account value
- `realizedBankroll` exists, but ambiguous `bankroll` still encourages confusion

**Required changes**
- Add `realized` group:
  - `pnl`
  - `bankroll`
  - `won`
  - `lost`
  - `pnl24h` where relevant
- Keep `awaitingSettlement`
- Keep `openBreakdown`
- Deprecate top-level ambiguous `bankroll` field or relabel it in response metadata

**Acceptance checks**
- no ambiguous plain `bankroll` shown to the UI as top-level truth without realized-only labeling
- `awaitingSettlement` remains sourced from filled-open local rows

#### 3. Shared typing / naming

**Files likely involved**
- `src/lib/live-trade-status.ts`
- any frontend TS types consuming trading routes

**Required changes**
- define truth-layer terminology in one place
- avoid future drift in naming across routes

---

### Phase 2 — Trading Floor UI refactor

#### Likely files
- Trading Floor page/components in `projects/mission-control-app/src/app/trading/...`
- any shared components rendering portfolio cards / KPI rows

**Required changes**
- Replace blended KPI area with 3 explicit sections:

##### Section A — Account Truth (`KALSHI` badge)
Cards:
- Cash
- Portfolio Value
- Account Value
- Account P&L

##### Section B — Exposure Audit (`LOCAL AUDIT` badge)
Cards:
- Open Cost Basis
- Filled Awaiting Settlement
- True Resting Orders
- Open Local Rows

##### Section C — Realized Performance (`REALIZED` badge)
Cards:
- Realized P&L
- Realized Bankroll
- Won / Lost
- 24h Realized P&L

**UI rules**
- never mix cards from different truth layers in one row without labels
- tooltips/help text must explain:
  - exchange-reported current value
  - local cost basis / row-model exposure
  - realized-only metrics
- degraded state should render `unknown` for unavailable authoritative values, not zero

**Acceptance checks**
- a user can tell at a glance:
  1. account value
  2. local unresolved exposure
  3. realized performance
- no card relies on mental reverse-engineering of field semantics

---

### Phase 3 — Reliability follow-through

#### 1. `projects/weather-trading/src/dashboard/server.py`

**Already hardened in audit**
- `/api/bankroll` open/deployed filters corrected
- explicit bucket fields added
- `/api/activity-feed` cached + capped to reduce rate-limit pressure

**Remaining follow-up**
- confirm 8050 stays running durably during dashboard use
- if needed, document/start via a managed background command rather than transient foreground shell
- inspect whether any other endpoint still creates avoidable market fanout

#### 2. Fallback behavior

**Current desired behavior**
- authoritative account fields may be null if bankroll source is unavailable
- local audit and realized layers should still render
- no fake zero-cash catastrophe

**Acceptance checks**
- degraded mode remains honest and readable
- source labels indicate fallback vs authoritative state

---

## Suggested Implementation Order

1. Update `kalshi-portfolio` grouped response shape
2. Update `weather-stats` realized-only labeling
3. Update frontend Trading Floor cards to consume grouped sections
4. Verify degraded mode when 8050 is unavailable
5. Verify live mode when 8050 is running

---

## Test / Verification Checklist

### API verification
- `curl http://127.0.0.1:3010/api/trading/kalshi-portfolio`
  - grouped sections present
  - flat compatibility keys still present if needed
- `curl http://127.0.0.1:3010/api/trading/weather-stats`
  - realized-only semantics explicit
  - `awaitingSettlement` and `openBreakdown` intact
- `curl http://127.0.0.1:8050/api/bankroll`
  - authoritative account truth available when dashboard server is healthy

### Data sanity checks
Compare:
- `account.totalValue` vs `kalshi_total`
- `localExposure.openCostBasis` vs normalized local open cost
- `localExposure.filledAwaitingSettlementCostBasis` vs normalized local filled-open cost
- `realized.bankroll` vs `initialDeposit + realizedPnl`

### Degraded-mode checks
- stop or simulate loss of 8050 bankroll source
- verify account fields become null/unknown, not zero
- verify local exposure + realized layers still render

### UI checks
- account cards show only Kalshi truth
- local audit cards show only local row-model metrics
- realized cards show only settled metrics
- tooltips/source badges are visible and understandable

---

## Risks / Watchouts

1. **Backward compatibility risk**
- existing frontend code may assume flat keys
- mitigate by keeping flat aliases during migration

2. **Naming risk**
- if legacy names remain in the UI too long, confusion persists
- migrate labels aggressively even if old keys remain under the hood

3. **Dashboard/server dependency risk**
- if 8050 is unavailable, authoritative account truth will be missing
- UI must degrade honestly

4. **Kalshi net positions vs local row model**
- do not try to pretend counts/cost basis match 1:1
- present them as different lenses by design

---

## Handoff summary for implementer

Do not chase another round of ghost-position debugging.
That part is largely solved.

The next build is a **semantic separation project**:
- account truth
- local audit exposure
- realized-only performance

The mission is not to force every number to match. The mission is to present each number in the right truth layer so the dashboard reads cleanly and honestly.
