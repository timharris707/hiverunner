# Trading Floor Truth Layers Spec

Date: 2026-03-31
Owner: Henry
Status: Draft for build
Priority: High

## Problem

The Trading Floor currently mixes three different kinds of truth into one blurred reporting surface:

1. **Authoritative exchange account truth** from Kalshi
2. **Local row-model exposure truth** from `live_trading.db`
3. **Realized-only performance truth** from settled local trades

These are all valid, but they are not interchangeable. The current UI/API shape causes them to look like conflicting numbers when in fact they answer different questions.

### Observed failure modes from the audit
- Fully filled rows could remain labeled `resting`, which polluted local open exposure.
- Trading Floor endpoints treated `status IN ('pending','filled','resting')` as open without integrity guards.
- Missing bankroll service availability caused fallback mode to fabricate `cash = 0`, which made portfolio/P&L look catastrophically wrong.
- Even after hardening those bugs, the UI still mixes:
  - Kalshi cash + Kalshi portfolio value
  - local row counts and cost basis
  - realized-only bankroll proxy

This makes the system appear contradictory even when the numbers are internally consistent.

## Goal

Redesign Trading Floor reporting into explicit **truth layers** so each number is clearly labeled by source and meaning.

## Truth Layer Model

### Layer 1 — Account Truth (Authoritative / Kalshi)
Question answered: **What is the account worth right now?**

Source: Kalshi

Fields:
- `kalshiCash`
- `kalshiPortfolioValue`
- `kalshiAccountValue`
- `kalshiAccountPnl`
- `initialDeposit`

Definitions:
- `kalshiCash` = exchange-reported available cash balance
- `kalshiPortfolioValue` = exchange-reported current value of open positions
- `kalshiAccountValue` = `kalshiCash + kalshiPortfolioValue`
- `kalshiAccountPnl` = `kalshiAccountValue - initialDeposit`

Notes:
- This is the top-line source of truth for account value.
- No local row-model counts or cost basis should appear in this layer.

### Layer 2 — Local Exposure Audit (Operational / Local)
Question answered: **What does our local engine believe is still live?**

Source: local `live_trading.db`

Fields:
- `localOpenRowCount`
- `localOpenCostBasis`
- `localFilledAwaitingSettlementCount`
- `localFilledAwaitingSettlementCostBasis`
- `localTrueRestingOrderCount`
- `localTrueRestingOrderCostBasis`

Definitions:
- `localOpenRowCount` = normalized unresolved local rows
- `localOpenCostBasis` = normalized unresolved local cost basis
- `localFilledAwaitingSettlement*` = rows/cost basis where status is effectively filled but unresolved
- `localTrueRestingOrder*` = truly unfilled resting orders only

Notes:
- This is an audit / reconciliation layer, not exchange account truth.
- These values should never be labeled as account value or cash.

### Layer 3 — Realized Performance (Settled / Local)
Question answered: **What have we actually locked in?**

Source: local settled trades

Fields:
- `realizedPnl`
- `realizedBankroll`
- `won`
- `lost`
- `realizedPnl24h`

Definitions:
- `realizedPnl` = sum of settled trade P&L
- `realizedBankroll` = `initialDeposit + realizedPnl`
- `won` / `lost` = settled local outcomes
- `realizedPnl24h` = settled realized P&L over the last 24h

Notes:
- This is not current account value.
- Existing ambiguous `bankroll` naming should be deprecated in favor of `realizedBankroll`.

## UI Design Recommendation

### Row 1 — Account Truth
Badge: `KALSHI`

Cards:
- Cash
- Portfolio Value
- Account Value
- Account P&L

### Row 2 — Exposure Audit
Badge: `LOCAL AUDIT`

Cards:
- Open Cost Basis
- Filled Awaiting Settlement
- True Resting Orders
- Open Local Rows

### Row 3 — Realized Performance
Badge: `REALIZED`

Cards:
- Realized P&L
- Realized Bankroll
- Won / Lost
- 24h Realized P&L

## Critical UI Rules

1. Never present local cost basis as if it were exchange account value.
2. Never present realized-only bankroll as if it were current account value.
3. Every card group must carry a visible source label.
4. On degraded upstream availability:
   - show `unknown` / null for unavailable authoritative fields
   - never substitute fake zeroes

## API Contract Recommendation

## `GET /api/trading/kalshi-portfolio`

Add grouped sections while preserving legacy flat fields temporarily.

Proposed grouped response:

```json
{
  "account": {
    "cash": 546.46,
    "portfolioValue": 132.89,
    "totalValue": 679.35,
    "pnl": -320.65,
    "source": "kalshi"
  },
  "localExposure": {
    "openRowCount": 52,
    "openCostBasis": 232.73,
    "filledAwaitingSettlementCount": 51,
    "filledAwaitingSettlementCostBasis": 230.23,
    "trueRestingOrderCount": 1,
    "trueRestingOrderCostBasis": 2.50,
    "source": "local-audit"
  },
  "realized": {
    "pnl": -100.53,
    "bankroll": 899.47,
    "won": 8,
    "lost": 50,
    "pnl24h": -86.33,
    "source": "settled"
  }
}
```

Legacy compatibility during migration:
- Keep current flat keys for one transition phase.
- Mark deprecated semantics in comments/types/docs:
  - `positions` => alias of `account.portfolioValue`
  - `costBasis` => alias of `localExposure.openCostBasis`
  - `unrealizedPnl` => account-level unrealized/open delta, not row-level MTM

## `GET /api/trading/weather-stats`

Required cleanup:
- add a `realized` group
- keep `bankroll` only as deprecated alias or remove from the UI entirely
- explicitly label `awaitingSettlement`
- preserve `openBreakdown`

## Reliability Requirements

1. If the dashboard bankroll source is unavailable:
   - do not fabricate `cash = 0`
   - return `null` / unknown for authoritative account fields
2. Keep local audit fields available even in degraded mode.
3. Use lightweight caching on market-enrichment endpoints to avoid self-inflicted 429s.
4. Keep the 8050 dashboard server running in a durable way during active use.

## Acceptance Criteria

### API
- `kalshi-portfolio` response clearly separates account truth, local exposure audit, and realized performance.
- `weather-stats` no longer presents ambiguous realized-only `bankroll` as if it were current account value.
- No endpoint returns fake zero cash when authoritative bankroll fetch fails.

### UI
- Trading Floor visually separates the 3 truth layers.
- A user can answer, at a glance:
  1. what is the account worth?
  2. what is still live locally?
  3. what has actually been realized?
- No card mixes exchange truth and local audit truth without labels.

### Reliability
- Activity feed no longer causes avoidable market-fanout pressure on every refresh cycle.
- 8050 availability failures degrade honestly instead of catastrophically.

## Non-Goals
- Full reconciliation of every local trade row to Kalshi netted position semantics in this pass.
- Full mark-to-market per local row.
- Historical weather-stats cleanup beyond removing/labeling ambiguous bankroll semantics.

## Why this matters

The system is now much closer to truthful than it was at the start of the audit. The remaining confusion is mostly semantic, not foundational. This redesign ensures Tim can read the dashboard without reverse-engineering which truth model each number came from.
