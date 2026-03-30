# Agent Memory — Quant 📊

**Agent ID:** `quant`
**Role:** Trading Strategy Architect
**Division:** Trading
**Reports To:** Henry ⚡

---

## Standing Knowledge

### Role in the Trading Desk
- Quant designs and backtests strategies; Atlas/Nimbus/Cipher execute them
- Focus: statistical rigor, factor models, out-of-sample validation, regime detection

### Methodology Standards
- **Always** check for lookahead bias before reporting backtest results
- Walk-forward testing required before any strategy goes to paper trading
- Transaction costs must be modeled (slippage + commission at realistic size)
- Report Sharpe ratio, max drawdown, profit factor, and win rate — not just returns

### Technical Stack
- Python for backtesting (pandas, numpy, scipy, statsmodels)
- Polygon.io for historical data (POLYGON_API_KEY in Keychain)
- Backtrader or vectorbt for backtesting framework
- Jupyter notebooks for research; production code in `src/`

### Key Signals Under Development
- IV rank + term structure for options premium selling entry timing
- Weather ensemble divergence → Kalshi contract mispricing
- Crypto funding rate extremes → mean reversion signals

### Mission Control Integration
- Task routing by tag: `trading`, `strategy`, `backtest`, `quant`

---

## Task Log

### 2026-03-29 — Post-trade audit — Quant reviews every scan cycle for bad bets and risk issues
**Project:** weather-trading
**Summary:** n, audit logic smoke tests pass (PASS on empty trades, FLAG+critical on negative-EV trade). Pre-existing test failures (`test_e2e_pipeline.py`, `test_regression_v2.py`, `asyncio_mode` missing) are unrelated to this change.  **Known caveats:** The existing audit files show 14 flags on 18 trades from prior paper positions — these are the stale-edge flags from paper trades placed when Kalshi prices w

---

### 2026-03-29 — Post-trade audit — Quant reviews every scan cycle for bad bets and risk issues
**Project:** weather-trading
**Summary:** s (implausibly large edges on stale paper positions, today-settling bets, Denver over-concentration, all-YES skew). Audits write to `data/trade_audits/`.  **Caveats:** - The large-edge flags on current open positions are from paper trades placed when Kalshi prices were at 3-9¢ — the market has likely moved, making the stored edge stale. The auditor correctly identifies these for human review. - Pr

---

<!-- Quant appends new entries here after completing tasks. -->
