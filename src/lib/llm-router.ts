/**
 * Smart LLM Router — Auto-routes tasks to the optimal model based on
 * complexity, task type, project context, and cost efficiency.
 *
 * Routing tiers:
 *   Opus 4.6     — Complex reasoning, architecture, strategy, P0 critical
 *   Sonnet 4.5   — Standard coding, features, bug fixes (default workhorse)
 *   Haiku 3.5    — Simple tasks, boilerplate, docs, maintenance
 *   Gemini Flash  — Data processing, summarization, search-heavy tasks
 *   Gemini Pro    — Research, analysis, large-context tasks
 */

import { MODEL_PRICING, type ModelPricing } from "./pricing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoutingTier = "opus" | "sonnet" | "haiku" | "gemini-flash" | "gemini-pro";

export interface RoutingDecision {
  /** Selected model ID (full provider/model format) */
  modelId: string;
  /** Human-readable model name */
  modelName: string;
  /** Routing tier key */
  tier: RoutingTier;
  /** Why the router picked this model */
  reason: string;
  /** Complexity score 0-100 */
  complexityScore: number;
  /** Estimated cost per 1K tokens (input+output blended) */
  estimatedCostPer1k: number;
  /** Cost if Opus were used instead (for savings calc) */
  opusCostPer1k: number;
  /** Percentage saved vs always using Opus */
  savingsPercent: number;
  /** Signals that contributed to the decision */
  signals: string[];
}

export interface TaskInput {
  title: string;
  description?: string;
  type?: "feature" | "bug" | "maintenance";
  priority?: "P0" | "P1" | "P2" | "P3";
  project?: string;
  tags?: string[];
  assignee?: string;
}

// ---------------------------------------------------------------------------
// Signal weights & keyword maps
// ---------------------------------------------------------------------------

/** Keywords that push toward higher-capability models */
const COMPLEXITY_KEYWORDS = {
  high: [
    "architect", "design system", "refactor", "migration", "security",
    "auth", "payment", "billing", "encrypt", "oauth", "multi-tenant",
    "distributed", "consensus", "real-time", "websocket", "streaming",
    "state machine", "compiler", "parser", "optimizer", "algorithm",
    "concurrency", "race condition", "deadlock", "transaction",
    "strategy", "advisory", "orchestrat", "pipeline",
  ],
  low: [
    "typo", "rename", "update readme", "add comment", "bump version",
    "fix lint", "format", "boilerplate", "template", "copy",
    "placeholder", "stub", "mock", "seed", "sample data",
    "changelog", "license", "gitignore", "env example",
  ],
};

/** Keywords suggesting research / search-heavy work */
const RESEARCH_KEYWORDS = [
  "research", "investigate", "explore", "survey", "compare",
  "benchmark", "analyze data", "summarize", "aggregate",
  "market analysis", "competitive", "trend",
];

/** Keywords suggesting large-context needs */
const LARGE_CONTEXT_KEYWORDS = [
  "codebase", "entire repo", "all files", "full audit",
  "comprehensive review", "cross-cutting", "monorepo",
];

/** Project complexity hints */
const PROJECT_COMPLEXITY: Record<string, number> = {
  "crypto-trading": 20,
  "stock-trading": 20,
  "weather-trading": 15,
  "advisory-board": 15,
  "mission-control": 10,
  "snapaudit": 5,
  "idea-intake": -5,
  "infrastructure": 15,
  "org": -10,
};

// ---------------------------------------------------------------------------
// Model registry (maps tiers to pricing entries)
// ---------------------------------------------------------------------------

const TIER_MODEL_MAP: Record<RoutingTier, string> = {
  opus: "anthropic/claude-opus-4-6",
  sonnet: "anthropic/claude-sonnet-4-5",
  haiku: "anthropic/claude-haiku-3-5",
  "gemini-flash": "google/gemini-2.5-flash",
  "gemini-pro": "google/gemini-2.5-pro",
};

function getTierPricing(tier: RoutingTier): ModelPricing | undefined {
  return MODEL_PRICING.find((p) => p.id === TIER_MODEL_MAP[tier]);
}

function blendedCostPer1k(pricing: ModelPricing): number {
  // Assume ~3:1 input:output ratio for typical agent tasks
  const inputShare = 0.75;
  const outputShare = 0.25;
  return (
    (pricing.inputPricePerMillion * inputShare +
      pricing.outputPricePerMillion * outputShare) /
    1000
  );
}

// ---------------------------------------------------------------------------
// Core routing logic
// ---------------------------------------------------------------------------

function countKeywordHits(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw)).length;
}

function computeComplexityScore(task: TaskInput): { score: number; signals: string[] } {
  let score = 50; // Start at midpoint
  const signals: string[] = [];
  const text = `${task.title} ${task.description || ""}`.toLowerCase();

  // --- Priority signal ---
  if (task.priority === "P0") {
    score += 20;
    signals.push("P0 critical priority (+20)");
  } else if (task.priority === "P1") {
    score += 10;
    signals.push("P1 high priority (+10)");
  } else if (task.priority === "P3") {
    score -= 15;
    signals.push("P3 low priority (-15)");
  }

  // --- Type signal ---
  if (task.type === "bug") {
    score += 5;
    signals.push("Bug fix type (+5)");
  } else if (task.type === "maintenance") {
    score -= 10;
    signals.push("Maintenance type (-10)");
  }

  // --- High-complexity keywords ---
  const highHits = countKeywordHits(text, COMPLEXITY_KEYWORDS.high);
  if (highHits > 0) {
    const bump = Math.min(highHits * 8, 30);
    score += bump;
    signals.push(`${highHits} complex keyword(s) (+${bump})`);
  }

  // --- Low-complexity keywords ---
  const lowHits = countKeywordHits(text, COMPLEXITY_KEYWORDS.low);
  if (lowHits > 0) {
    const drop = Math.min(lowHits * 10, 30);
    score -= drop;
    signals.push(`${lowHits} simple keyword(s) (-${drop})`);
  }

  // --- Description length as proxy for scope ---
  const descLen = (task.description || "").length;
  if (descLen > 500) {
    score += 10;
    signals.push("Long description — larger scope (+10)");
  } else if (descLen < 50) {
    score -= 5;
    signals.push("Short/no description (-5)");
  }

  // --- Project complexity ---
  if (task.project && PROJECT_COMPLEXITY[task.project] !== undefined) {
    const adj = PROJECT_COMPLEXITY[task.project];
    score += adj;
    signals.push(`Project "${task.project}" complexity (${adj >= 0 ? "+" : ""}${adj})`);
  }

  // --- Tags ---
  if (task.tags?.some((t) => ["security", "payment", "auth", "compliance"].includes(t))) {
    score += 15;
    signals.push("High-stakes tag (+15)");
  }
  if (task.tags?.some((t) => ["docs", "chore", "cleanup"].includes(t))) {
    score -= 10;
    signals.push("Low-stakes tag (-10)");
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  return { score, signals };
}

/**
 * Route a task to the optimal model.
 */
export function routeTask(task: TaskInput): RoutingDecision {
  const { score, signals } = computeComplexityScore(task);
  const text = `${task.title} ${task.description || ""}`.toLowerCase();

  let tier: RoutingTier;
  let reason: string;

  // Check for research/search-heavy tasks first
  const researchHits = countKeywordHits(text, RESEARCH_KEYWORDS);
  const largeContextHits = countKeywordHits(text, LARGE_CONTEXT_KEYWORDS);

  if (largeContextHits >= 2) {
    tier = "gemini-pro";
    reason = "Large-context task — needs extended context window for full codebase/repo analysis";
    signals.push(`${largeContextHits} large-context keyword(s) → Gemini Pro`);
  } else if (researchHits >= 2 && score < 60) {
    tier = "gemini-flash";
    reason = "Research/search-heavy task — Gemini Flash optimized for data aggregation";
    signals.push(`${researchHits} research keyword(s) → Gemini Flash`);
  } else if (score >= 75) {
    tier = "opus";
    reason = "High complexity — requires deep reasoning, architecture design, or handles critical systems";
  } else if (score >= 40) {
    tier = "sonnet";
    reason = "Standard complexity — solid coding task well-suited for Sonnet's speed/quality balance";
  } else {
    tier = "haiku";
    reason = "Low complexity — simple, mechanical task that Haiku handles efficiently";
  }

  // Build the decision
  const modelId = TIER_MODEL_MAP[tier];
  const pricing = getTierPricing(tier);
  const opusPricing = getTierPricing("opus");

  const estimatedCostPer1k = pricing ? blendedCostPer1k(pricing) : 0;
  const opusCostPer1k = opusPricing ? blendedCostPer1k(opusPricing) : 0;
  const savingsPercent =
    opusCostPer1k > 0
      ? Math.round(((opusCostPer1k - estimatedCostPer1k) / opusCostPer1k) * 100)
      : 0;

  return {
    modelId,
    modelName: pricing?.name || tier,
    tier,
    reason,
    complexityScore: score,
    estimatedCostPer1k: Math.round(estimatedCostPer1k * 10000) / 10000,
    opusCostPer1k: Math.round(opusCostPer1k * 10000) / 10000,
    savingsPercent: Math.max(0, savingsPercent),
    signals,
  };
}

/**
 * Get the model name for a tier (for display).
 */
export function getTierModelName(tier: RoutingTier): string {
  const pricing = getTierPricing(tier);
  return pricing?.name || tier;
}

/**
 * Get all available tiers with their pricing info.
 */
export function getAvailableTiers(): Array<{
  tier: RoutingTier;
  modelId: string;
  modelName: string;
  costPer1k: number;
}> {
  return (Object.entries(TIER_MODEL_MAP) as [RoutingTier, string][]).map(
    ([tier, modelId]) => {
      const pricing = MODEL_PRICING.find((p) => p.id === modelId);
      return {
        tier,
        modelId,
        modelName: pricing?.name || tier,
        costPer1k: pricing ? blendedCostPer1k(pricing) : 0,
      };
    }
  );
}
