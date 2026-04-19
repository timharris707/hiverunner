type TradeRow = Record<string, unknown>;

type Side = "yes" | "no";

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSide(value: unknown): Side | null {
  const side = String(value || "").trim().toLowerCase();
  if (side === "yes" || side === "no") return side;
  return null;
}

function normalizeTicker(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

function keyFor(ticker: string, side: Side): string {
  return `${ticker}|${side}`;
}

function pickNewestLocalRow(rows: TradeRow[]): TradeRow | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const aTime = Date.parse(String(a.created_at || ""));
    const bTime = Date.parse(String(b.created_at || ""));
    if (!Number.isNaN(aTime) && !Number.isNaN(bTime)) return bTime - aTime;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  })[0];
}

interface ExchangeLikePosition {
  ticker?: unknown;
  side?: unknown;
  quantity?: unknown;
  cost?: unknown;
  avg_price?: unknown;
  fees_paid_dollars?: unknown;
  fee?: unknown;
}

function deriveLocalFilledPosition(local: TradeRow): {
  effectiveQuantity: number;
  effectiveCost: number;
  effectiveAvgPrice: number | null;
  usedFilledQuantity: boolean;
} {
  const orderQuantity = toNumber(local.quantity);
  const filledQuantity = Math.max(0, toNumber(local.fill_quantity));
  const usedFilledQuantity = filledQuantity > 0 && filledQuantity !== orderQuantity;
  const effectiveQuantity = filledQuantity > 0 ? filledQuantity : orderQuantity;

  const orderCost = toNumber(local.cost);
  const directPrice = toNullableNumber(local.price);
  const inferredOrderAvg = orderQuantity > 0 ? orderCost / orderQuantity : null;
  const avgPrice = directPrice ?? inferredOrderAvg;

  let effectiveCost = orderCost;
  if (filledQuantity > 0 && avgPrice != null) {
    effectiveCost = avgPrice * effectiveQuantity;
  }

  const effectiveAvgPrice = effectiveQuantity > 0
    ? effectiveCost / effectiveQuantity
    : avgPrice;

  return {
    effectiveQuantity,
    effectiveCost,
    effectiveAvgPrice,
    usedFilledQuantity,
  };
}

/**
 * Canonical open-position truth rule:
 * - When exchange open positions are present, they are authoritative for quantity/cost/avg price.
 * - Local DB rows are retained only as metadata/audit fallback.
 */
export function reconcileOpenTradesWithExchangeTruth(
  localOpenTrades: TradeRow[],
  exchangeOpenPositions: ExchangeLikePosition[],
  checkedAt: string,
): TradeRow[] {
  if (!Array.isArray(exchangeOpenPositions) || exchangeOpenPositions.length === 0) {
    return localOpenTrades.map((trade) => {
      const derived = deriveLocalFilledPosition(trade);
      return {
        ...trade,
        quantity: derived.effectiveQuantity,
        cost: derived.effectiveCost,
        price: derived.effectiveAvgPrice ?? 0,
        local_quantity: toNumber(trade.quantity),
        local_cost: toNumber(trade.cost),
        local_fill_quantity: toNumber(trade.fill_quantity),
        exchange_quantity: null,
        exchange_cost: null,
        exchange_avg_price: null,
        exchange_truth_source: derived.usedFilledQuantity ? "local-fill-derived" : "local-fallback",
      };
    });
  }

  const localByTickerSide = new Map<string, TradeRow[]>();
  const localByTicker = new Map<string, TradeRow[]>();

  for (const local of localOpenTrades) {
    const ticker = normalizeTicker(local.ticker || local.contract_id);
    if (!ticker) continue;
    const side = normalizeSide(local.side);

    if (!localByTicker.has(ticker)) localByTicker.set(ticker, []);
    localByTicker.get(ticker)!.push(local);

    if (side) {
      const k = keyFor(ticker, side);
      if (!localByTickerSide.has(k)) localByTickerSide.set(k, []);
      localByTickerSide.get(k)!.push(local);
    }
  }

  const consumedLocals = new Set<TradeRow>();
  const reconciled: TradeRow[] = [];

  for (const exchange of exchangeOpenPositions) {
    const ticker = normalizeTicker(exchange.ticker);
    if (!ticker) continue;

    const side = normalizeSide(exchange.side)
      || normalizeSide(localByTicker.get(ticker)?.[0]?.side)
      || "yes";

    const exactLocalRows = localByTickerSide.get(keyFor(ticker, side)) ?? [];
    const fallbackLocalRows = exactLocalRows.length > 0 ? [] : (localByTicker.get(ticker) ?? []);
    const candidateLocalRows = exactLocalRows.length > 0 ? exactLocalRows : fallbackLocalRows;
    const local = pickNewestLocalRow(candidateLocalRows);

    for (const row of candidateLocalRows) consumedLocals.add(row);

    const quantity = toNumber(exchange.quantity);
    const cost = toNumber(exchange.cost);
    const avgPrice = toNullableNumber(exchange.avg_price) ?? (quantity > 0 ? cost / quantity : toNullableNumber(local?.price));

    const enriched: TradeRow = {
      ...(local || {}),
      trade_id: String(local?.trade_id || `kalshi-open-${ticker.toLowerCase()}-${side}`),
      order_id: local?.order_id ?? null,
      contract_id: String(local?.contract_id || ticker),
      ticker,
      side,
      quantity,
      cost,
      price: avgPrice ?? 0,
      fill_quantity: quantity,
      status: String(local?.status || "filled"),
      created_at: String(local?.created_at || checkedAt),
      strategy_version: local?.strategy_version ?? "exchange-truth",
      our_probability: local?.our_probability ?? null,
      market_probability: local?.market_probability ?? null,
      fees_paid_dollars: toNumber(exchange.fees_paid_dollars ?? exchange.fee),
      local_quantity: toNullableNumber(local?.quantity),
      local_cost: toNullableNumber(local?.cost),
      local_fill_quantity: toNullableNumber(local?.fill_quantity),
      exchange_quantity: quantity,
      exchange_cost: cost,
      exchange_avg_price: avgPrice,
      exchange_truth_source: "kalshi",
      exchange_checked_at: checkedAt,
    };

    reconciled.push(enriched);
  }

  for (const local of localOpenTrades) {
    if (consumedLocals.has(local)) continue;
    const derived = deriveLocalFilledPosition(local);
    reconciled.push({
      ...local,
      quantity: derived.effectiveQuantity,
      cost: derived.effectiveCost,
      price: derived.effectiveAvgPrice ?? 0,
      local_quantity: toNumber(local.quantity),
      local_cost: toNumber(local.cost),
      local_fill_quantity: toNumber(local.fill_quantity),
      exchange_quantity: null,
      exchange_cost: null,
      exchange_avg_price: null,
      exchange_truth_source: derived.usedFilledQuantity ? "local-fill-derived" : "local-fallback",
    });
  }

  return reconciled;
}
