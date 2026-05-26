/**
 * Smart LLM Router — auto-routes tasks to the optimal model.
 *
 * Policy:
 *   Opus 4.6   — complex reasoning, high-stakes architecture, security, P0 critical
 *   Sonnet 4.6 — coding workhorse for implementation / refactor / test-fix / product thinking
 *   Haiku 3.5  — simple mechanical chores, docs, boilerplate
 *   Gemini     — research / search-heavy / large-context analysis
 */

import { MODEL_PRICING, type ModelPricing } from "./pricing";

export type RoutingTier = "opus" | "sonnet" | "haiku" | "gpt-5.4" | "gpt" | "gemini-flash" | "gemini-pro";

export interface RoutingDecision {
  modelId: string;
  modelName: string;
  tier: RoutingTier;
  reason: string;
  complexityScore: number;
  estimatedCostPer1k: number;
  opusCostPer1k: number;
  savingsPercent: number;
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

const COMPLEXITY_KEYWORDS = {
  high: [
    "architect", "design system", "refactor", "migration", "security",
    "auth", "payment", "billing", "encrypt", "oauth", "multi-tenant",
    "distributed", "consensus", "real-time", "websocket", "streaming",
    "state machine", "compiler", "parser", "optimizer", "algorithm",
    "concurrency", "race condition", "deadlock", "transaction",
    "strategy", "planning", "orchestrat", "pipeline",
  ],
  low: [
    "typo", "rename", "update readme", "add comment", "bump version",
    "fix lint", "format", "boilerplate", "template", "copy",
    "placeholder", "stub", "mock", "seed", "sample data",
    "changelog", "license", "gitignore", "env example",
  ],
};

const RESEARCH_KEYWORDS = [
  "research", "investigate", "explore", "survey", "compare",
  "benchmark", "analyze data", "summarize", "aggregate",
  "market analysis", "competitive", "trend",
];

const LARGE_CONTEXT_KEYWORDS = [
  "codebase", "entire repo", "all files", "full audit",
  "comprehensive review", "cross-cutting", "monorepo",
];

const CODING_KEYWORDS = [
  "build", "implement", "wire", "fix", "refactor", "component", "page",
  "api", "route", "endpoint", "frontend", "backend", "ui", "ux",
  "typescript", "react", "next", "test", "lint", "schema", "migration",
  "bug", "feature", "cleanup", "drawer", "dashboard", "factory",
];

const PRODUCT_THINKING_KEYWORDS = [
  "copy", "messaging", "positioning", "brainstorm", "strategy", "workflow",
  "orchestration", "spec", "prompt", "persona", "planning", "session",
];

const PROJECT_COMPLEXITY: Record<string, number> = {
  "product-studio": 15,
  "research-lab": 15,
  "ops-automation": 12,
  "hiverunner": 10,
  "hiverunner-orchestration": 10,
  "snapaudit": 5,
  "idea-intake": -5,
  "infrastructure": 15,
  "org": -10,
};

const TIER_MODEL_MAP: Record<RoutingTier, string> = {
  opus: "anthropic/claude-opus-4-6",
  sonnet: "anthropic/claude-sonnet-4-6",
  haiku: "anthropic/claude-haiku-3-5",
  "gpt-5.4": "openai/gpt-5.4",
  "gpt": "openai/gpt-5.4",
  "gemini-flash": "google/gemini-2.5-flash",
  "gemini-pro": "google/gemini-2.5-pro",
};

function getTierPricing(tier: RoutingTier): ModelPricing | undefined {
  return MODEL_PRICING.find((p) => p.id === TIER_MODEL_MAP[tier]);
}

function blendedCostPer1k(pricing: ModelPricing): number {
  const inputShare = 0.75;
  const outputShare = 0.25;
  return (
    (pricing.inputPricePerMillion * inputShare +
      pricing.outputPricePerMillion * outputShare) /
    1000
  );
}

function countKeywordHits(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw)).length;
}

function hasAnyTag(task: TaskInput, tags: string[]) {
  const taskTags = task.tags?.map((tag) => String(tag).toLowerCase()) || [];
  return tags.some((tag) => taskTags.includes(tag));
}

function isCodingTask(task: TaskInput, text: string) {
  if (task.type === "feature" || task.type === "bug") return true;
  if (hasAnyTag(task, ["ui", "frontend", "backend", "api", "bug", "code", "engineering"])) return true;
  return countKeywordHits(text, CODING_KEYWORDS) >= 2;
}

function isProductThinkingTask(task: TaskInput, text: string) {
  if (hasAnyTag(task, ["copy", "strategy", "product", "planning", "workflow"])) return true;
  return countKeywordHits(text, PRODUCT_THINKING_KEYWORDS) >= 2;
}

function computeComplexityScore(task: TaskInput): { score: number; signals: string[] } {
  let score = 50;
  const signals: string[] = [];
  const text = `${task.title} ${task.description || ""}`.toLowerCase();

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

  if (task.type === "bug") {
    score += 5;
    signals.push("Bug fix type (+5)");
  } else if (task.type === "maintenance") {
    score -= 10;
    signals.push("Maintenance type (-10)");
  }

  const highHits = countKeywordHits(text, COMPLEXITY_KEYWORDS.high);
  if (highHits > 0) {
    const bump = Math.min(highHits * 8, 30);
    score += bump;
    signals.push(`${highHits} complex keyword(s) (+${bump})`);
  }

  const lowHits = countKeywordHits(text, COMPLEXITY_KEYWORDS.low);
  if (lowHits > 0) {
    const drop = Math.min(lowHits * 10, 30);
    score -= drop;
    signals.push(`${lowHits} simple keyword(s) (-${drop})`);
  }

  const descLen = (task.description || "").length;
  if (descLen > 500) {
    score += 10;
    signals.push("Long description — larger scope (+10)");
  } else if (descLen < 50) {
    score -= 5;
    signals.push("Short/no description (-5)");
  }

  if (task.project && PROJECT_COMPLEXITY[task.project] !== undefined) {
    const adj = PROJECT_COMPLEXITY[task.project];
    score += adj;
    signals.push(`Project \"${task.project}\" complexity (${adj >= 0 ? "+" : ""}${adj})`);
  }

  if (task.tags?.some((t) => ["security", "payment", "auth", "compliance"].includes(String(t).toLowerCase()))) {
    score += 15;
    signals.push("High-stakes tag (+15)");
  }
  if (task.tags?.some((t) => ["docs", "chore", "cleanup"].includes(String(t).toLowerCase()))) {
    score -= 10;
    signals.push("Low-stakes tag (-10)");
  }

  score = Math.max(0, Math.min(100, score));
  return { score, signals };
}

export function routeTask(task: TaskInput): RoutingDecision {
  const { score, signals } = computeComplexityScore(task);
  const text = `${task.title} ${task.description || ""}`.toLowerCase();

  const researchHits = countKeywordHits(text, RESEARCH_KEYWORDS);
  const largeContextHits = countKeywordHits(text, LARGE_CONTEXT_KEYWORDS);
  const codingTask = isCodingTask(task, text);
  const productThinkingTask = isProductThinkingTask(task, text);

  let tier: RoutingTier;
  let reason: string;

  if (largeContextHits >= 2) {
    tier = "gemini-pro";
    reason = "Large-context task — needs extended context for broad repo or cross-system analysis";
    signals.push(`${largeContextHits} large-context keyword(s) → Gemini Pro`);
  } else if (researchHits >= 2 && !codingTask) {
    tier = score >= 60 ? "gemini-pro" : "gemini-flash";
    reason = tier === "gemini-pro"
      ? "Research-heavy task with deeper analysis needs — routed to Gemini Pro"
      : "Research/search-heavy task — routed to Gemini Flash for fast aggregation";
    signals.push(`${researchHits} research keyword(s) → ${tier === "gemini-pro" ? "Gemini Pro" : "Gemini Flash"}`);
  } else if (score >= 90) {
    tier = "opus";
    reason = "Very high complexity or high-stakes work — requires strongest reasoning lane";
  } else if (score >= 80 && codingTask) {
    tier = "gpt-5.4";
    reason = "High complexity coding — GPT Codex saves Anthropic tokens";
    signals.push("Complexity 80-89 coding task → GPT Codex");
  } else if (score >= 80) {
    tier = "opus";
    reason = "High complexity non-coding work — requires strongest reasoning lane";
  } else if (score < 35) {
    tier = "haiku";
    reason = "Low complexity mechanical task — cheapest fast lane is enough";
  } else if (codingTask) {
    tier = "gpt-5.4";
    reason = "Standard coding task — GPT Codex is the implementation workhorse, saves Anthropic quota";
    signals.push("Coding-oriented task → GPT Codex lane");
  } else if (productThinkingTask) {
    tier = "gpt-5.4";
    reason = "Product/orchestration task — GPT Codex to conserve Anthropic quota";
    signals.push("Product-thinking/orchestration task → GPT Codex");
  } else {
    tier = "gpt-5.4";
    reason = "General-purpose task — defaulting to GPT Codex to conserve Anthropic quota";
  }

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

export function getTierModelName(tier: RoutingTier): string {
  const pricing = getTierPricing(tier);
  return pricing?.name || tier;
}

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
