type MetricKind = "high" | "low" | null;
type ThresholdOperator = ">" | ">=" | "<" | "<=";

type MarketProposition =
  | { kind: "range"; metric: MetricKind; lower: number; upper: number }
  | { kind: "threshold"; metric: MetricKind; operator: ThresholdOperator; value: number }
  | { kind: "unknown"; metric: MetricKind };

export interface TradingFloorActualLike {
  high: number;
  low: number;
  complete?: boolean;
}

export interface TradingFloorMarketSemanticsInput {
  ticker: string;
  threshold?: number | null;
  marketFloorStrike?: number | null;
  marketCapStrike?: number | null;
  marketTitle?: string | null;
}

export interface TradingFloorOutcomeInput extends TradingFloorMarketSemanticsInput {
  side: string;
  actual: TradingFloorActualLike;
}

export interface TradingFloorLockedOutcomeInput extends TradingFloorOutcomeInput {
  settlementAt?: string | null;
  marketStatus?: string | null;
  marketResult?: string | null;
  nowMs?: number;
}

const COMPLETE_MARKET_STATUSES = new Set([
  "settled",
  "resolved",
  "finalized",
  "determined",
  "closed",
  "complete",
  "completed",
  "expired",
]);

function getMetricFromTicker(ticker: string): MetricKind {
  if (/HIGH/i.test(ticker)) return "high";
  if (/LOW/i.test(ticker)) return "low";
  return null;
}

function parseTickerBracketBase(ticker: string): number | null {
  const bracketMatch = ticker.match(/-B([\d.]+)$/);
  return bracketMatch ? Number.parseFloat(bracketMatch[1]) : null;
}

function parseTickerThreshold(ticker: string, fallbackThreshold?: number | null): number | null {
  const thresholdMatch = ticker.match(/-T([\d.]+)$/);
  if (thresholdMatch) return Number.parseFloat(thresholdMatch[1]);
  return fallbackThreshold ?? null;
}

function parseTitleThreshold(title?: string | null): { operator: ThresholdOperator; value: number } | null {
  if (!title) return null;
  const match = title.match(/(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  return {
    operator: match[1] as ThresholdOperator,
    value: Number.parseFloat(match[2]),
  };
}

function deriveMarketProposition(input: TradingFloorMarketSemanticsInput): MarketProposition {
  const metric = getMetricFromTicker(input.ticker);

  if (input.marketFloorStrike != null && input.marketCapStrike != null) {
    return { kind: "range", metric, lower: input.marketFloorStrike, upper: input.marketCapStrike };
  }

  const titleThreshold = parseTitleThreshold(input.marketTitle);
  if (titleThreshold) {
    return { kind: "threshold", metric, operator: titleThreshold.operator, value: titleThreshold.value };
  }

  if (input.marketFloorStrike != null && input.marketCapStrike == null) {
    return { kind: "threshold", metric, operator: ">", value: input.marketFloorStrike };
  }

  if (input.marketCapStrike != null && input.marketFloorStrike == null) {
    return { kind: "threshold", metric, operator: "<", value: input.marketCapStrike };
  }

  const bracketBase = parseTickerBracketBase(input.ticker);
  if (bracketBase != null) {
    return { kind: "range", metric, lower: bracketBase, upper: bracketBase + 2 };
  }

  const threshold = parseTickerThreshold(input.ticker, input.threshold);
  if (threshold != null) {
    if (metric === "high") return { kind: "threshold", metric, operator: "<=", value: threshold };
    if (metric === "low") return { kind: "threshold", metric, operator: ">=", value: threshold };
  }

  return { kind: "unknown", metric };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function formatThresholdLabel(operator: ThresholdOperator, value: number): string {
  const intBoundary = Number.isInteger(value);
  switch (operator) {
    case ">":
      return intBoundary ? `${formatNumber(value + 1)}° or above` : `above ${formatNumber(value)}°`;
    case ">=":
      return `${formatNumber(value)}° or above`;
    case "<":
      return intBoundary ? `${formatNumber(value - 1)}° or below` : `below ${formatNumber(value)}°`;
    case "<=":
      return `${formatNumber(value)}° or below`;
  }
}

function getMetricValue(actual: TradingFloorActualLike, metric: MetricKind): number | null {
  if (metric === "high") return actual.high;
  if (metric === "low") return actual.low;
  return null;
}

function evaluateEventFromProposition(actual: TradingFloorActualLike, proposition: MarketProposition): boolean | null {
  const metricValue = getMetricValue(actual, proposition.metric);
  if (metricValue == null) return null;

  if (proposition.kind === "range") {
    return metricValue >= proposition.lower && metricValue < proposition.upper;
  }

  if (proposition.kind === "threshold") {
    switch (proposition.operator) {
      case ">":
        return metricValue > proposition.value;
      case ">=":
        return metricValue >= proposition.value;
      case "<":
        return metricValue < proposition.value;
      case "<=":
        return metricValue <= proposition.value;
    }
  }

  return null;
}

function isEventIrreversible(actual: TradingFloorActualLike, proposition: MarketProposition): boolean {
  const metricValue = getMetricValue(actual, proposition.metric);
  if (metricValue == null) return false;

  if (proposition.kind === "range") {
    if (proposition.metric === "high") {
      return metricValue >= proposition.upper;
    }
    if (proposition.metric === "low") {
      return metricValue < proposition.lower;
    }
    return false;
  }

  if (proposition.kind === "threshold") {
    if (proposition.metric === "high") {
      switch (proposition.operator) {
        case ">":
          return metricValue > proposition.value;
        case ">=":
          return metricValue >= proposition.value;
        case "<":
          return metricValue >= proposition.value;
        case "<=":
          return metricValue > proposition.value;
      }
    }

    if (proposition.metric === "low") {
      switch (proposition.operator) {
        case ">":
          return metricValue <= proposition.value;
        case ">=":
          return metricValue < proposition.value;
        case "<":
          return metricValue < proposition.value;
        case "<=":
          return metricValue <= proposition.value;
      }
    }
  }

  return false;
}

function isMarketResolvedByStatusOrTime(input: TradingFloorLockedOutcomeInput): boolean {
  const status = String(input.marketStatus || "").toLowerCase();
  if (status && COMPLETE_MARKET_STATUSES.has(status)) return true;

  if (input.settlementAt) {
    const settleAtMs = new Date(input.settlementAt).getTime();
    if (!Number.isNaN(settleAtMs)) {
      const nowMs = input.nowMs ?? Date.now();
      if (nowMs >= settleAtMs) return true;
    }
  }

  return false;
}

export function getMarketPropositionLabel(input: TradingFloorMarketSemanticsInput): string {
  const proposition = deriveMarketProposition(input);

  if (proposition.kind === "range") {
    return `${formatNumber(proposition.lower)}° to ${formatNumber(proposition.upper)}°`;
  }

  if (proposition.kind === "threshold") {
    return formatThresholdLabel(proposition.operator, proposition.value);
  }

  if (proposition.metric === "high") return "High";
  if (proposition.metric === "low") return "Low";
  return "Weather";
}

export function evaluatePositionOutcomeFromActual(input: TradingFloorOutcomeInput): boolean | null {
  const side = String(input.side || "").toLowerCase();
  if (side !== "yes" && side !== "no") return null;

  const proposition = deriveMarketProposition(input);
  const eventOccurs = evaluateEventFromProposition(input.actual, proposition);
  if (eventOccurs == null) return null;

  return side === "yes" ? eventOccurs : !eventOccurs;
}

export function getLockedPositionOutcomeFromActual(input: TradingFloorLockedOutcomeInput): boolean | null {
  const side = String(input.side || "").toLowerCase();
  if (side !== "yes" && side !== "no") return null;

  const marketResult = String(input.marketResult || "").toLowerCase();
  if (marketResult === "yes" || marketResult === "no") {
    return side === marketResult;
  }

  const proposition = deriveMarketProposition(input);
  const eventOccurs = evaluateEventFromProposition(input.actual, proposition);
  if (eventOccurs == null) return null;

  const sideOutcome = side === "yes" ? eventOccurs : !eventOccurs;

  if (input.actual.complete) return sideOutcome;
  if (isMarketResolvedByStatusOrTime(input)) return sideOutcome;

  return isEventIrreversible(input.actual, proposition) ? sideOutcome : null;
}
