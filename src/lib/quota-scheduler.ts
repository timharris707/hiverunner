/**
 * Quota-Aware Scheduler — maximize API value
 *
 * Features:
 *   1. Off-peak batching   — defers P2/P3 work to off-peak windows
 *   2. Priority queue gate — high-priority work always passes; low-priority waits
 *   3. Debouncing          — prevents rapid re-trigger of the same task
 *   4. Run-if-idle         — low-priority work only runs when nothing higher is pending
 *   5. Budget tracking     — per-window spend caps with automatic throttling
 */

import { readJSON } from "./build-queue";
import { calculateCost, normalizeModelId } from "./pricing";
import { join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { getAgentByAnyId, getDisplayName } from "@/config/agents";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DATA_DIR = join(process.cwd(), "data");
const QUOTA_STATE_FILE = join(DATA_DIR, "quota-state.json");
const BUILD_LOG_FILE = join(DATA_DIR, "build-log.json");

/** Hours considered off-peak (UTC). Covers ~10 PM – 8 AM US-Pacific. */
const OFF_PEAK_HOURS_UTC = new Set([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

/** Priority tiers — P0/P1 are "high", P2/P3 are "low" */
const HIGH_PRIORITY = new Set(["P0", "P1"]);

/** Default daily budget cap in USD. Soft limit — warns but doesn't block P0. */
const DEFAULT_DAILY_BUDGET_USD = 500; // Bumped during buildout phase — factory needs room to run

/** Per-window (peak/off-peak) budget split: 70% peak, 30% off-peak */
const PEAK_BUDGET_RATIO = 0.7;
const OFF_PEAK_BUDGET_RATIO = 0.3;

/** Debounce window: ignore re-trigger of the same task within this many ms */
const DEBOUNCE_WINDOW_MS = 30_000; // 30 seconds

/** Max low-priority tasks that can run per off-peak window */
const MAX_OFF_PEAK_BATCH_SIZE = 100; // Effectively unlimited during buildout phase

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface QuotaState {
  /** ISO date string (YYYY-MM-DD) this state applies to */
  date: string;
  /** Accumulated spend in USD for peak window today */
  peakSpendUsd: number;
  /** Accumulated spend in USD for off-peak window today */
  offPeakSpendUsd: number;
  /** Total tasks dispatched in peak window today */
  peakTaskCount: number;
  /** Total tasks dispatched in off-peak window today */
  offPeakTaskCount: number;
  /** Task ID → last trigger timestamp (for debouncing) */
  lastTrigger: Record<string, number>;
  /** Task IDs deferred to off-peak */
  deferredQueue: DeferredTask[];
  /** Cost ledger for today's approved work by agent */
  byAgent: Record<string, number>;
}

export interface DeferredTask {
  taskId: string;
  priority: string;
  estimatedCostUsd: number;
  deferredAt: string;
  reason: string;
}

export type SchedulingVerdict =
  | { action: "allow"; reason: string }
  | { action: "defer"; reason: string; deferUntil: string }
  | { action: "debounced"; reason: string; retryAfterMs: number }
  | { action: "budget-warn"; reason: string }
  | { action: "block"; reason: string };

export interface QuotaConfig {
  dailyBudgetUsd: number;
  peakBudgetRatio: number;
  offPeakBudgetRatio: number;
  debounceWindowMs: number;
  maxOffPeakBatchSize: number;
  offPeakHoursUtc: Set<number>;
}

export interface QuotaSummary {
  date: string;
  currentWindow: "peak" | "off-peak";
  currentHourUtc: number;
  dailyBudgetUsd: number;
  peakBudgetUsd: number;
  offPeakBudgetUsd: number;
  peakSpendUsd: number;
  offPeakSpendUsd: number;
  peakUtilization: number;
  offPeakUtilization: number;
  totalSpendUsd: number;
  totalUtilization: number;
  peakTaskCount: number;
  offPeakTaskCount: number;
  deferredCount: number;
  deferredTasks: DeferredTask[];
  byAgent: Array<{ agent: string; cost: number }>;
  nextWindowChangeUtc: string;
  idleSlots: number;
}

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const defaultConfig: QuotaConfig = {
  dailyBudgetUsd: DEFAULT_DAILY_BUDGET_USD,
  peakBudgetRatio: PEAK_BUDGET_RATIO,
  offPeakBudgetRatio: OFF_PEAK_BUDGET_RATIO,
  debounceWindowMs: DEBOUNCE_WINDOW_MS,
  maxOffPeakBatchSize: MAX_OFF_PEAK_BATCH_SIZE,
  offPeakHoursUtc: OFF_PEAK_HOURS_UTC,
};

let activeConfig: QuotaConfig = { ...defaultConfig };

export function configureQuota(overrides: Partial<Omit<QuotaConfig, "offPeakHoursUtc">>): QuotaConfig {
  activeConfig = { ...activeConfig, ...overrides };
  return activeConfig;
}

export function getQuotaConfig(): QuotaConfig {
  return { ...activeConfig };
}

/* ------------------------------------------------------------------ */
/*  State persistence                                                  */
/* ------------------------------------------------------------------ */

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function freshState(): QuotaState {
  return {
    date: todayStr(),
    peakSpendUsd: 0,
    offPeakSpendUsd: 0,
    peakTaskCount: 0,
    offPeakTaskCount: 0,
    lastTrigger: {},
    deferredQueue: [],
    byAgent: {},
  };
}

export function loadQuotaState(): QuotaState {
  const state = readJSON<QuotaState>(QUOTA_STATE_FILE, freshState());
  // Roll over on new day
  if (state.date !== todayStr()) {
    return freshState();
  }
  const byAgent = state.byAgent && Object.keys(state.byAgent).length > 0
    ? state.byAgent
    : buildAgentLedgerFromBuildLog(state.date);
  return {
    ...state,
    byAgent,
  };
}

export function saveQuotaState(state: QuotaState): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(QUOTA_STATE_FILE, JSON.stringify(state, null, 2));
}

/* ------------------------------------------------------------------ */
/*  Time helpers                                                       */
/* ------------------------------------------------------------------ */

export function isOffPeak(now = new Date()): boolean {
  return activeConfig.offPeakHoursUtc.has(now.getUTCHours());
}

export function currentWindow(now = new Date()): "peak" | "off-peak" {
  return isOffPeak(now) ? "off-peak" : "peak";
}

/** Returns the next hour boundary where the window type flips */
export function nextWindowChangeUtc(now = new Date()): Date {
  const current = isOffPeak(now);
  const result = new Date(now);
  result.setUTCMinutes(0, 0, 0);
  for (let i = 1; i <= 24; i++) {
    result.setUTCHours(result.getUTCHours() + 1);
    if (isOffPeak(result) !== current) {
      return result;
    }
  }
  // Fallback: tomorrow same time
  result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Budget helpers                                                     */
/* ------------------------------------------------------------------ */

function windowBudget(window: "peak" | "off-peak"): number {
  return window === "peak"
    ? activeConfig.dailyBudgetUsd * activeConfig.peakBudgetRatio
    : activeConfig.dailyBudgetUsd * activeConfig.offPeakBudgetRatio;
}

function windowSpend(state: QuotaState, window: "peak" | "off-peak"): number {
  return window === "peak" ? state.peakSpendUsd : state.offPeakSpendUsd;
}

function budgetUtilization(state: QuotaState, window: "peak" | "off-peak"): number {
  const budget = windowBudget(window);
  if (budget <= 0) return 0;
  return windowSpend(state, window) / budget;
}

/* ------------------------------------------------------------------ */
/*  Cost estimation                                                    */
/* ------------------------------------------------------------------ */

/** Rough cost estimate for a task based on model tier and average token usage */
export function estimateTaskCost(task: {
  routedTier?: string;
  routedModel?: string;
  priority?: string;
}): number {
  // Average tokens per task by tier (rough heuristics from real usage)
  const avgTokensByTier: Record<string, { input: number; output: number }> = {
    opus: { input: 150_000, output: 15_000 },
    sonnet: { input: 100_000, output: 10_000 },
    haiku: { input: 50_000, output: 5_000 },
    "gemini-pro": { input: 200_000, output: 10_000 },
    "gemini-flash": { input: 100_000, output: 5_000 },
  };

  const tier = task.routedTier || "sonnet";
  const tokens = avgTokensByTier[tier] || avgTokensByTier.sonnet;
  const modelId = task.routedModel
    ? normalizeModelId(task.routedModel)
    : normalizeModelId(tier);

  return calculateCost(modelId, tokens.input, tokens.output);
}

/* ------------------------------------------------------------------ */
/*  Debouncing                                                         */
/* ------------------------------------------------------------------ */

function isDebouncedTask(state: QuotaState, taskId: string, now = Date.now()): {
  debounced: boolean;
  remainingMs: number;
} {
  const lastTs = state.lastTrigger[taskId];
  if (!lastTs) return { debounced: false, remainingMs: 0 };

  const elapsed = now - lastTs;
  if (elapsed < activeConfig.debounceWindowMs) {
    return { debounced: true, remainingMs: activeConfig.debounceWindowMs - elapsed };
  }
  return { debounced: false, remainingMs: 0 };
}

function recordTrigger(state: QuotaState, taskId: string, now = Date.now()): void {
  state.lastTrigger[taskId] = now;

  // Prune stale entries (older than 1 hour)
  const cutoff = now - 3_600_000;
  for (const [id, ts] of Object.entries(state.lastTrigger)) {
    if (ts < cutoff) delete state.lastTrigger[id];
  }
}

/* ------------------------------------------------------------------ */
/*  Idle detection                                                     */
/* ------------------------------------------------------------------ */

/**
 * Checks if there are higher-priority tasks pending in the queue.
 * A "low" priority task should only run when no "high" priority tasks are waiting.
 */
export function hasHigherPriorityPending(
  tasks: Array<{ id: string; status: string; priority?: string }>,
  candidateTaskId: string
): boolean {
  const candidate = tasks.find((t) => t.id === candidateTaskId);
  if (!candidate) return false;

  // If the candidate is already high priority, never block it
  if (HIGH_PRIORITY.has(candidate.priority || "P2")) return false;

  // Check if any high-priority tasks are waiting to run.
  // Failed/blocked tasks should NOT gate lower-priority promotion — they are stuck
  // and will be retried or triaged independently.
  return tasks.some(
    (t: { id?: string; priority?: string; status?: string; buildState?: string }) =>
      t.id !== candidateTaskId &&
      HIGH_PRIORITY.has(t.priority || "P2") &&
      ["backlog", "to-do", "in-progress"].includes(t.status || "") &&
      // Only block if the high-priority task doesn't already have an active build
      !["done", "review"].includes(t.status || "") &&
      // Don't let failed or blocked builds gate lower-priority tasks
      t.buildState !== "failed" &&
      t.buildState !== "blocked" &&
      t.status !== "blocked"
  );
}

/* ------------------------------------------------------------------ */
/*  Core scheduling decision                                           */
/* ------------------------------------------------------------------ */

export function evaluateTask(
  task: {
    id: string;
    priority?: string;
    routedTier?: string;
    routedModel?: string;
    status?: string;
    assignedAgent?: string;
    assignee?: string;
  },
  allTasks: Array<{ id: string; status: string; priority?: string }>,
  now = new Date()
): SchedulingVerdict {
  const state = loadQuotaState();
  const window = currentWindow(now);
  const priority = task.priority || "P2";
  const isHigh = HIGH_PRIORITY.has(priority);
  const estimatedCost = estimateTaskCost(task);

  // 1. Debounce check — applies to all priorities
  const { debounced, remainingMs } = isDebouncedTask(state, task.id, now.getTime());
  if (debounced) {
    return {
      action: "debounced",
      reason: `Task ${task.id} was triggered ${Math.round((activeConfig.debounceWindowMs - remainingMs) / 1000)}s ago — cooling down`,
      retryAfterMs: remainingMs,
    };
  }

  // 2. P0 tasks always pass (budget warning only)
  if (priority === "P0") {
    const utilization = budgetUtilization(state, window);
    recordTrigger(state, task.id, now.getTime());
    recordApprovedSpend(state, task, estimatedCost, window);
    saveQuotaState(state);

    if (utilization > 0.9) {
      return {
        action: "budget-warn",
        reason: `P0 task allowed but ${window} budget is ${Math.round(utilization * 100)}% utilized ($${windowSpend(state, window).toFixed(2)}/$${windowBudget(window).toFixed(2)})`,
      };
    }
    return { action: "allow", reason: "P0 critical — always allowed" };
  }

  // 3. Run-if-idle: low-priority waits if higher-priority work is pending
  if (!isHigh && hasHigherPriorityPending(allTasks, task.id)) {
    return {
      action: "defer",
      reason: `Higher-priority tasks are pending — ${priority} task deferred until queue is idle`,
      deferUntil: "idle",
    };
  }

  // 4. Off-peak batching: DISABLED — factory needs to run freely during buildout phase
  // TODO: Re-enable once factory is stable and we need cost optimization
  if (false && !isHigh && window === "peak") {
    const nextChange = nextWindowChangeUtc(now);
    // Add to deferred queue
    const alreadyDeferred = state.deferredQueue.some((d) => d.taskId === task.id);
    if (!alreadyDeferred) {
      state.deferredQueue.push({
        taskId: task.id,
        priority,
        estimatedCostUsd: estimatedCost,
        deferredAt: now.toISOString(),
        reason: "Deferred to off-peak window for cost optimization",
      });
      saveQuotaState(state);
    }
    return {
      action: "defer",
      reason: `${priority} task deferred to off-peak window (saves ~${Math.round((1 - OFF_PEAK_BUDGET_RATIO / PEAK_BUDGET_RATIO) * 100)}% budget pressure). Next off-peak: ${nextChange.toISOString()}`,
      deferUntil: nextChange.toISOString(),
    };
  }

  // 5. Budget gate: check if window budget allows this task
  const utilization = budgetUtilization(state, window);
  const budget = windowBudget(window);
  const spent = windowSpend(state, window);

  if (spent + estimatedCost > budget) {
    // High priority can exceed budget with warning
    if (isHigh) {
      recordTrigger(state, task.id, now.getTime());
      recordApprovedSpend(state, task, estimatedCost, window);
      saveQuotaState(state);
      return {
        action: "budget-warn",
        reason: `${priority} task allowed but ${window} budget will be exceeded ($${(spent + estimatedCost).toFixed(2)}/$${budget.toFixed(2)})`,
      };
    }

    // Low priority gets blocked when budget is exhausted
    return {
      action: "block",
      reason: `${window} budget exhausted ($${spent.toFixed(2)}/$${budget.toFixed(2)}) — ${priority} task blocked until next window`,
    };
  }

  // 6. Off-peak batch size limit for low-priority
  if (!isHigh && window === "off-peak") {
    if (state.offPeakTaskCount >= activeConfig.maxOffPeakBatchSize) {
      return {
        action: "block",
        reason: `Off-peak batch limit reached (${state.offPeakTaskCount}/${activeConfig.maxOffPeakBatchSize}) — ${priority} task blocked until next window`,
      };
    }
  }

  // 7. All checks passed — allow
  recordTrigger(state, task.id, now.getTime());
  recordApprovedSpend(state, task, estimatedCost, window);

  // Remove from deferred queue if present
  state.deferredQueue = state.deferredQueue.filter((d) => d.taskId !== task.id);

  saveQuotaState(state);

  return {
    action: "allow",
    reason: `${priority} task approved — ${window} budget ${Math.round(utilization * 100)}% utilized`,
  };
}

/* ------------------------------------------------------------------ */
/*  Deferred queue processing                                          */
/* ------------------------------------------------------------------ */

/**
 * Returns task IDs from the deferred queue that are eligible to run now.
 * Call this when entering an off-peak window or when the queue becomes idle.
 */
export function drainDeferredQueue(
  allTasks: Array<{ id: string; status: string; priority?: string }>
): string[] {
  const state = loadQuotaState();
  const window = currentWindow();

  // Only drain during off-peak
  if (window !== "off-peak") return [];

  // Sort deferred by priority (P2 before P3), then by deferral time
  const sorted = [...state.deferredQueue].sort((a, b) => {
    const pa = a.priority === "P2" ? 0 : 1;
    const pb = b.priority === "P2" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return new Date(a.deferredAt).getTime() - new Date(b.deferredAt).getTime();
  });

  const budget = windowBudget("off-peak");
  let remainingBudget = budget - state.offPeakSpendUsd;
  const batchSlots = activeConfig.maxOffPeakBatchSize - state.offPeakTaskCount;
  const eligible: string[] = [];

  for (const deferred of sorted) {
    if (eligible.length >= batchSlots) break;
    if (deferred.estimatedCostUsd > remainingBudget) continue;

    // Verify the task still exists and is in a runnable state
    const task = allTasks.find((t) => t.id === deferred.taskId);
    if (!task || !["backlog", "to-do", "in-progress"].includes(task.status)) {
      continue;
    }

    // Skip if higher-priority work is still pending
    if (hasHigherPriorityPending(allTasks, deferred.taskId)) continue;

    eligible.push(deferred.taskId);
    remainingBudget -= deferred.estimatedCostUsd;
  }

  // Remove eligible tasks from deferred queue
  if (eligible.length > 0) {
    const eligibleSet = new Set(eligible);
    state.deferredQueue = state.deferredQueue.filter((d) => !eligibleSet.has(d.taskId));
    saveQuotaState(state);
  }

  return eligible;
}

/**
 * Remove a specific task from the deferred queue (e.g., if cancelled or completed).
 */
export function removeDeferredTask(taskId: string): boolean {
  const state = loadQuotaState();
  const before = state.deferredQueue.length;
  state.deferredQueue = state.deferredQueue.filter((d) => d.taskId !== taskId);
  if (state.deferredQueue.length !== before) {
    saveQuotaState(state);
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Summary / dashboard                                                */
/* ------------------------------------------------------------------ */

export function getQuotaSummary(now = new Date()): QuotaSummary {
  const state = loadQuotaState();
  const window = currentWindow(now);
  const peakBudget = windowBudget("peak");
  const offPeakBudget = windowBudget("off-peak");
  const recordedTotal = round4(state.peakSpendUsd + state.offPeakSpendUsd);
  const byAgent = Object.entries(state.byAgent || {})
    .map(([agent, cost]) => ({
      agent,
      cost: round4(cost),
    }))
    .sort((a, b) => b.cost - a.cost);
  const byAgentTotal = round4(byAgent.reduce((sum, entry) => sum + entry.cost, 0));
  const unattributedDelta = round4(recordedTotal - byAgentTotal);
  const normalizedByAgent = [...byAgent];
  if (unattributedDelta > 0) {
    normalizedByAgent.push({ agent: "Unattributed", cost: unattributedDelta });
  }
  normalizedByAgent.sort((a, b) => b.cost - a.cost);
  const totalSpend = normalizedByAgent.reduce((sum, entry) => sum + entry.cost, 0);

  // Calculate idle slots: off-peak batch slots remaining
  const offPeakSlotsUsed = state.offPeakTaskCount;
  const idleSlots = Math.max(0, activeConfig.maxOffPeakBatchSize - offPeakSlotsUsed);

  return {
    date: state.date,
    currentWindow: window,
    currentHourUtc: now.getUTCHours(),
    dailyBudgetUsd: activeConfig.dailyBudgetUsd,
    peakBudgetUsd: peakBudget,
    offPeakBudgetUsd: offPeakBudget,
    peakSpendUsd: round2(state.peakSpendUsd),
    offPeakSpendUsd: round2(state.offPeakSpendUsd),
    peakUtilization: round2(peakBudget > 0 ? state.peakSpendUsd / peakBudget : 0),
    offPeakUtilization: round2(offPeakBudget > 0 ? state.offPeakSpendUsd / offPeakBudget : 0),
    totalSpendUsd: round2(totalSpend),
    totalUtilization: round2(activeConfig.dailyBudgetUsd > 0 ? totalSpend / activeConfig.dailyBudgetUsd : 0),
    peakTaskCount: state.peakTaskCount,
    offPeakTaskCount: state.offPeakTaskCount,
    deferredCount: state.deferredQueue.length,
    deferredTasks: state.deferredQueue,
    byAgent: normalizedByAgent,
    nextWindowChangeUtc: nextWindowChangeUtc(now).toISOString(),
    idleSlots,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function getTaskAgentLabel(task: { assignedAgent?: string; assignee?: string }): string {
  const agentRef = task.assignedAgent || task.assignee || "unknown";
  const agent = getAgentByAnyId(agentRef);
  if (agent) {
    return getDisplayName(agent);
  }
  return String(agentRef);
}

interface BuildLogEntry {
  assignedAgent?: string;
  startedAt?: string | null;
  queuedAt?: string | null;
  runningAt?: string | null;
  completedAt?: string | null;
  routing?: {
    tier?: string;
    modelId?: string;
  };
}

function buildAgentLedgerFromBuildLog(date: string): Record<string, number> {
  const buildLog = readJSON<{ builds?: BuildLogEntry[] }>(BUILD_LOG_FILE, { builds: [] });
  const byAgent: Record<string, number> = {};

  for (const build of buildLog.builds || []) {
    const buildDate = getBuildDate(build);
    if (buildDate !== date) continue;

    const agentLabel = getTaskAgentLabel({ assignedAgent: build.assignedAgent });
    byAgent[agentLabel] = (byAgent[agentLabel] || 0) + estimateTaskCost({
      routedTier: build.routing?.tier,
      routedModel: build.routing?.modelId,
    });
  }

  return byAgent;
}

function getBuildDate(build: BuildLogEntry): string | null {
  const stamp = build.startedAt || build.queuedAt || build.runningAt || build.completedAt;
  if (!stamp) return null;

  const parsed = new Date(stamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split("T")[0];
}

function recordApprovedSpend(
  state: QuotaState,
  task: { assignedAgent?: string; assignee?: string },
  estimatedCost: number,
  window: "peak" | "off-peak"
): void {
  if (window === "peak") {
    state.peakSpendUsd += estimatedCost;
    state.peakTaskCount++;
  } else {
    state.offPeakSpendUsd += estimatedCost;
    state.offPeakTaskCount++;
  }

  const agentLabel = getTaskAgentLabel(task);
  state.byAgent[agentLabel] = (state.byAgent[agentLabel] || 0) + estimatedCost;
}

/* ------------------------------------------------------------------ */
/*  Record actual spend (called after build completes)                 */
/* ------------------------------------------------------------------ */

/**
 * Record actual cost after a build finishes (adjusts estimates).
 * Call this from finalizeBuild to keep spend tracking accurate.
 */
export function recordActualSpend(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  completedAt: Date
): void {
  const state = loadQuotaState();
  if (state.date !== completedAt.toISOString().split("T")[0]) return; // Different day, ignore

  const actualCost = calculateCost(normalizeModelId(modelId), inputTokens, outputTokens);
  const window = currentWindow(completedAt);

  // We already estimated the cost when the task was approved.
  // This is a supplementary record — in a more advanced version we'd track
  // estimate vs actual and adjust, but for now we just note it.
  // The estimates recorded at approval time are close enough for gating purposes.

  // No-op for now — the approval-time estimates drive budget gating.
  // This hook exists so we can later add estimate-vs-actual drift tracking.
  void actualCost;
  void window;
}
