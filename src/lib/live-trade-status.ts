export const REAL_OPEN_LIVE_TRADE_WHERE = `(
  status IN ('pending', 'filled', 'partial')
  OR (status = 'resting')
)`;

export const TRUE_RESTING_LIVE_TRADE_WHERE = `(status = 'resting' AND COALESCE(fill_quantity, 0) = 0)`;
export const FILLED_LIVE_TRADE_WHERE = `(status IN ('filled', 'partial') OR (status = 'resting' AND COALESCE(fill_quantity, 0) > 0))`;

export const REAL_OPEN_LIVE_TRADE_COUNT_EXPR = `CASE WHEN ${REAL_OPEN_LIVE_TRADE_WHERE} THEN 1 ELSE 0 END`;
export const REAL_OPEN_LIVE_TRADE_COST_EXPR = `CASE WHEN ${REAL_OPEN_LIVE_TRADE_WHERE} THEN cost ELSE 0 END`;
export const TRUE_RESTING_LIVE_TRADE_COUNT_EXPR = `CASE WHEN ${TRUE_RESTING_LIVE_TRADE_WHERE} THEN 1 ELSE 0 END`;
export const TRUE_RESTING_LIVE_TRADE_COST_EXPR = `CASE WHEN ${TRUE_RESTING_LIVE_TRADE_WHERE} THEN cost ELSE 0 END`;
export const FILLED_LIVE_TRADE_COUNT_EXPR = `CASE WHEN ${FILLED_LIVE_TRADE_WHERE} THEN 1 ELSE 0 END`;
export const FILLED_LIVE_TRADE_COST_EXPR = `CASE WHEN ${FILLED_LIVE_TRADE_WHERE} THEN cost ELSE 0 END`;

export function normalizeLiveTradeLifecycleStatus(status: string, fillQuantity: number, quantity: number): string {
  if (status === 'resting' && fillQuantity >= quantity && quantity > 0) return 'filled';
  if (status === 'resting' && fillQuantity > 0 && fillQuantity < quantity) return 'partial';
  return status;
}

/**
 * Truth-layer types for Trading Floor API responses.
 *
 * The Trading Floor exposes three distinct truth models that answer different questions.
 * These types make the separation explicit so consumers never conflate exchange-authoritative
 * values with local audit data or realized-only performance figures.
 *
 * Kalshi positions/value and local row-model exposure are different truth models by design:
 * - Kalshi knows account totals; it does not know our local strategy rows.
 * - Local DB knows our open rows; it may lag settlement events.
 * - Realized figures are settled-only and are never a proxy for current account value.
 */

/** Layer 1 — Authoritative Kalshi account truth. Answers: what is the account worth right now? */
export interface AccountTruth {
  /** Exchange-reported available cash balance. Null when Kalshi is unreachable — never substituted with zero. */
  cash: number | null;
  /** Exchange-reported current value of open positions. */
  portfolioValue: number | null;
  /** cash + portfolioValue as reported by the exchange. */
  totalValue: number | null;
  /** totalValue − initialDeposit. */
  pnl: number | null;
  source: "kalshi";
}

/** Layer 2 — Local row-model exposure audit. Answers: what does our local engine believe is still live? */
export interface LocalExposureTruth {
  /**
   * Total normalized unresolved local rows.
   * = trueRestingOrderCount + filledAwaitingSettlementCount
   * This is an audit/reconciliation figure, not exchange account value.
   */
  openRowCount: number;
  /**
   * Total normalized unresolved entry cost basis.
   * = trueRestingOrderCostBasis + filledAwaitingSettlementCostBasis
   */
  openCostBasis: number;
  /** Rows where status is effectively filled but exchange settlement is still pending. */
  filledAwaitingSettlementCount: number;
  filledAwaitingSettlementCostBasis: number;
  /** Truly unfilled resting orders only (no partial fills). */
  trueRestingOrderCount: number;
  trueRestingOrderCostBasis: number;
  source: "local-audit";
}

/** Layer 3 — Realized-only performance from settled local trades. Answers: what have we actually locked in? */
export interface RealizedPerformanceTruth {
  /** Sum of settled trade P&L. This is NOT current account value. */
  pnl: number;
  /**
   * initialDeposit + realizedPnl.
   * This is a realized-only proxy for bankroll — NOT current account value.
   * @deprecated Top-level `bankroll` fields should be replaced by this grouped value.
   */
  bankroll: number;
  won: number;
  lost: number;
  /** Settled realized P&L over the last 24 hours. Null if unavailable. */
  pnl24h: number | null;
  source: "settled";
}
