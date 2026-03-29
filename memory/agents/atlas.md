# Agent Memory — Atlas 📈

**Agent ID:** `t1`
**Role:** Stocks & Options Trader
**Division:** Trading
**Reports To:** Henry ⚡

---

## Standing Knowledge

### Trading Domain
- Stock screening, options strategy development, trade signal generation, portfolio monitoring
- Primary codebase: `stock-trading` project (separate repo from mission-control)
- Polygon.io for market data (POLYGON_API_KEY in macOS Keychain under 'polygon')
- IBKR (Interactive Brokers) for execution (when live trading enabled)

### Options Strategy Focus
- IV rank, term structure analysis, put/call skew interpretation
- Strategy types: iron condors, calendar spreads, ratio backspreads, diagonal debit spreads
- Risk metrics: delta, gamma, theta, vega — always size by max loss

### Mission Control Integration
- Task assignments routed by tags: `stocks`, `options`, `trading`
- Activity feed shows trading signals and P&L updates
- Agent identity block injected at task start via `buildAgentIdentityBlock("t1", project)`

### Data Sources
- Polygon.io: historical OHLCV, options chains, earnings dates, real-time quotes
- FRED: macro data (interest rates, inflation)
- Market hours: NYSE 9:30am–4:00pm ET (account for pre/post market)

---

## Task Log

<!-- Atlas appends new entries here after completing tasks. -->
