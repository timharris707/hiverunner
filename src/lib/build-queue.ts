/* eslint-disable @typescript-eslint/no-explicit-any */
import { execFile, execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import os from "os";
import { routeTask } from "@/lib/llm-router";
import { resolveHiveRunnerAppRoot } from "@/lib/runtime-paths";
import { evaluateTask, drainDeferredQueue, removeDeferredTask, type SchedulingVerdict } from "@/lib/quota-scheduler";
import { appendTaskToLog, importExternalTasks } from "@/lib/tasks-log";
import {
  resolveAgentForTask,
  buildAgentIdentityBlock,
  detectBlocker,
  extractMemoryFromOutput,
  recordAgentMemory,
  buildQAHandoffPrompt,
  buildGaterReviewPrompt,
} from "@/lib/agent-pipeline";
import { getAgentByAnyId } from "@/config/agents";
import { dbReadTasks, dbWriteTasks, dbJournalTransition, dbCheckpoint } from "@/lib/tasks-db";
import {
  bridgeCodexRunStarted,
  bridgeCodexRunCompleted,
  bridgeCodexRunFailed,
} from "@/lib/orchestration/codex-execution-bridge";
import {
  bridgeAnthropicRunStarted,
  bridgeAnthropicRunCompleted,
  bridgeAnthropicRunFailed,
  bridgeAnthropicStdoutChunk,
  summarizeAnthropicCliOutput,
} from "@/lib/orchestration/anthropic-execution-bridge";
import { dbGetTransitions } from "@/lib/tasks-db";

const DATA_DIR = join(process.cwd(), "data");
const PROJECTS_FILE = join(DATA_DIR, "projects.json");
const BUILD_LOG_FILE = join(DATA_DIR, "build-log.json");
const LOCKS_DIR = join(DATA_DIR, "locks");
const FACTORY_LOCK_FILE = join(LOCKS_DIR, "factory.lock");

mkdirSync(LOCKS_DIR, { recursive: true });

const ACTIVE_BUILD_STATUSES = new Set(["spawning", "running"]);
const PENDING_BUILD_STATUSES = new Set(["queued", "spawning", "running"]);
const REVIEW_TAGS = new Set(["ui", "external", "marketing", "money"]);
const REVIEWER_MODEL = "sonnet";
const VISUAL_REVIEW_TAGS = new Set(["ui", "frontend", "component", "page", "visual", "design", "css", "layout", "task-board"]);
const MAX_REVIEW_FAILURES_BEFORE_ESCALATION = 2;
const MAX_REVIEW_FAILURES_HARD_CAP = 3; // Stop rebuilding entirely after this many failures
const RECONCILE_INTERVAL_MS = 15_000;
const CHECKPOINT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour — periodic WAL snapshot
const STALE_BUILD_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes — if a build is "running" longer than this, mark it failed
const IN_PROGRESS_HEARTBEAT_TIMEOUT_MS = 30 * 60 * 1000; // 30 min — in-progress with no active build triggers escalation
const REVIEW_ALERT_TIMEOUT_MS = 15 * 60 * 1000; // 15 min — review without resolution triggers alert
const MAX_BUILD_RETRIES = 2; // Auto-retry failed builds up to 2 times (3 total attempts)
const BUILD_RETRY_DELAY_MS = 60_000; // 60 seconds between retry attempts
const STALL_ALERT_TIMEOUT_MS = 15 * 60 * 1000; // 15 min — in-progress with no build activity triggers alert
const SERVER_BOOT_MS = Date.now(); // Captures when this module was first loaded — any build started before this is a zombie
const SPAWN_VERIFICATION_DELAY_MS = 750; // Child must remain alive briefly before we report a successful spawn
const BUILDER_SPAWN_TIMEOUT_MS = 10_000;

// ── Task Status State Machine ──────────────────────────────────────────────────
// Single source of truth for all valid task status transitions.
// Enforced by transitionTask(); callers must not set task.status directly.
export const VALID_TASK_TRANSITIONS: Record<string, string[]> = {
  "backlog":     ["to-do"],
  "to-do":     ["in-progress"],
  "in-progress": ["review", "blocked", "in-progress"], // in-progress→in-progress for retries/failures
  "review":      ["done", "in-progress", "blocked"],   // done=Gater approval, in-progress=rejection, blocked=QA cannot verify
  "blocked":     ["in-progress"],
  "done":        [],                                   // terminal — nothing leaves done
};
const MAX_ON_DECK_PER_PROJECT = 5;
const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const PROJECT_DIRS: Record<string, string> = {
  "hiverunner": "projects/hiverunner",
  "hiverunner-orchestration": "projects/hiverunner",
  // Legacy task/project slugs can still exist in local DBs; route them to the
  // current HiveRunner project directory instead of falling back to old clones.
  "mission-control": "projects/hiverunner",
  "mission-control-orchestration": "projects/hiverunner",
  "ops-automation": "projects/ops-automation",
  "product-studio": "projects/product-studio",
  "research-lab": "projects/research-lab",
  "snapaudit": "projects/snapaudit",
  "idea-intake": "projects/idea-intake",
  "infrastructure": "",
  "org": "",
  "karpathy-loop": "projects/karpathy-loop",
};

let lastReconcileAt = 0;
let lastCheckpointAt = 0;
let lastLogSyncAt = 0;
const LOG_SYNC_INTERVAL_MS = 60_000; // sync from tasks-log.md at most once per minute

type BuildExecutorDecision = {
  agentType: "claude-code" | "codex" | "gemini";
  command: "claude" | "codex" | "gemini";
  args: string[];
  actualModelId: string;
  actualModelName: string;
  executor: "claude" | "codex" | "gemini";
  fallbackReason?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readJSON<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

export function readTasks(): any[] {
  return dbReadTasks();
}

export function writeTasks(tasks: any[]) {
  dbWriteTasks(tasks);
}

export function readProjects(): any[] {
  return readJSON(PROJECTS_FILE, [] as any[]);
}

/**
 * Add an automated pipeline comment to a task (in-memory mutation).
 * Call writeTasks() after to persist.
 */
export function addPipelineComment(task: any, text: string, author = "Pipeline", authorEmoji = "⚙️") {
  if (!Array.isArray(task.comments)) {
    task.comments = [];
  }
  task.comments.push({
    id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    author,
    authorEmoji,
    text,
    timestamp: new Date().toISOString(),
    type: "note",
  });
}

/**
 * Apply a task status transition, enforcing the state machine.
 * Returns true if the transition was applied, false if it was rejected.
 *
 * Use force=true ONLY for controlled pipeline overrides (e.g. auto-approve
 * skipping review for low-risk tasks, or the visual-qc done→review reraise).
 * All such force usages are logged as warnings for auditability.
 */
export function transitionTask(
  task: any,
  newStatus: string,
  actor = "pipeline",
  opts?: { force?: boolean; reason?: string }
): boolean {
  const from: string = task.status;
  if (from === newStatus) return true; // no-op self-transition

  const allowed: string[] = VALID_TASK_TRANSITIONS[from] ?? [];
  if (!allowed.includes(newStatus)) {
    if (opts?.force) {
      console.warn(
        `[state-machine] FORCE ${from} → ${newStatus} (task ${task.id}, actor: ${actor})` +
        (opts.reason ? ` — ${opts.reason}` : "")
      );
    } else {
      console.error(
        `[state-machine] BLOCKED ${from} → ${newStatus} (task ${task.id}, actor: ${actor}) — not in valid transitions`
      );
      return false;
    }
  }

  // Guard: tasks cannot enter in_progress without at least one acceptance criterion
  if (newStatus === "in-progress" && from !== "in-progress") {
    if (!opts?.force && (!Array.isArray(task.acceptance_criteria) || task.acceptance_criteria.length === 0)) {
      console.error(
        `[state-machine] BLOCKED ${from} → in-progress (task ${task.id}, actor: ${actor}) — no acceptance_criteria defined`
      );
      return false;
    }
  }

  // Guard: tasks cannot transition review → done without Gater being assigned as reviewer
  // (review is the mandatory gate; Gater assignment proves the QA step was not bypassed)
  if (newStatus === "done" && from === "review" && !opts?.force) {
    if (!task.reviewAssignedTo) {
      console.error(
        `[state-machine] BLOCKED review → done (task ${task.id}, actor: ${actor}) — reviewAssignedTo not set (Gater approval required)`
      );
      return false;
    }
  }

  task.status = newStatus;
  // Journal the transition before writeTasks() persists it.
  // If the server crashes after this line but before writeTasks() completes,
  // tasks-db _replayCheck() will detect the mismatch and re-apply on restart.
  dbJournalTransition(task.id, from, newStatus, actor, opts?.reason);
  return true;
}

/**
 * Auto-assign Gater as reviewer when a task enters "review" status.
 * Mutates the task in-place — caller must persist with writeTasks().
 */
export function autoAssignGater(task: any) {
  const gater = getAgentByAnyId("gater");
  if (!gater) return;
  task.assignee = "Gater";
  task.reviewAssignedTo = gater.id;
  task.reviewAssignedAt = new Date().toISOString();
  addPipelineComment(task, `Auto-assigned to ${gater.name} ${gater.emoji} for QA review`, gater.name, gater.emoji);
  sendSystemEvent(`🚧 Auto-assigned to Gater for review: ${String(task.title || task.id).replace(/"/g, "'")}`);
}

/**
 * Auto-assign the correct builder agent when a task enters "in-progress".
 * Uses resolveAgentForTask() for smart routing.
 * Mutates the task in-place — caller must persist with writeTasks().
 */
export function autoAssignBuilder(task: any) {
  const assignment = resolveAgentForTask(task);
  const agent = getAgentByAnyId(assignment.agentId);
  if (!agent) return assignment;
  task.assignee = agent.name.replace(/\s*[^\w\s].*$/, "").trim() || agent.name; // strip emoji suffix for assignee field
  task.assignedAgent = assignment.agentId;
  task.assignedAgentReason = assignment.reason;
  task.needsQAHandoff = assignment.needsQAHandoff;
  addPipelineComment(task, `Auto-assigned to ${agent.name} ${agent.emoji} — ${assignment.reason}`, agent.name, agent.emoji);
  return assignment;
}

export function readBuildLog(): { builds: any[] } {
  return readJSON(BUILD_LOG_FILE, { builds: [] as any[] });
}

export function writeBuildLog(data: { builds: any[] }) {
  writeFileSync(BUILD_LOG_FILE, JSON.stringify(data, null, 2));
}

function parseFactoryLockFile(raw: string): { holder: string; acquiredAt: string | null; timestampMs: number | null } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { holder: "factory", acquiredAt: null, timestampMs: null };
  }

  try {
    const parsed = JSON.parse(trimmed) as { holder?: string; acquiredAt?: string; timestampMs?: number };
    return {
      holder: parsed.holder || "factory",
      acquiredAt: parsed.acquiredAt || null,
      timestampMs: typeof parsed.timestampMs === "number" ? parsed.timestampMs : parsed.acquiredAt ? new Date(parsed.acquiredAt).getTime() : null,
    };
  } catch {
    const timestampMs = Number(trimmed);
    return {
      holder: "factory",
      acquiredAt: Number.isNaN(timestampMs) ? null : new Date(timestampMs).toISOString(),
      timestampMs: Number.isNaN(timestampMs) ? null : timestampMs,
    };
  }
}

function readFactoryLockState(): { holder: string; acquiredAt: string | null; held: boolean } {
  try {
    const raw = readFileSync(FACTORY_LOCK_FILE, "utf-8");
    const parsed = parseFactoryLockFile(raw);
    return {
      holder: parsed.holder || "factory",
      acquiredAt: parsed.acquiredAt,
      held: true,
    };
  } catch {
    return {
      holder: "none",
      acquiredAt: null,
      held: false,
    };
  }
}

async function withFactoryLock<T>(fn: () => Promise<T> | T, holder = "factory"): Promise<T> {
  const staleMs = 30_000;
  const maxWaitMs = 5_000;
  const started = Date.now();

  while (true) {
    try {
      const now = Date.now();
      writeFileSync(FACTORY_LOCK_FILE, JSON.stringify({
        holder,
        acquiredAt: new Date(now).toISOString(),
        timestampMs: now,
      }), { flag: "wx" });
      break;
    } catch {
      try {
        const existing = parseFactoryLockFile(readFileSync(FACTORY_LOCK_FILE, "utf-8"));
        if (existing.timestampMs !== null && Date.now() - existing.timestampMs > staleMs) {
          unlinkSync(FACTORY_LOCK_FILE);
          continue;
        }
      } catch {
        try { unlinkSync(FACTORY_LOCK_FILE); } catch {}
        continue;
      }

      if (Date.now() - started > maxWaitMs) {
        throw new Error("Factory scheduler lock timeout");
      }
      await sleep(50);
    }
  }

  try {
    return await fn();
  } finally {
    try { unlinkSync(FACTORY_LOCK_FILE); } catch {}
  }
}

function getProjectMeta(task: any, projects = readProjects()) {
  const project = projects.find((p: any) => p.id === task.project);
  const projectName = project?.name || task.project || "Unscoped";
  const executionKey = project?.repo?.trim() || `project:${task.project || "unscoped"}`;
  const relProjectDir = PROJECT_DIRS[task.project] ?? "";
  const appRoot = resolveHiveRunnerAppRoot();
  const cwd = process.cwd();
  const workspaceRoots = Array.from(new Set([
    process.env.WORKSPACE_ROOT,
    appRoot,
    cwd,
    join(cwd, ".."),
    join(cwd, "..", ".."),
  ].filter((value): value is string => Boolean(value))));

  const hiveRunnerAppCandidates = new Set([
    "hiverunner",
    "hiverunner-orchestration",
    "mission-control",
    "mission-control-orchestration",
  ]);

  const projectDir = relProjectDir
    ? hiveRunnerAppCandidates.has(String(task.project || ""))
      ? join(appRoot, relProjectDir)
      : workspaceRoots
          .map((root) => join(root, relProjectDir))
          .find((candidate) => existsSync(candidate)) || join(workspaceRoots[0] || cwd, relProjectDir)
    : workspaceRoots.find((root) => existsSync(root)) || cwd;

  return { project, projectName, executionKey, projectDir };
}

function buildPrompt(task: any, projectName: string, executorLabel: string) {
  // Resolve named agent for this task
  const assignment = resolveAgentForTask(task);
  const agent = getAgentByAnyId(assignment.agentId);
  const agentDisplay = agent ? `${agent.name} · ${agent.role}` : assignment.agentId;
  const agentIdentity = buildAgentIdentityBlock(assignment.agentId, task.project);

  return [
    `## Task: ${task.title}`,
    "",
    `**Project:** ${projectName}`,
    `**Type:** ${task.type || "feature"}`,
    `**Priority:** ${task.priority}`,
    `**Executor:** ${executorLabel}`,
    `**Assigned Agent:** ${agentDisplay}`,
    "",
    agentIdentity ? `${agentIdentity}\n` : "",
    "### Description",
    task.description || task.title,
    "",
    ...(Array.isArray(task.acceptance_criteria) && task.acceptance_criteria.length > 0
      ? [
          "### Acceptance Criteria",
          "Your implementation MUST satisfy ALL of the following before marking done:",
          ...task.acceptance_criteria.map((c: string) => `- ${c}`),
          "",
        ]
      : []),
    "### Requirements",
    "- Make the necessary code changes to complete this task",
    "- Run the build in a temp copy to avoid crashing the dev server: `cp -r . /tmp/hiverunner-build-check && cd /tmp/hiverunner-build-check && npm run build 2>&1 | tail -80 && cd - && rm -rf /tmp/hiverunner-build-check`",
    "- Run tests if they exist",
    "- Commit with a clear message describing what was built",
    "- Push to the remote repository",
    "- Keep the implementation focused on the scoped task; do not rewrite unrelated areas",
    "- When finished, end with a concise summary of what changed, validation run, and any remaining caveats",
    "- If you CANNOT complete or verify the task, write `BLOCKED: <reason>` — do NOT mark as done",
  ].join("\n");
}

const CLAUDE_MODEL_MAP: Record<string, { id: string; name: string }> = {
  opus: { id: "anthropic/claude-opus-4-6", name: "Opus 4.6" },
  haiku: { id: "anthropic/claude-haiku-3-5", name: "Haiku 3.5" },
  sonnet: { id: "anthropic/claude-sonnet-4-6", name: "Sonnet 4.6" },
};

const GEMINI_MODEL_MAP: Record<string, { id: string; name: string; modelFlag?: string }> = {
  "gemini-flash": { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  "gemini-pro": { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", modelFlag: "gemini-2.5-pro" },
};

const CLI_AVAILABLE_CACHE = new Map<string, boolean>();

function isCliAvailable(cmd: string): boolean {
  if (CLI_AVAILABLE_CACHE.has(cmd)) return CLI_AVAILABLE_CACHE.get(cmd)!;
  try {
    execFileSync("which", [cmd], {
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}` },
      stdio: "pipe",
    });
    CLI_AVAILABLE_CACHE.set(cmd, true);
    return true;
  } catch {
    CLI_AVAILABLE_CACHE.set(cmd, false);
    return false;
  }
}

function selectBuildExecutor(routing: any, task: any, projectName: string): BuildExecutorDecision {
  const tier: string = routing?.tier || "sonnet";

  // Gemini tiers → Gemini CLI (research / large-context tasks)
  if (tier === "gemini-flash" || tier === "gemini-pro") {
    const geminiMeta = GEMINI_MODEL_MAP[tier];
    if (isCliAvailable("gemini")) {
      const executorLabel = `Gemini CLI · ${geminiMeta.name}`;
      const prompt = buildPrompt(task, projectName, executorLabel);
      const args = geminiMeta.modelFlag
        ? ["--model", geminiMeta.modelFlag, prompt]
        : [prompt];
      return {
        agentType: "gemini",
        command: "gemini",
        args,
        actualModelId: geminiMeta.id,
        actualModelName: geminiMeta.name,
        executor: "gemini",
      };
    }
    // Graceful fallback to Claude when gemini CLI is not installed
    const fallbackModelKey = tier === "gemini-pro" ? "opus" : "sonnet";
    const fallbackModel = CLAUDE_MODEL_MAP[fallbackModelKey];
    const executorLabel = `Claude Code · ${fallbackModel.name}`;
    const prompt = buildPrompt(task, projectName, executorLabel);
    return {
      agentType: "claude-code",
      command: "claude",
      args: [
        "--permission-mode",
        "bypassPermissions",
        "--model",
        fallbackModelKey,
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        prompt,
      ],
      actualModelId: fallbackModel.id,
      actualModelName: fallbackModel.name,
      executor: "claude",
      fallbackReason: `Router preferred ${geminiMeta.name} — falling back to ${fallbackModel.name} (gemini CLI not found on PATH)`,
    };
  }

  // GPT tier → Codex CLI (exec --full-auto)
  if (tier === "gpt" || tier === "gpt-5.4") {
    if (isCliAvailable("codex")) {
      const prompt = buildPrompt(task, projectName, "Codex · GPT-5.4");
      return {
        agentType: "codex",
        command: "codex",
        args: ["exec", "--full-auto", prompt],
        actualModelId: "openai/gpt-5.4",
        actualModelName: "GPT-5.4",
        executor: "codex",
      };
    }
    // Graceful fallback to Claude Sonnet when codex CLI is not installed
    const fallbackModel = CLAUDE_MODEL_MAP["sonnet"];
    const executorLabel = `Claude Code · ${fallbackModel.name}`;
    const prompt = buildPrompt(task, projectName, executorLabel);
    return {
      agentType: "claude-code",
      command: "claude",
      args: [
        "--permission-mode",
        "bypassPermissions",
        "--model",
        "sonnet",
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        prompt,
      ],
      actualModelId: fallbackModel.id,
      actualModelName: fallbackModel.name,
      executor: "claude",
      fallbackReason: "Router preferred GPT — falling back to Sonnet (codex CLI not found on PATH)",
    };
  }

  // Claude tiers (opus / sonnet / haiku)
  const claudeModelKey = tier === "opus" ? "opus" : tier === "haiku" ? "haiku" : "sonnet";
  const model = CLAUDE_MODEL_MAP[claudeModelKey];
  const executorLabel = `Claude Code · ${model.name}`;
  const prompt = buildPrompt(task, projectName, executorLabel);
  return {
    agentType: "claude-code",
    command: "claude",
    args: [
      "--permission-mode",
      "bypassPermissions",
      "--model",
      claudeModelKey,
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      prompt,
    ],
    actualModelId: model.id,
    actualModelName: model.name,
    executor: "claude",
  };
}

function hasAnyTag(task: any, tags: Set<string>) {
  return Array.isArray(task.tags) && task.tags.some((tag: string) => tags.has(String(tag).toLowerCase()));
}

function shouldRequireReview(task: any) {
  // ALL tasks require review. Nothing ships without Gater's sign-off.
  // Previously this was tag-gated (only ui/external/marketing/money)
  // but that let architecture/testing/pipeline tasks skip QA entirely.
  return true;
}

function shouldRequireVisualReview(task: any) {
  return hasAnyTag(task, VISUAL_REVIEW_TAGS);
}

/** Capture a screenshot and store it in the task's visualReview.captures array.
 * If allBrowsers=true, captures in both Chromium and WebKit (Safari) for cross-browser QA. */
async function captureAndStoreScreenshot(taskId: string, task: any, phase: "before" | "after", allBrowsers = false): Promise<any[]> {
  try {
    const { captureScreenshot, captureScreenshotAllBrowsers, validateCapture } = await import("@/lib/visual-qa");

    const targetUrl =
      task.visualReview?.targetUrl ||
      (task.visualReview?.targetPath
        ? `http://localhost:3001${task.visualReview.targetPath}`
        : "http://localhost:3001/");

    const rawCaptures = allBrowsers
      ? await captureScreenshotAllBrowsers(targetUrl, taskId)
      : [await captureScreenshot(targetUrl, taskId)];

    const now = new Date().toISOString();
    const tasks = readTasks();
    const freshTask = tasks.find((t: any) => t.id === taskId);
    if (!freshTask) return [];

    const existingReview = freshTask.visualReview || {};
    const existingCaptures = Array.isArray(existingReview.captures) ? existingReview.captures : [];

    const newEntries = rawCaptures.map((capture, i) => ({
      id: `cap-${Date.now()}-${i}`,
      relativePath: capture.relativePath,
      filePath: capture.filePath,
      url: capture.url,
      capturedAt: capture.timestamp,
      viewport: capture.viewport,
      valid: validateCapture(capture.filePath),
      phase,
    }));

    const updatedCaptures = [...existingCaptures, ...newEntries];
    freshTask.visualReview = {
      ...existingReview,
      required: true,
      status: phase === "after" ? "captured" : existingReview.status || "pending-capture",
      lastCapturedAt: now,
      lastUpdatedAt: now,
      captures: updatedCaptures,
    };
    freshTask.updated = now;
    writeTasks(tasks);

    console.log(`[factory] Visual QA ${phase}-screenshot(s) captured for ${taskId}: ${newEntries.map(e => e.relativePath).join(", ")} (allBrowsers=${allBrowsers})`);
    return updatedCaptures;
  } catch (err) {
    console.error(`[factory] Visual QA ${phase}-capture error for ${taskId}:`, err);
    return [];
  }
}

/** Fire-and-forget visual QA capture after a successful build on a UI task (legacy compat) */
async function triggerVisualQA(taskId: string, task: any) {
  await captureAndStoreScreenshot(taskId, task, "after");
}

/** Spawn a visual QA review agent that analyzes screenshots + code diff for UI correctness */
function spawnVisualQAProcess(
  task: any,
  visualQAEntry: any,
  projectName: string,
  projectDir: string,
  buildOutput: string,
  captures: any[],
) {
  // Build the visual QA prompt dynamically
  import("@/lib/visual-qa").then(({ visualQAReviewPrompt }) => {
    const prompt = visualQAReviewPrompt(task, projectName, buildOutput, captures);
    const args = ["--permission-mode", "bypassPermissions", "--model", REVIEWER_MODEL, "--print", prompt];

    sendSystemEvent(`👁️ Visual QA reviewer spawning for: ${String(task.title || task.id).replace(/"/g, "'")}`);

    const reviewEnv = {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
    };

    const child = execFile(
      "claude",
      args,
      { cwd: projectDir, maxBuffer: 10 * 1024 * 1024, env: reviewEnv },
      (error, stdout, stderr) => {
        const output = summarizeOutput(error, stdout, stderr);
        finalizeVisualQA(visualQAEntry.id, task.id, !error, output).catch((err) => {
          console.error("Error finalizing visual QA:", err);
        });
      },
    );

    child.on("spawn", () => {
      withFactoryLock(async () => {
        const buildLog = readBuildLog();
        const entry = buildLog.builds.find((b: any) => b.id === visualQAEntry.id);
        if (entry && entry.status === "spawning") {
          entry.status = "running";
          entry.runningAt = new Date().toISOString();
          writeBuildLog(buildLog);
        }
        const tasks = readTasks();
        const t = tasks.find((t: any) => t.id === task.id);
        if (t) {
          t.visualReview = { ...(t.visualReview || {}), status: "reviewing" };
          t.updated = new Date().toISOString();
          writeTasks(tasks);
        }
      }).catch(() => {});
    });

    child.on("error", (err) => {
      finalizeVisualQA(visualQAEntry.id, task.id, false, err.message).catch((finalizeErr) => {
        console.error("Error finalizing failed visual QA spawn:", finalizeErr);
      });
    });
  }).catch((err) => {
    console.error("[factory] Failed to load visual-qa module for review:", err);
    // If we can't load the module, skip visual QA and proceed to code review
    finalizeVisualQA(visualQAEntry.id, task.id, false, "Failed to load visual QA module").catch(() => {});
  });
}

/** Handle visual QA review completion — approved → spawn code review, needs_fix → send back to builder */
async function finalizeVisualQA(visualQABuildId: string, taskId: string, success: boolean, output: string) {
  let codeReviewSpawnData: {
    task: any; reviewEntry: any; projectName: string; projectDir: string; buildOutput: string;
  } | null = null;
  let requeue = false;
  let notifyText = "";

  await withFactoryLock(async () => {
    const buildLog = readBuildLog();
    const tasks = readTasks();
    const projects = readProjects();
    const visualQAEntry = buildLog.builds.find((b: any) => b.id === visualQABuildId);
    const task = tasks.find((t: any) => t.id === taskId);

    if (!visualQAEntry || !task) return;

    const now = new Date().toISOString();
    visualQAEntry.completedAt = now;
    visualQAEntry.output = output.slice(-1500);

    if (!success) {
      // Visual QA process itself failed — don't block the pipeline, proceed to code review
      visualQAEntry.status = "failed";
      console.warn(`[factory] Visual QA process failed for ${taskId}, proceeding to code review`);
    } else {
      visualQAEntry.status = "completed";
      const { verdict, notes } = parseReviewVerdict(output);

      if (verdict === "NEEDS_FIX") {
        // GUARD: never resurrect a done task via review rejection
        if (task.status === "done") {
          console.log(`[factory] Visual QA NEEDS_FIX but task ${taskId} is done — skipping rejection`);
          writeBuildLog(buildLog);
          writeTasks(tasks);
          return;
        }
        // Visual QA found issues — send back to builder
        task.visualReview = {
          ...(task.visualReview || {}),
          status: "changes-requested",
          lastUpdatedAt: now,
          lastVerdict: "NEEDS_FIX",
          lastNotes: notes,
        };
        transitionTask(task, "in-progress", "visual-qa");
        task.buildState = "failed";
        task.buildError = `Visual QA failed:\n${notes}`;
        task.lastReviewVerdict = "NEEDS_FIX";
        task.lastReviewerAgent = "Visual QA (Sonnet)";
        task.lastReviewNotes = notes;
        task.lastReviewAt = now;
        const failureCount = (task.reviewFailureCount || 0) + 1;
        task.reviewFailureCount = failureCount;
        delete task.completedAt;

        // Hard cap: stop rebuilding after too many failures to prevent infinite loops
        if (failureCount > MAX_REVIEW_FAILURES_HARD_CAP) {
          requeue = false;
          transitionTask(task, "review", "visual-qa");
          task.buildState = "completed";
          task.escalatedToLead = true;
          task.escalatedAt = now;
          task.escalationReason = `HARD STOP: Visual QA failed ${failureCount}x — exceeded max retries. Needs manual intervention.`;
          notifyText = `🛑 HARD STOP: Visual QA loop killed after ${failureCount} failures: ${String(task.title || taskId).replace(/"/g, "'")}`;
          sendTelegramNotification(`🛑 HARD STOP: "${String(task.title || taskId).replace(/"/g, "'")}" killed after ${failureCount} Visual QA failures. Manual fix needed.`);
        } else if (failureCount >= MAX_REVIEW_FAILURES_BEFORE_ESCALATION) {
          requeue = true;
          task.escalatedToLead = true;
          task.escalatedAt = now;
          task.escalationReason = `Visual QA failed ${failureCount} times. Latest issues: ${notes.slice(0, 300)}`;
          notifyText = `🚨 VISUAL QA ESCALATION: Task failed visual review ${failureCount}x: ${String(task.title || taskId).replace(/"/g, "'")}`;
          sendTelegramNotification(`🚨 VISUAL QA ESCALATION: "${String(task.title || taskId).replace(/"/g, "'")}" has failed visual QA ${failureCount} times.\n\nIssues:\n${notes.slice(0, 500)}`);
          createInAppNotification(
            "⚠️ Visual QA Escalation",
            `"${String(task.title || taskId).replace(/"/g, "'")}" failed visual QA ${failureCount}x`,
            "warning",
            "/tasks",
          );
        } else {
          requeue = true;
          notifyText = `🔄 Visual QA NEEDS FIX (attempt ${failureCount}/${MAX_REVIEW_FAILURES_BEFORE_ESCALATION}): ${String(task.title || taskId).replace(/"/g, "'")}`;
        }

        task.updated = now;
        writeBuildLog(buildLog);
        writeTasks(tasks);
        return;
      }

      // APPROVED — update visual review status
      task.visualReview = {
        ...(task.visualReview || {}),
        status: "approved",
        lastUpdatedAt: now,
        lastVerdict: "APPROVED",
      };
    }

    // Visual QA passed (or process failed, so we skip) — proceed to code review
    const buildOutput = task.buildOutput || "";
    const { projectName, projectDir } = getProjectMeta(task, projects);

    const reviewEntry = {
      id: `review-${Date.now()}`,
      taskId: task.id,
      taskTitle: task.title,
      project: task.project,
      executionKey: `${visualQAEntry.originalExecutionKey || visualQAEntry.executionKey}:review`,
      originalExecutionKey: visualQAEntry.originalExecutionKey || visualQAEntry.executionKey,
      status: "spawning",
      queuedAt: null,
      startedAt: now,
      completedAt: null,
      agentType: "reviewer",
      workDir: visualQAEntry.workDir,
      source: "auto-review-post-visual-qa",
      routing: {
        tier: "sonnet",
        modelId: "anthropic/claude-sonnet-4-6",
        modelName: "Sonnet 4.6",
        reason: "Auto code review after visual QA pass",
      },
    };
    buildLog.builds.unshift(reviewEntry);
    task.codeReviewState = "pending";
    task.updated = now;

    codeReviewSpawnData = {
      task: { ...task },
      reviewEntry,
      projectName,
      projectDir,
      buildOutput,
    };

    notifyText = `👁️ Visual QA passed → code review spawning: ${String(task.title || taskId).replace(/"/g, "'")}`;

    writeBuildLog(buildLog);
    writeTasks(tasks);
  });

  if (notifyText) sendSystemEvent(notifyText);

  if (requeue) {
    queueOrStartBuild(taskId, { source: `visual-qa-needs-fix:${visualQABuildId}` }).catch((err) => {
      console.error("Failed to re-queue task after visual QA failure:", err);
    });
    return;
  }

  if (codeReviewSpawnData) {
    const { task, reviewEntry, projectName, projectDir, buildOutput } = codeReviewSpawnData;
    spawnReviewProcess(task, reviewEntry, projectName, projectDir, buildOutput);
  }
}

/** Spawn the Vigil QA agent for builder → QA handoff */
function spawnVigilQAProcess(
  task: any,
  qaEntry: any,
  projectName: string,
  projectDir: string,
  buildOutput: string,
  builderAgentId: string,
  captures: any[],
) {
  const prompt = buildQAHandoffPrompt(task, projectName, builderAgentId, buildOutput, captures);
  const args = ["--permission-mode", "bypassPermissions", "--model", REVIEWER_MODEL, "--print", prompt];

  sendSystemEvent(`🛡️ Vigil QA spawning for: ${String(task.title || task.id).replace(/"/g, "'")} (builder: ${builderAgentId})`);

  const qaEnv = {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
  };

  const child = execFile(
    "claude",
    args,
    { cwd: projectDir, maxBuffer: 10 * 1024 * 1024, env: qaEnv },
    (error, stdout, stderr) => {
      const output = summarizeOutput(error, stdout, stderr);
      finalizeVigilQA(qaEntry.id, task.id, !error, output, builderAgentId).catch((err) => {
        console.error("Error finalizing Vigil QA:", err);
      });
    },
  );

  child.on("spawn", () => {
    withFactoryLock(async () => {
      const buildLog = readBuildLog();
      const entry = buildLog.builds.find((b: any) => b.id === qaEntry.id);
      if (entry && entry.status === "spawning") {
        entry.status = "running";
        entry.runningAt = new Date().toISOString();
        writeBuildLog(buildLog);
      }
      const tasks = readTasks();
      const t = tasks.find((t: any) => t.id === task.id);
      if (t) {
        t.codeReviewState = "vigil-reviewing";
        t.updated = new Date().toISOString();
        writeTasks(tasks);
      }
    }).catch(() => {});
  });

  child.on("error", (err) => {
    finalizeVigilQA(qaEntry.id, task.id, false, err.message, builderAgentId).catch((finalizeErr) => {
      console.error("Error finalizing failed Vigil QA spawn:", finalizeErr);
    });
  });
}

/** Handle Vigil QA completion — approved → code review, rejected → back to builder, blocked → surface */
async function finalizeVigilQA(
  vigilBuildId: string,
  taskId: string,
  success: boolean,
  output: string,
  builderAgentId: string,
) {
  let codeReviewSpawnData: {
    task: any; reviewEntry: any; projectName: string; projectDir: string; buildOutput: string;
  } | null = null;
  let requeue = false;
  let notifyText = "";

  await withFactoryLock(async () => {
    const buildLog = readBuildLog();
    const tasks = readTasks();
    const projects = readProjects();
    const vigilEntry = buildLog.builds.find((b: any) => b.id === vigilBuildId);
    const task = tasks.find((t: any) => t.id === taskId);

    if (!vigilEntry || !task) return;

    const now = new Date().toISOString();
    vigilEntry.completedAt = now;
    vigilEntry.output = output.slice(-1500);

    if (!success) {
      // Vigil process itself failed — proceed to code review
      vigilEntry.status = "failed";
      console.warn(`[factory] Vigil QA process failed for ${taskId}, proceeding to code review`);
    } else {
      vigilEntry.status = "completed";
      const { verdict, notes } = parseReviewVerdict(output);

      // Check for BLOCKED verdict from Vigil
      if (/VERDICT:\s*BLOCKED/i.test(output)) {
        const blockerMatch = output.match(/BLOCKED:\s*(.+?)(?:\n|$)/i);
        const blockerReason = blockerMatch ? blockerMatch[1].trim() : "Vigil cannot verify this task";

        transitionTask(task, "blocked", "vigil-qa");
        task.buildState = "blocked";
        task.blocker = {
          reason: blockerReason,
          category: "cannot-verify" as const,
          raisedAt: now,
          raisedBy: "vigil",
          notifiedLead: true,
          resolved: false,
        };
        task.qaHandoff = {
          ...(task.qaHandoff || {}),
          verdict: "blocked",
          completedAt: now,
        };

        notifyText = `🚫 Vigil BLOCKED: ${String(task.title || taskId).replace(/"/g, "'")} — ${blockerReason.slice(0, 200)}`;
        sendTelegramNotification(
          `🚫 VIGIL BLOCKED: "${String(task.title || taskId).replace(/"/g, "'")}" — ${blockerReason.slice(0, 300)}\n\nVigil cannot verify. Needs operator triage.`
        );
        createInAppNotification(
          "🚫 Vigil QA Blocked",
          `Vigil blocked on "${String(task.title || taskId).replace(/"/g, "'")}" — cannot verify`,
          "warning",
          "/tasks",
        );

        task.updated = now;
        writeBuildLog(buildLog);
        writeTasks(tasks);
        return;
      }

      if (verdict === "NEEDS_FIX") {
        // GUARD: never resurrect a done task via Vigil rejection
        if (task.status === "done") {
          console.log(`[factory] Vigil NEEDS_FIX but task ${taskId} is done — skipping rejection`);
          writeBuildLog(buildLog);
          writeTasks(tasks);
          return;
        }
        // Vigil rejected — send back to builder agent
        task.visualReview = {
          ...(task.visualReview || {}),
          status: "changes-requested",
          lastUpdatedAt: now,
          lastVerdict: "NEEDS_FIX",
          lastNotes: notes,
        };
        transitionTask(task, "in-progress", "vigil-qa");
        task.buildState = "failed";
        task.buildError = `Vigil QA rejected (sent back to ${builderAgentId}):\n${notes}`;
        task.lastReviewVerdict = "NEEDS_FIX";
        task.lastReviewerAgent = "Vigil (QA)";
        task.lastReviewNotes = notes;
        task.lastReviewAt = now;
        task.qaHandoff = {
          ...(task.qaHandoff || {}),
          verdict: "rejected",
          rejectionNotes: notes,
          completedAt: now,
        };
        const failureCount = (task.reviewFailureCount || 0) + 1;
        task.reviewFailureCount = failureCount;
        delete task.completedAt;

        // Add rejection comment + re-assign to original builder
        const builderAgent = getAgentByAnyId(builderAgentId);
        addPipelineComment(task, `Vigil QA rejected (attempt ${failureCount}) — reassigned to ${builderAgent?.name || builderAgentId} for fixes:\n${notes.slice(0, 300)}`, "Vigil 🛡️", "🛡️");
        if (builderAgent) {
          task.assignee = builderAgent.name.replace(/\s*[^\w\s].*$/, "").trim() || builderAgent.name;
        }

        // Hard cap: stop rebuilding after too many failures to prevent infinite loops
        if (failureCount > MAX_REVIEW_FAILURES_HARD_CAP) {
          requeue = false;
          transitionTask(task, "review", "vigil-qa");
          task.buildState = "completed";
          task.escalatedToLead = true;
          task.escalatedAt = now;
          task.escalationReason = `HARD STOP: Vigil QA rejected ${failureCount}x — exceeded max retries. Needs manual intervention.`;
          notifyText = `🛑 HARD STOP: Vigil loop killed after ${failureCount} rejections: ${String(task.title || taskId).replace(/"/g, "'")}`;
          sendTelegramNotification(`🛑 HARD STOP: "${String(task.title || taskId).replace(/"/g, "'")}" killed after ${failureCount} Vigil rejections. Manual fix needed.`);
        } else if (failureCount >= MAX_REVIEW_FAILURES_BEFORE_ESCALATION) {
          requeue = true;
          task.escalatedToLead = true;
          task.escalatedAt = now;
          task.escalationReason = `Vigil QA rejected ${failureCount} times. Latest: ${notes.slice(0, 300)}`;
          notifyText = `🚨 VIGIL ESCALATION: Task rejected ${failureCount}x: ${String(task.title || taskId).replace(/"/g, "'")}`;
          sendTelegramNotification(`🚨 VIGIL ESCALATION: "${String(task.title || taskId).replace(/"/g, "'")}" rejected ${failureCount}x by Vigil.\n\nIssues:\n${notes.slice(0, 500)}`);
          createInAppNotification(
            "⚠️ Vigil QA Escalation",
            `"${String(task.title || taskId).replace(/"/g, "'")}" rejected ${failureCount}x by Vigil`,
            "warning",
            "/tasks",
          );
        } else {
          requeue = true;
          notifyText = `🔄 Vigil QA REJECTED → back to ${builderAgentId} (attempt ${failureCount}/${MAX_REVIEW_FAILURES_BEFORE_ESCALATION}): ${String(task.title || taskId).replace(/"/g, "'")}`;
        }

        task.updated = now;
        writeBuildLog(buildLog);
        writeTasks(tasks);
        return;
      }

      // APPROVED — Vigil says it's good, update QA handoff
      task.visualReview = {
        ...(task.visualReview || {}),
        status: "approved",
        lastUpdatedAt: now,
        lastVerdict: "APPROVED",
      };
      task.qaHandoff = {
        ...(task.qaHandoff || {}),
        verdict: "approved",
        completedAt: now,
      };
    }

    // Vigil approved (or process failed → skip to code review)
    const buildOutput = task.buildOutput || "";
    const { projectName, projectDir } = getProjectMeta(task, projects);

    task.codeReviewState = "pending";
    task.codeReviewStartedAt = now;

    const reviewEntry = {
      id: `review-${Date.now()}`,
      taskId: task.id,
      taskTitle: task.title,
      project: task.project,
      executionKey: `${vigilEntry.originalExecutionKey || vigilEntry.executionKey}:review`,
      originalExecutionKey: vigilEntry.originalExecutionKey || vigilEntry.executionKey,
      status: "spawning",
      queuedAt: null,
      startedAt: now,
      completedAt: null,
      agentType: "reviewer",
      workDir: vigilEntry.workDir,
      source: "auto-review-post-vigil-qa",
      routing: {
        tier: "sonnet",
        modelId: "anthropic/claude-sonnet-4-6",
        modelName: "Sonnet 4.6",
        reason: "Code review after Vigil QA approval",
      },
    };
    buildLog.builds.unshift(reviewEntry);

    codeReviewSpawnData = {
      task: { ...task },
      reviewEntry,
      projectName,
      projectDir,
      buildOutput,
    };

    notifyText = `✅ Vigil QA approved → code review: ${String(task.title || taskId).replace(/"/g, "'")}`;

    task.updated = now;
    writeBuildLog(buildLog);
    writeTasks(tasks);
  });

  if (notifyText) sendSystemEvent(notifyText);

  // Record Vigil's memory
  try {
    const { summary, lessons, knownIssues } = extractMemoryFromOutput(output);
    recordAgentMemory("vigil", {
      taskId,
      taskTitle: `QA review: ${taskId}`,
      project: "qa",
      summary: `QA reviewed task from ${builderAgentId}. ${summary}`,
      lessons,
      knownIssues,
    });
  } catch (err) {
    console.error("[factory] Failed to record Vigil memory:", err);
  }

  if (requeue) {
    queueOrStartBuild(taskId, { source: `vigil-rejected:${vigilBuildId}` }).catch((err) => {
      console.error("Failed to re-queue task after Vigil rejection:", err);
    });
    return;
  }

  // Spawn code review after Vigil approval
  if (codeReviewSpawnData) {
    const { task, reviewEntry, projectName, projectDir, buildOutput } = codeReviewSpawnData;
    spawnReviewProcess(task, reviewEntry, projectName, projectDir, buildOutput);
  }
}

function findPendingEntryForTask(buildLog: { builds: any[] }, taskId: string) {
  return buildLog.builds.find((b: any) => b.taskId === taskId && PENDING_BUILD_STATUSES.has(b.status));
}

const MAX_CONCURRENT_BUILDS_PER_KEY = 3;

function findActiveEntryForExecutionKey(buildLog: { builds: any[] }, executionKey: string) {
  const activeBuilds = buildLog.builds.filter((b: any) => b.executionKey === executionKey && ACTIVE_BUILD_STATUSES.has(b.status));
  // Allow up to MAX_CONCURRENT_BUILDS_PER_KEY concurrent builds per execution key
  return activeBuilds.length >= MAX_CONCURRENT_BUILDS_PER_KEY ? activeBuilds[0] : undefined;
}

function nextQueuedTaskId(buildLog: { builds: any[] }, executionKey: string) {
  const queued = buildLog.builds
    .filter((b: any) => b.executionKey === executionKey && b.status === "queued")
    .sort((a: any, b: any) => new Date(a.queuedAt || a.startedAt || 0).getTime() - new Date(b.queuedAt || b.startedAt || 0).getTime());
  return queued[0]?.taskId || null;
}

/**
 * Check if a named agent already has an active (spawning/running) build.
 * Returns the active build entry if found, undefined otherwise.
 */
function findActiveBuildForAgent(buildLog: { builds: any[] }, agentId: string) {
  if (!agentId) return undefined;
  return buildLog.builds.find((b: any) => b.assignedAgent === agentId && ACTIVE_BUILD_STATUSES.has(b.status));
}

/**
 * Find the next queued build for a specific agent (across all execution keys).
 * Returns the taskId of the oldest queued build for that agent.
 */
function nextQueuedTaskIdForAgent(buildLog: { builds: any[] }, agentId: string) {
  if (!agentId) return null;
  const queued = buildLog.builds
    .filter((b: any) => b.assignedAgent === agentId && b.status === "queued")
    .sort((a: any, b: any) => new Date(a.queuedAt || a.startedAt || 0).getTime() - new Date(b.queuedAt || b.startedAt || 0).getTime());
  return queued[0]?.taskId || null;
}

function summarizeOutput(error: Error | null, stdout: string, stderr: string) {
  const anthropicSummary = summarizeAnthropicCliOutput(
    stdout,
    stderr,
    error ? error.message : "Build completed successfully",
  );
  const raw = anthropicSummary
    ?? (error ? `${stderr || stdout || error.message}` : `${stdout || stderr || "Build completed successfully"}`);
  return raw.slice(-1500);
}

function isBuilderEntry(entry: any) {
  return entry?.agentType === "codex" || entry?.agentType === "claude-code" || entry?.agentType === "gemini";
}

function isProcessAlive(pid?: number | null) {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    try {
      const stat = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (!stat) return false;
      return !stat.startsWith("Z");
    } catch {
      // Fall back to kill(0) semantics if ps is unavailable in the runtime.
      return true;
    }
  } catch (error: any) {
    return error?.code === "EPERM";
  }
}

function getBuildAgeMs(entry: any) {
  const timestamp = entry?.runningAt || entry?.startedAt || entry?.queuedAt;
  if (!timestamp) return Number.POSITIVE_INFINITY;
  const startedMs = new Date(timestamp).getTime();
  if (!Number.isFinite(startedMs) || startedMs <= 0) return Number.POSITIVE_INFINITY;
  return Date.now() - startedMs;
}

function hasMissingBuilderProcess(entry: any) {
  if (!isBuilderEntry(entry) || !ACTIVE_BUILD_STATUSES.has(entry?.status)) return false;
  if (typeof entry?.pid === "number" && Number.isFinite(entry.pid)) {
    return !isProcessAlive(entry.pid);
  }
  return getBuildAgeMs(entry) > BUILDER_SPAWN_TIMEOUT_MS;
}

async function verifySpawnedProcess(pid?: number | null, delayMs = SPAWN_VERIFICATION_DELAY_MS) {
  if (delayMs > 0) {
    await sleep(delayMs);
  }
  return isProcessAlive(pid);
}

function readCurrentBuildTaskSnapshot(buildId: string, taskId: string) {
  const buildLog = readBuildLog();
  const tasks = readTasks();
  return {
    build: buildLog.builds.find((entry: any) => entry.id === buildId) || null,
    task: tasks.find((entry: any) => entry.id === taskId) || null,
  };
}

function buildSpawnStartupError(
  command: string,
  pid: number | null,
  details?: {
    reason?: string;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    output?: string | null;
  }
) {
  const parts = [details?.reason || `Builder process exited before startup verification (${command})`];

  if (typeof pid === "number" && Number.isFinite(pid)) {
    parts.push(`pid=${pid}`);
  }
  if (typeof details?.exitCode === "number") {
    parts.push(`exit=${details.exitCode}`);
  }
  if (details?.signal) {
    parts.push(`signal=${details.signal}`);
  }

  const outputSnippet = String(details?.output || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  if (outputSnippet) {
    parts.push(outputSnippet);
  }

  return parts.join(" | ");
}

const SPAWN_ENV = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
};

function sendSystemEvent(text: string) {
  execFile("openclaw", ["system", "event", "--text", text, "--mode", "now"], { env: SPAWN_ENV }, () => {});
}

const NOTIFICATIONS_FILE = join(DATA_DIR, "notifications.json");

function getTelegramNotifyTarget(): string | null {
  try {
    const configPath = join(os.homedir(), ".openclaw", "openclaw.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const tg = config?.channels?.telegram;
    if (!tg?.enabled) return null;
    return tg.notifyTarget || tg.ownerChatId || null;
  } catch {
    return null;
  }
}

function sendTelegramNotification(text: string) {
  const target = getTelegramNotifyTarget();
  if (target) {
    execFile("openclaw", [
      "message", "send",
      "--channel", "telegram",
      "--target", target,
      "--message", text,
    ], () => {});
  }
  // System events route through the gateway which also delivers to Telegram DMs
  sendSystemEvent(text);
}

function createInAppNotification(title: string, message: string, type: "info" | "success" | "warning" | "error", link?: string) {
  try {
    let notifications: any[] = [];
    try {
      notifications = JSON.parse(readFileSync(NOTIFICATIONS_FILE, "utf-8"));
    } catch {}
    notifications.unshift({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      title,
      message: message.slice(0, 200),
      type,
      read: false,
      link: link || "/tasks",
    });
    if (notifications.length > 100) notifications.splice(100);
    writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notifications, null, 2));
  } catch (err) {
    console.error("[build-queue] Failed to write in-app notification:", err);
  }
}

function extractBuildSummary(task: any): string {
  const output = task.buildOutput || "";
  if (!output) return "";

  // Try to find a commit message as the best summary source
  const commitMatch = output.match(/(?:^|\n)\s*(?:feat|fix|refactor|chore|docs|test|style|perf|ci|build)\([^)]*\):\s*(.+)/m);
  if (commitMatch) {
    return commitMatch[0].trim();
  }

  // Look for a "Co-Authored-By" line and grab the commit message above it
  const coAuthorIdx = output.indexOf("Co-Authored-By:");
  if (coAuthorIdx > 0) {
    const beforeCoAuthor = output.slice(Math.max(0, coAuthorIdx - 300), coAuthorIdx).trim();
    const lines = beforeCoAuthor.split("\n").filter((l: string) => l.trim());
    if (lines.length > 0) {
      return lines[lines.length - 1].trim().slice(0, 200);
    }
  }

  // Fallback: last meaningful non-empty line from output (skip common noise)
  const lines = output.split("\n").filter((l: string) => {
    const trimmed = l.trim();
    return trimmed && !trimmed.startsWith("$") && !trimmed.startsWith(">") && trimmed.length > 10;
  });
  if (lines.length > 0) {
    return lines[lines.length - 1].trim().slice(0, 200);
  }

  return "";
}

function notifyTaskCompletion(task: any, outcome: "done" | "review" | "failed") {
  const taskLabel = String(task.title || task.id).replace(/"/g, "'");
  const summary = extractBuildSummary(task);
  const summaryLine = summary ? `\n📋 ${summary}` : "";
  const model = task.routedModel ? ` [${task.routedModel}]` : "";
  const project = task.project ? ` (${task.project})` : "";

  if (outcome === "done") {
    const text = `✅ Task complete: ${taskLabel}${project}${model}${summaryLine}`;
    sendTelegramNotification(text);
    createInAppNotification("Task Completed", `${taskLabel}${summary ? ` — ${summary.slice(0, 100)}` : ""}`, "success");
    appendTaskToLog(task, "done");
  } else if (outcome === "review") {
    const reviewReason = task.tags?.length ? ` [${task.tags.join(", ")}]` : "";
    const text = `🔍 Ready for review: ${taskLabel}${project}${model}${reviewReason}${summaryLine}`;
    sendTelegramNotification(text);
    createInAppNotification("Task Ready for Review", `${taskLabel}${summary ? ` — ${summary.slice(0, 100)}` : ""}`, "info");
  } else {
    const errorSnippet = task.buildError ? `\n⚠️ ${String(task.buildError).slice(0, 200)}` : "";
    const text = `❌ Task failed: ${taskLabel}${project}${model}${errorSnippet}`;
    sendTelegramNotification(text);
    createInAppNotification("Task Failed", `${taskLabel}${task.buildError ? ` — ${String(task.buildError).slice(0, 100)}` : ""}`, "error");
    appendTaskToLog(task, "failed");
  }
}

function hydrateTaskFromPendingEntry(task: any, entry: any, executionKey: string) {
  const pendingState = entry.status === "queued" ? "queued" : entry.status === "spawning" ? "spawning" : "running";
  task.buildState = pendingState;
  task.activeBuildId = entry.id;
  task.buildExecutionKey = executionKey;
  task.buildTriggeredAt = task.buildTriggeredAt || entry.startedAt || entry.queuedAt || new Date().toISOString();
  task.buildQueuedAt = entry.queuedAt || task.buildQueuedAt;
  task.buildStartedAt = entry.runningAt || task.buildStartedAt;
  task.buildPid = typeof entry.pid === "number" && Number.isFinite(entry.pid) ? entry.pid : task.buildPid;

  if (entry.routing) {
    task.routedModel = task.routedModel || entry.routing.modelName;
    task.routedTier = task.routedTier || entry.routing.tier;
    task.routingReason = task.routingReason || entry.routing.reason;
    task.complexityScore = task.complexityScore ?? entry.routing.complexityScore;
    task.savingsPercent = task.savingsPercent ?? entry.routing.savingsPercent;
  }
}

function clearTransientBuildTracking(task: any) {
  delete task.activeBuildId;
  delete task.buildQueuedAt;
  delete task.buildStartedAt;
  delete task.buildPid;
}

function finalizeTerminalBuildState(task: any, buildState: "completed" | "blocked", now: string) {
  clearTransientBuildTracking(task);
  task.buildState = buildState;
  task.buildCompletedAt = now;
}

function comparePriority(a: any, b: any) {
  const pa = PRIORITY_ORDER[a.priority] ?? 9;
  const pb = PRIORITY_ORDER[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  return new Date(a.created || 0).getTime() - new Date(b.created || 0).getTime();
}

function computePendingPromotions(tasks: any[], projects: any[], buildLog: { builds: any[] }) {
  let toInProgress = 0;
  let toOnDeck = 0;

  const terminalStatuses = new Set(["done"]);
  const byProject = new Map<string, any[]>();

  for (const task of tasks) {
    if (terminalStatuses.has(task.status)) continue;
    const projectId = task.project || "unscoped";
    if (!byProject.has(projectId)) byProject.set(projectId, []);
    byProject.get(projectId)!.push(task);
  }

  for (const [, projectTasks] of byProject) {
    const onDeck = projectTasks.filter((task: any) => task.status === "to-do").sort(comparePriority);
    const backlog = projectTasks.filter((task: any) => task.status === "backlog").sort(comparePriority);
    const currentOnDeckCount = projectTasks.filter((task: any) => task.status === "to-do").length;
    const slotsAvailable = Math.max(0, MAX_ON_DECK_PER_PROJECT - currentOnDeckCount);

    for (const candidate of onDeck) {
      const { executionKey } = getProjectMeta(candidate, projects);
      if (findActiveEntryForExecutionKey(buildLog, executionKey)) continue;
      if (!Array.isArray(candidate.acceptance_criteria) || candidate.acceptance_criteria.length === 0) continue;
      toInProgress++;
    }

    toOnDeck += Math.min(slotsAvailable, backlog.length);
  }

  return {
    toInProgress,
    toOnDeck,
    total: toInProgress + toOnDeck,
  };
}

export function getFactoryStatusSnapshot() {
  const tasks = readTasks();
  const projects = readProjects();
  const buildLog = readBuildLog();
  const lock = readFactoryLockState();
  const pendingPromotions = computePendingPromotions(tasks, projects, buildLog);
  const recentPromotionEvents = dbGetTransitions(undefined, 200)
    .filter((entry) => entry.actor === "reconciler" && (entry.to_status === "in-progress" || entry.to_status === "to-do"))
    .slice(0, 10)
    .map((entry) => {
      const task = tasks.find((candidate: any) => candidate.id === entry.task_id);
      return {
        taskId: entry.task_id,
        taskTitle: task?.title || entry.task_id,
        project: task?.project || "unscoped",
        kind: entry.to_status === "in-progress" ? "to-do-to-in-progress" : "backlog-to-to-do",
        fromStatus: entry.from_status,
        toStatus: entry.to_status,
        timestamp: entry.ts,
      };
    });

  return {
    lastReconcileAt: lastReconcileAt > 0 ? new Date(lastReconcileAt).toISOString() : null,
    nextScheduledReconcileAt: new Date((lastReconcileAt > 0 ? lastReconcileAt : Date.now()) + RECONCILE_INTERVAL_MS).toISOString(),
    currentLockHolder: lock.held ? lock.holder : "none",
    queueDepth: (buildLog.builds || []).filter((build: any) => build.status === "queued").length,
    pendingPromotions,
    recentPromotionEvents,
  };
}

/**
 * Autonomous task advancement:
 * 1. to-do → in-progress when build capacity is available for that execution key
 * 2. backlog → to-do when the to-do queue for a project is below threshold
 *
 * Returns task IDs that were promoted to in-progress (need build kicks).
 */
function advanceTasks(
  tasks: any[],
  projects: any[],
  buildLog: { builds: any[] }
): { promoted: string[]; advanced: string[]; changed: boolean } {
  const promoted: string[] = [];
  const advanced: string[] = [];
  let changed = false;
  const now = new Date().toISOString();

  // Group tasks by project — exclude done tasks entirely so they can never be re-promoted
  const TERMINAL_STATUSES = new Set(["done"]);
  const byProject = new Map<string, any[]>();
  for (const task of tasks) {
    if (TERMINAL_STATUSES.has(task.status)) continue;
    const proj = task.project || "unscoped";
    if (!byProject.has(proj)) byProject.set(proj, []);
    byProject.get(proj)!.push(task);
  }

  // Track how many promotions we've committed per execution key so we don't
  // over-promote beyond the concurrency cap in a single sweep.
  const promotedPerKey = new Map<string, number>();

  for (const [, projectTasks] of byProject) {
    const onDeck = projectTasks.filter((t: any) => t.status === "to-do").sort(comparePriority);
    const backlog = projectTasks.filter((t: any) => t.status === "backlog").sort(comparePriority);
    const inProgress = projectTasks.filter((t: any) => t.status === "in-progress");

    // Step 1: to-do → in-progress — check per-agent capacity, not per-project
    for (const candidate of onDeck) {
      const { executionKey } = getProjectMeta(candidate, projects);

      // Respect repo-level concurrency cap, accounting for promotions already made this sweep
      const activeBuilds = buildLog.builds.filter(
        (b: any) => b.executionKey === executionKey && ACTIVE_BUILD_STATUSES.has(b.status)
      );
      const effectiveActive = activeBuilds.length + (promotedPerKey.get(executionKey) || 0);
      if (effectiveActive >= MAX_CONCURRENT_BUILDS_PER_KEY) {
        console.log(`[factory] advanceTasks: skipping ${candidate.id} — execution key "${executionKey}" at capacity (${effectiveActive}/${MAX_CONCURRENT_BUILDS_PER_KEY})`);
        continue;
      }

      // Per-agent concurrency gate DISABLED for Sprint 2 parallel throughput
      // const candidateAgentId = candidate.assignedAgent || resolveAgentForTask(candidate).agentId;
      // if (candidateAgentId && findActiveBuildForAgent(buildLog, candidateAgentId)) continue;

      // Auto-generate acceptance criteria if missing — prevents the transitionTask guard
      // from silently blocking to-do → in-progress promotion forever.
      if (!Array.isArray(candidate.acceptance_criteria) || candidate.acceptance_criteria.length === 0) {
        candidate.acceptance_criteria = [
          `Complete the task described in: ${String(candidate.title || candidate.id).slice(0, 120)}`,
        ];
        console.log(`[factory] advanceTasks: auto-generated acceptance_criteria for ${candidate.id} — was empty, blocking promotion`);
        addPipelineComment(candidate, "Auto-generated acceptance criteria (was empty, blocking auto-promotion)");
        changed = true;
      }

      const ok = transitionTask(candidate, "in-progress", "reconciler");
      if (!ok) {
        console.log(`[factory] advanceTasks: skipping ${candidate.id} — transitionTask blocked (state: ${candidate.status})`);
        continue;
      }
      candidate.updated = now;
      // Auto-assign the right builder agent on promotion
      autoAssignBuilder(candidate);
      addPipelineComment(candidate, "Auto-promoted from to-do → in-progress (build capacity available)");
      promoted.push(candidate.id);
      promotedPerKey.set(executionKey, (promotedPerKey.get(executionKey) || 0) + 1);
      changed = true;
    }

    // Step 2: backlog → to-do if to-do count is below threshold
    const currentOnDeckCount = projectTasks.filter((t: any) => t.status === "to-do").length;
    const slotsAvailable = MAX_ON_DECK_PER_PROJECT - currentOnDeckCount;

    if (slotsAvailable > 0 && backlog.length > 0) {
      const toAdvance = backlog.slice(0, slotsAvailable);
      for (const task of toAdvance) {
        transitionTask(task, "to-do", "reconciler");
        task.updated = now;
        addPipelineComment(task, "Auto-advanced from backlog → to-do (slot available)");
        advanced.push(task.id);
        changed = true;
      }
    }
  }

  return { promoted, advanced, changed };
}

export async function reconcileBuildQueue(options?: { source?: string; force?: boolean }) {
  const nowMs = Date.now();
  if (!options?.force && nowMs - lastReconcileAt < RECONCILE_INTERVAL_MS) {
    return { skipped: true, recoveredTaskIds: [] as string[], hydratedTaskIds: [] as string[], advancedTaskIds: [] as string[], promotedTaskIds: [] as string[], deferredDrainedIds: [] as string[] };
  }
  lastReconcileAt = nowMs;

  const sweep = await withFactoryLock(async () => {
    const tasks = readTasks();
    const projects = readProjects();
    const buildLog = readBuildLog();
    const tasksToKick = new Set<string>();
    const recoveredTaskIds: string[] = [];
    const hydratedTaskIds: string[] = [];
    let changed = false;

    for (const task of tasks) {
      if (task.status !== "in-progress") continue;

      const { executionKey } = getProjectMeta(task, projects);
      const pending = findPendingEntryForTask(buildLog, task.id);
      const active = findActiveEntryForExecutionKey(buildLog, executionKey);

      if (pending) {
        const beforeState = JSON.stringify({
          buildState: task.buildState,
          activeBuildId: task.activeBuildId,
          buildExecutionKey: task.buildExecutionKey,
          buildTriggeredAt: task.buildTriggeredAt,
        });

        hydrateTaskFromPendingEntry(task, pending, executionKey);

        const afterState = JSON.stringify({
          buildState: task.buildState,
          activeBuildId: task.activeBuildId,
          buildExecutionKey: task.buildExecutionKey,
          buildTriggeredAt: task.buildTriggeredAt,
        });

        if (beforeState !== afterState) {
          task.updated = new Date().toISOString();
          hydratedTaskIds.push(task.id);
          changed = true;
        }

        if (pending.status === "queued" && !active) {
          const pendingAgentId = pending.assignedAgent || task.assignedAgent || null;
          const agentBusyInReconcile = pendingAgentId ? findActiveBuildForAgent(buildLog, pendingAgentId) : undefined;
          if (!agentBusyInReconcile) {
            tasksToKick.add(task.id);
          }
        }
        continue;
      }

      const looksOrphaned = !task.activeBuildId && !task.buildTriggeredAt && !task.buildState;
      const lostPendingMetadata = ["queued", "spawning", "running"].includes(task.buildState || "");

      if (looksOrphaned || lostPendingMetadata) {
        if (lostPendingMetadata) {
          clearTransientBuildTracking(task);
          delete task.buildState;
          delete task.buildTriggeredAt;
          delete task.buildCompletedAt;
        }
        task.updated = new Date().toISOString();
        recoveredTaskIds.push(task.id);
        tasksToKick.add(task.id);
        changed = true;
      }

      // Catch-all: in-progress task with no build-log entry and not already queued to kick.
      // Covers post-restart edge cases like buildState=failed without a scheduled retry,
      // partially cleared build tracking, or any state that slipped past the orphan check.
      if (!tasksToKick.has(task.id)) {
        const hasScheduledRetry = !!task.buildRetryScheduledAt;
        const isAwaitingReview = task.buildState === "completed" ||
          ["pending-vigil-qa", "pending-visual-qa", "pending", "vigil-reviewing", "running", "approved"].includes(task.codeReviewState || "");
        const isBlocked = task.buildState === "blocked";

        if (!hasScheduledRetry && !isAwaitingReview && !isBlocked) {
          console.log(`[factory] Reconcile catch-all recovery: in-progress task "${String(task.title || task.id).replace(/"/g, "'")}" has no active build (buildState=${task.buildState || "none"}) — re-spawning`);
          clearTransientBuildTracking(task);
          delete task.buildState;
          delete task.buildTriggeredAt;
          delete task.buildCompletedAt;
          task.updated = new Date().toISOString();
          recoveredTaskIds.push(task.id);
          tasksToKick.add(task.id);
          changed = true;
        }
      }
    }

    // Zombie build cleanup — after a server restart, child processes are dead but
    // build-log entries still show "running"/"spawning". Detect these by checking
    // if the build started before the current server process booted.
    const now = Date.now();
    for (const build of buildLog.builds || []) {
      if (!ACTIVE_BUILD_STATUSES.has(build.status)) continue;
      const buildStarted = build.startedAt ? new Date(build.startedAt).getTime() : (build.queuedAt ? new Date(build.queuedAt).getTime() : 0);
      if (buildStarted > 0 && buildStarted < SERVER_BOOT_MS) {
        const task = tasks.find((t: any) => t.id === build.taskId);
        const label = task ? String(task.title || build.taskId).replace(/"/g, "'") : build.taskId;
        console.log(`[factory] Zombie build cleanup: ${build.id} for task "${label}" started before server boot — marking failed`);
        build.status = "failed";
        build.completedAt = new Date().toISOString();
        build.output = "Build process lost during server restart — will be re-spawned by reconciler";
        if (task && task.status === "in-progress") {
          clearTransientBuildTracking(task);
          delete task.buildState;
          delete task.buildTriggeredAt;
          delete task.buildCompletedAt;
          recoveredTaskIds.push(task.id);
          tasksToKick.add(task.id);
        }
        changed = true;
      }
    }

    // Missing-process cleanup — reclaim builder capacity immediately when a build-log
    // entry claims a builder is active but the child PID is gone (or never materialized).
    for (const build of buildLog.builds || []) {
      if (!hasMissingBuilderProcess(build)) continue;
      const task = tasks.find((t: any) => t.id === build.taskId);
      const label = task ? String(task.title || build.taskId).replace(/"/g, "'") : build.taskId;
      console.warn(`[factory] Missing builder cleanup: ${build.id} for "${label}" has no live process — reclaiming slot`);
      build.status = "failed";
      build.completedAt = new Date().toISOString();
      build.error = build.error || "Builder process missing";
      build.output = "Builder process missing or died before HiveRunner observed a stable PID";
      build.pid = null;
      if (task && task.status === "in-progress") {
        clearTransientBuildTracking(task);
        delete task.buildState;
        delete task.buildTriggeredAt;
        delete task.buildCompletedAt;
        recoveredTaskIds.push(task.id);
        tasksToKick.add(task.id);
      }
      changed = true;
    }

    // Orphaned build cleanup — immediately reclaim capacity from builds whose task
    // no longer exists or has already reached a terminal/review state.
    // This MUST run before advanceTasks so freed slots are visible for promotion.
    const TERMINAL_TASK_STATUSES = new Set(["done", "review"]);
    for (const build of buildLog.builds || []) {
      if (!ACTIVE_BUILD_STATUSES.has(build.status)) continue;
      const task = tasks.find((t: any) => t.id === build.taskId);
      if (!task) {
        // Task deleted or never existed — orphaned build
        console.log(`[factory] Orphaned build cleanup: ${build.id} for missing task ${build.taskId} — marking failed`);
        build.status = "failed";
        build.completedAt = new Date().toISOString();
        build.output = "Build orphaned — task no longer exists in task store";
        changed = true;
      } else if (TERMINAL_TASK_STATUSES.has(task.status)) {
        // Task already done/review but build still shows active — stale reference
        console.log(`[factory] Stale build cleanup: ${build.id} for ${task.status} task ${build.taskId} — marking failed`);
        build.status = "failed";
        build.completedAt = new Date().toISOString();
        build.output = `Build cleaned up — task already in ${task.status} status`;
        clearTransientBuildTracking(task);
        delete task.buildState;
        changed = true;
      }
    }

    // Stale build cleanup — mark builds stuck in "running" or "spawning" too long as failed
    for (const build of buildLog.builds || []) {
      if (ACTIVE_BUILD_STATUSES.has(build.status) && build.startedAt) {
        const elapsed = now - new Date(build.startedAt).getTime();
        if (elapsed > STALE_BUILD_TIMEOUT_MS) {
          const hangMinutes = Math.round(elapsed / 60000);
          console.log(`[factory] Stale build timeout: ${build.taskId} (${hangMinutes}min) — marking failed`);
          build.status = "failed";
          build.completedAt = new Date().toISOString();
          build.output = `Build timed out after ${hangMinutes} minutes (stale process detected)`;
          // Clear the task's build tracking so it can be re-queued (but never for done tasks)
          const task = tasks.find((t: any) => t.id === build.taskId);
          const hangLabel = task ? String(task.title || build.taskId).replace(/"/g, "'") : build.taskId;
          const hangAgent = task?.assignee || task?.routedModel || "unknown agent";
          if (task && task.status !== "done") {
            clearTransientBuildTracking(task);
            delete task.buildState;
            recoveredTaskIds.push(task.id);
            tasksToKick.add(task.id);
          } else if (task && task.status === "done") {
            // Just clean up stale build tracking, don't re-queue
            clearTransientBuildTracking(task);
            delete task.buildState;
          }
          // Notify operator lead — agent has been running too long without completing
          sendTelegramNotification(
            `⏱️ POSSIBLE HANG: "${hangLabel}" has been running ${hangMinutes} minutes with no completion.\n\nAgent: ${hangAgent}\nMarking failed and re-queuing. May need triage.`
          );
          createInAppNotification(
            "⏱️ Agent Hang Detected",
            `"${hangLabel}" running ${hangMinutes}min — possible hang, marked failed`,
            "warning",
            "/tasks"
          );
          changed = true;
        }
      }
    }
    if (changed) {
      writeBuildLog(buildLog);
    }

    // In-progress heartbeat timeout — escalate if in-progress with no active build > 30min
    for (const task of tasks) {
      if (task.status !== "in-progress") continue;
      if (findPendingEntryForTask(buildLog, task.id)) continue; // active build exists
      if (task.escalatedToLead) continue; // already escalated
      const lastUpdate = task.buildStartedAt || task.updated || task.created;
      if (!lastUpdate) continue;
      const elapsedMs = now - new Date(lastUpdate).getTime();
      if (elapsedMs > IN_PROGRESS_HEARTBEAT_TIMEOUT_MS) {
        const minutes = Math.round(elapsedMs / 60000);
        console.warn(`[factory] Heartbeat timeout: ${task.id} in-progress ${minutes}min with no active build`);
        task.escalatedToLead = true;
        task.escalatedAt = new Date().toISOString();
        task.escalationReason = `No active build for ${minutes} minutes`;
        addPipelineComment(task, `⏱️ Heartbeat timeout: no active build for ${minutes}min — escalated to operator lead`, "Pipeline");
        sendTelegramNotification(
          `⏱️ HEARTBEAT TIMEOUT: "${String(task.title || task.id).replace(/"/g, "'")}" stuck in-progress for ${minutes}min with no active build. Needs triage.`
        );
        createInAppNotification(
          "⏱️ Heartbeat Timeout",
          `"${String(task.title || task.id).replace(/"/g, "'")}" stuck in-progress ${minutes}min — no active build`,
          "warning",
          "/tasks"
        );
        changed = true;
      }
    }

    // ── Auto-retry drain — kick tasks whose retry delay has elapsed ────────────
    for (const task of tasks) {
      if (task.status !== "in-progress") continue;
      if (task.buildState !== "failed") continue;
      if (!task.buildRetryScheduledAt) continue;
      const retryAt = new Date(task.buildRetryScheduledAt).getTime();
      if (now >= retryAt) {
        const attempt = (task.buildFailureCount || 0) + 1;
        console.log(`[factory] Auto-retry drain: ${task.id} — attempt ${attempt}/${MAX_BUILD_RETRIES + 1}`);
        delete task.buildRetryScheduledAt;
        clearTransientBuildTracking(task);
        delete task.buildState;
        delete task.buildTriggeredAt;
        delete task.buildQueuedAt;
        delete task.buildStartedAt;
        delete task.buildCompletedAt;
        delete task.buildOutput;
        task.buildError = null;
        task.updated = new Date().toISOString();
        tasksToKick.add(task.id);
        changed = true;
      }
    }

    // ── Stall detection — alert if any task in-progress >15 min with no build activity
    for (const task of tasks) {
      if (task.status !== "in-progress") continue;
      if (task.stallAlertSent) continue; // already alerted
      if (findPendingEntryForTask(buildLog, task.id)) continue; // active build exists
      if (task.buildRetryScheduledAt) continue; // retry is scheduled, not stalled
      const lastActivity = task.buildCompletedAt || task.buildStartedAt || task.buildTriggeredAt || task.updated || task.created;
      if (!lastActivity) continue;
      const elapsedMs = now - new Date(lastActivity).getTime();
      if (elapsedMs > STALL_ALERT_TIMEOUT_MS) {
        const minutes = Math.round(elapsedMs / 60000);
        console.warn(`[factory] Stall alert: ${task.id} in-progress ${minutes}min with no build activity`);
        task.stallAlertSent = true;
        addPipelineComment(task, `⚠️ Stall detected: no build activity for ${minutes}min — alerting operator lead`, "Pipeline", "⚠️");
        sendTelegramNotification(
          `⚠️ STALL DETECTED: "${String(task.title || task.id).replace(/"/g, "'")}" in-progress for ${minutes}min with no build activity. May need triage.`
        );
        createInAppNotification(
          "⚠️ Stall Detected",
          `"${String(task.title || task.id).replace(/"/g, "'")}" in-progress ${minutes}min — no build activity`,
          "warning",
          "/tasks"
        );
        changed = true;
      }
    }

    // Review alert — notify if task has been in review > 15min without resolution
    for (const task of tasks) {
      if (task.status !== "review") continue;
      if (task.reviewAlertSent) continue; // already alerted this cycle
      const reviewSince = task.reviewRequestedAt || task.updated;
      if (!reviewSince) continue;
      const elapsedMs = now - new Date(reviewSince).getTime();
      if (elapsedMs > REVIEW_ALERT_TIMEOUT_MS) {
        const minutes = Math.round(elapsedMs / 60000);
        console.warn(`[factory] Review alert: ${task.id} in review for ${minutes}min`);
        task.reviewAlertSent = true;
        addPipelineComment(task, `⚠️ Review alert: task has been in review for ${minutes}min — needs Gater attention`, "Pipeline");
        sendSystemEvent(`⚠️ Review timeout: "${String(task.title || task.id).replace(/"/g, "'")}" in review ${minutes}min — needs Gater attention`);
        changed = true;
      }
    }

    // Autonomous task advancement — to-do → in-progress, backlog → to-do
    const advancement = advanceTasks(tasks, projects, buildLog);
    if (advancement.changed) changed = true;
    for (const id of advancement.promoted) {
      tasksToKick.add(id);
      const promotedTask = tasks.find((t: any) => t.id === id);
      if (promotedTask) {
        console.log(`[factory] Auto-promoted to-do → in-progress: ${promotedTask.title || id} (${promotedTask.project || "unscoped"})`);
      }
    }
    for (const id of advancement.advanced) {
      const advancedTask = tasks.find((t: any) => t.id === id);
      if (advancedTask) {
        console.log(`[factory] Auto-advanced backlog → to-do: ${advancedTask.title || id} (${advancedTask.project || "unscoped"})`);
      }
    }

    // Drain deferred quota queue during off-peak windows
    const deferredEligible = drainDeferredQueue(tasks);
    for (const id of deferredEligible) {
      const dTask = tasks.find((t: any) => t.id === id);
      if (dTask) {
        delete dTask.quotaDeferred;
        delete dTask.quotaDeferReason;
        delete dTask.quotaDeferUntil;
        dTask.updated = new Date().toISOString();
        tasksToKick.add(id);
        changed = true;
      }
    }

    // Clean up deferred flags for tasks no longer runnable
    for (const task of tasks) {
      if (task.quotaDeferred && ["done", "review"].includes(task.status)) {
        removeDeferredTask(task.id);
        delete task.quotaDeferred;
        delete task.quotaDeferReason;
        delete task.quotaDeferUntil;
        task.updated = new Date().toISOString();
        changed = true;
      }
    }

    if (changed) {
      writeTasks(tasks);
    }

    // Inbound sync: import external tasks from tasks-log.md (throttled to once per minute)
    let importedCount = 0;
    const nowMs = Date.now();
    if (nowMs - lastLogSyncAt >= LOG_SYNC_INTERVAL_MS) {
      lastLogSyncAt = nowMs;
      const freshTasks = readTasks(); // re-read to get latest state for dedup
      const externalTasks = importExternalTasks(freshTasks);
      if (externalTasks.length > 0) {
        const merged = [...externalTasks, ...freshTasks];
        writeTasks(merged);
        importedCount = externalTasks.length;
        console.log(`[factory] Imported ${importedCount} external tasks from tasks-log.md`);
      }
    }

    // Collect promoted task labels for notifications (emitted outside lock)
    const promotedLabels: string[] = [];
    for (const id of advancement.promoted) {
      const t = tasks.find((t: any) => t.id === id);
      if (t) promotedLabels.push(String(t.title || id).replace(/"/g, "'"));
    }

    return {
      recoveredTaskIds,
      hydratedTaskIds,
      advancedTaskIds: advancement.advanced,
      promotedTaskIds: advancement.promoted,
      promotedLabels,
      deferredDrainedIds: deferredEligible,
      taskIdsToKick: Array.from(tasksToKick),
      importedFromLog: importedCount,
    };
  }, `reconcile:${options?.source || "factory"}`);

  // Notify when to-do tasks are auto-promoted to in-progress
  for (const label of sweep.promotedLabels) {
    sendSystemEvent(`🚀 On-deck auto-promoted → in-progress: ${label}`);
  }

  for (const taskId of sweep.taskIdsToKick) {
    await queueOrStartBuild(taskId, { source: options?.source || "reconcile" });
  }

  // Periodic WAL checkpoint — at most once per hour, checkpoint the WAL to the
  // main DB file and record a snapshot entry. Keeps the WAL file small and
  // gives an explicit on-disk snapshot for backup/restore purposes.
  if (nowMs - lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) {
    lastCheckpointAt = nowMs;
    try {
      dbCheckpoint("auto: reconcile");
    } catch (err) {
      console.warn("[reconcile] WAL checkpoint failed (non-fatal):", err);
    }
  }

  return {
    skipped: false,
    recoveredTaskIds: sweep.recoveredTaskIds,
    hydratedTaskIds: sweep.hydratedTaskIds,
    advancedTaskIds: sweep.advancedTaskIds,
    promotedTaskIds: sweep.promotedTaskIds,
    deferredDrainedIds: sweep.deferredDrainedIds,
  };
}

async function updateRunningState(buildId: string, taskId: string, pid?: number | null) {
  const codexBridgeData: { current: { buildId: string; taskId: string; taskTitle?: string; assignedAgent: string | null; startedAt: string; agentType?: string; modelId?: string; modelName?: string } | null } = { current: null };

  await withFactoryLock(async () => {
    const buildLog = readBuildLog();
    const tasks = readTasks();
    const entry = buildLog.builds.find((b: any) => b.id === buildId);
    const task = tasks.find((t: any) => t.id === taskId);

    if (entry && entry.status === "spawning") {
      entry.status = "running";
      entry.runningAt = new Date().toISOString();
      entry.pid = typeof pid === "number" && Number.isFinite(pid) ? pid : null;
      writeBuildLog(buildLog);

      // Capture data for Codex bridge (called after lock release)
      if (entry.agentType === "codex") {
        codexBridgeData.current = {
          buildId: entry.id,
          taskId: entry.taskId,
          taskTitle: entry.taskTitle,
          assignedAgent: entry.assignedAgent || null,
          startedAt: entry.startedAt || entry.runningAt,
          agentType: entry.agentType,
          modelId: entry.routing?.modelId,
          modelName: entry.routing?.modelName,
        };
      }
    }

    if (task && ["spawning", "queued"].includes(task.buildState)) {
      task.buildState = "running";
      task.buildStartedAt = new Date().toISOString();
      task.buildPid = typeof pid === "number" && Number.isFinite(pid) ? pid : undefined;
      task.updated = new Date().toISOString();
      writeTasks(tasks);
    }
  });

  // Bridge Codex execution into canonical orchestration run model (non-blocking)
  if (codexBridgeData.current) {
    bridgeCodexRunStarted({
      buildId: codexBridgeData.current.buildId,
      factoryTaskId: codexBridgeData.current.taskId,
      factoryTaskTitle: codexBridgeData.current.taskTitle,
      assignedAgent: codexBridgeData.current.assignedAgent,
      startedAt: codexBridgeData.current.startedAt,
      modelId: codexBridgeData.current.modelId,
      modelName: codexBridgeData.current.modelName,
    });
  }
}

async function blockTaskForSpawnFailure(buildId: string, taskId: string, errorMessage: string) {
  let notifyText = "";
  let notifyTask: any = null;
  const codexSpawnFailData: { current: { buildId: string; taskId: string; assignedAgent: string | null; startedAt: string; completedAt: string; error: string; agentType?: string } | null } = { current: null };
  const anthropicSpawnFailData: { current: { buildId: string; taskId: string; assignedAgent: string | null; startedAt: string; completedAt: string; error: string } | null } = { current: null };

  await withFactoryLock(async () => {
    const buildLog = readBuildLog();
    const tasks = readTasks();
    const entry = buildLog.builds.find((b: any) => b.id === buildId);
    const task = tasks.find((t: any) => t.id === taskId);
    if (!entry || !task) return;

    const now = new Date().toISOString();
    const trimmedError = errorMessage.trim() || "Unknown spawn failure";
    const buildError = `Build spawn failed: ${trimmedError}`;

    entry.status = "blocked";
    entry.completedAt = now;
    entry.output = buildError.slice(-1500);
    entry.error = trimmedError;
    entry.pid = null;

    // Capture data for Codex bridge (called after lock release)
    if (entry.agentType === "codex") {
      codexSpawnFailData.current = {
        buildId: entry.id,
        taskId: entry.taskId,
        assignedAgent: entry.assignedAgent || null,
        startedAt: entry.startedAt || now,
        completedAt: now,
        error: buildError,
        agentType: entry.agentType,
      };
    } else if (entry.agentType === "claude-code") {
      anthropicSpawnFailData.current = {
        buildId: entry.id,
        taskId: entry.taskId,
        assignedAgent: entry.assignedAgent || null,
        startedAt: entry.startedAt || now,
        completedAt: now,
        error: buildError,
      };
    }

    transitionTask(task, "blocked", "build-spawn", { reason: "Builder process failed to start" });
    finalizeTerminalBuildState(task, "blocked", now);
    task.buildError = buildError;
    task.blockedReason = buildError;
    task.updated = now;

    addPipelineComment(task, `🚧 Builder failed to start:\n${trimmedError}`, "Pipeline", "🚧");

    notifyTask = { ...task };
    notifyText = `🚧 BUILD SPAWN FAILED: "${String(task.title || taskId).replace(/"/g, "'")}" — ${trimmedError.slice(0, 300)}`;

    writeBuildLog(buildLog);
    writeTasks(tasks);
  });

  // Bridge Codex spawn failure into canonical run model (non-blocking)
  if (codexSpawnFailData.current) {
    const d = codexSpawnFailData.current;
    bridgeCodexRunFailed({
      buildId: d.buildId,
      factoryTaskId: d.taskId,
      assignedAgent: d.assignedAgent,
      startedAt: d.startedAt,
      completedAt: d.completedAt,
      durationMs: new Date(d.completedAt).getTime() - new Date(d.startedAt).getTime(),
      error: d.error,
    });
  }
  if (anthropicSpawnFailData.current) {
    const d = anthropicSpawnFailData.current;
    bridgeAnthropicRunFailed({
      buildId: d.buildId,
      factoryTaskId: d.taskId,
      assignedAgent: d.assignedAgent,
      startedAt: d.startedAt,
      completedAt: d.completedAt,
      durationMs: new Date(d.completedAt).getTime() - new Date(d.startedAt).getTime(),
      error: d.error,
    });
  }

  if (notifyTask) {
    notifyTaskCompletion(notifyTask, "failed");
  }
  if (notifyText) {
    sendSystemEvent(notifyText);
  }
}

async function finalizeBuild(buildId: string, taskId: string, success: boolean, output: string) {
  type ReviewSpawnData = { task: any; reviewEntry: any; projectName: string; projectDir: string; buildOutput: string };
  type VisualQASpawnData = {
    task: any; visualQAEntry: any; projectName: string; projectDir: string;
    buildOutput: string; executionKey: string;
  };
  type VigilQASpawnData = {
    task: any; qaEntry: any; projectName: string; projectDir: string;
    buildOutput: string; builderAgentId: string; captureScreenshots: boolean;
  };
  type AgentMemoryData = { agentId: string; taskId: string; taskTitle: string; project: string; output: string };

  let nextTaskId: string | null = null;
  let completedAgentId: string | null = null;
  let notifyText = "";
  let reviewSpawnData: ReviewSpawnData | null = null;
  let visualQASpawnData: VisualQASpawnData | null = null;
  let vigilQASpawnData: VigilQASpawnData | null = null;
  let memoryData: AgentMemoryData | null = null;
  let blockerDetected = false;
  const codexBridgeFinalize: { current: { buildId: string; taskId: string; assignedAgent: string | null; startedAt: string; completedAt: string; success: boolean; error?: string; agentType?: string } | null } = { current: null };

  await withFactoryLock(async () => {
    const buildLog = readBuildLog();
    const tasks = readTasks();
    const projects = readProjects();
    const entry = buildLog.builds.find((b: any) => b.id === buildId);
    const task = tasks.find((t: any) => t.id === taskId);

    if (!entry || !task) return;

    const now = new Date().toISOString();
    entry.status = success ? "completed" : "failed";
    entry.completedAt = now;
    entry.output = output.slice(-1500);

    // Capture data for Codex bridge (called after lock release)
    if (entry.agentType === "codex") {
      codexBridgeFinalize.current = {
        buildId: entry.id,
        taskId: entry.taskId,
        assignedAgent: entry.assignedAgent || null,
        startedAt: entry.startedAt || now,
        completedAt: now,
        success,
        error: success ? undefined : (output.slice(-500) || "Build failed"),
        agentType: entry.agentType,
      };
    }

    // GUARD: never resurrect a done task — record build result but leave status untouched
    if (task.status === "done") {
      console.log(`[factory] finalizeBuild: task ${taskId} is done — recording build result but not changing status`);
      clearTransientBuildTracking(task);
      delete task.buildState;
      task.buildCompletedAt = now;
      task.buildOutput = output.slice(-1500);
      task.updated = now;
      writeBuildLog(buildLog);
      writeTasks(tasks);
      return;
    }

    // Resolve which named agent handled this task
    const assignment = resolveAgentForTask(task);
    task.assignedAgent = assignment.agentId;
    task.assignedAgentReason = assignment.reason;

    task.updated = now;
    task.buildOutput = output.slice(-1500);
    task.buildCompletedAt = now;
    clearTransientBuildTracking(task);

    // Blocker detection — check output for blocker signals regardless of success/failure
    const blocker = detectBlocker(output, assignment.agentId);
    if (blocker) {
      blockerDetected = true;
      transitionTask(task, "blocked", "blocker-detector");
      task.buildState = "blocked";
      task.blocker = blocker;
      task.buildError = `BLOCKED by ${assignment.agentId}: ${blocker.reason}`;
      notifyText = `🚫 BLOCKED: ${String(task.title || taskId).replace(/"/g, "'")} — ${blocker.reason.slice(0, 200)}`;

      // Notify operator lead
      blocker.notifiedLead = true;
      sendTelegramNotification(
        `🚫 AGENT BLOCKED: "${String(task.title || taskId).replace(/"/g, "'")}" — ${assignment.agentId} reports: ${blocker.reason.slice(0, 300)}\n\nCategory: ${blocker.category}\nNeeds triage.`
      );
      createInAppNotification(
        "🚫 Agent Blocked",
        `${assignment.agentId} blocked on "${String(task.title || taskId).replace(/"/g, "'")}" — ${blocker.category}`,
        "warning",
        "/tasks",
      );

      writeBuildLog(buildLog);
      writeTasks(tasks);

      // Still record agent memory for blocked tasks
      memoryData = {
        agentId: assignment.agentId,
        taskId: task.id,
        taskTitle: task.title,
        project: task.project || "unscoped",
        output,
      };
      return;
    }

    if (success) {
      task.buildState = "completed";
      task.buildError = null;
      delete task.codeReviewNotes;
      // task.status stays "in-progress" — reviewer/Vigil will apply the final transition
      completedAgentId = entry.assignedAgent || assignment.agentId || null;

      const { projectName, projectDir } = getProjectMeta(task, projects);
      const isUITask = shouldRequireVisualReview(task);

      // Record agent memory for completed builds
      memoryData = {
        agentId: assignment.agentId,
        taskId: task.id,
        taskTitle: task.title,
        project: task.project || "unscoped",
        output,
      };

      if (assignment.needsQAHandoff) {
        // Tasks built by builder agents (Pixel/Forge) → hand off to Vigil for QA
        if (isUITask) {
          task.visualReview = {
            ...(task.visualReview || {}),
            required: true,
            status: "pending-capture",
            lastUpdatedAt: now,
          };
        }
        task.codeReviewState = "pending-vigil-qa";
        task.codeReviewStartedAt = now;
        task.qaHandoff = {
          taskId: task.id,
          builderAgent: assignment.agentId,
          qaAgent: "vigil",
          builderSummary: output.slice(-500),
          handoffAt: now,
        };

        const qaEntry = {
          id: `vigil-qa-${Date.now()}`,
          taskId: task.id,
          taskTitle: task.title,
          project: task.project,
          executionKey: `${entry.executionKey}:vigil-qa`,
          originalExecutionKey: entry.executionKey,
          status: "spawning",
          queuedAt: null,
          startedAt: now,
          completedAt: null,
          agentType: "vigil-qa",
          workDir: entry.workDir,
          source: "auto-vigil-qa",
          routing: {
            tier: "sonnet",
            modelId: "anthropic/claude-sonnet-4-6",
            modelName: "Sonnet 4.6",
            reason: `QA handoff from ${assignment.agentId} → Vigil`,
          },
        };
        buildLog.builds.unshift(qaEntry);

        vigilQASpawnData = {
          task: { ...task },
          qaEntry,
          projectName,
          projectDir,
          buildOutput: output.slice(-1500),
          builderAgentId: assignment.agentId,
          captureScreenshots: isUITask,
        };

        notifyText = `🛡️ Build complete → Vigil QA handoff: ${String(task.title || taskId).replace(/"/g, "'")} (built by ${assignment.agentId})`;
      } else if (isUITask) {
        // UI tasks go through visual QA pipeline first: capture → visual QA review → code review
        task.visualReview = {
          ...(task.visualReview || {}),
          required: true,
          status: "pending-capture",
          lastUpdatedAt: now,
        };
        task.codeReviewState = "pending-visual-qa";
        task.codeReviewStartedAt = now;

        const visualQAEntry = {
          id: `visual-qa-${Date.now()}`,
          taskId: task.id,
          taskTitle: task.title,
          project: task.project,
          executionKey: `${entry.executionKey}:visual-qa`,
          originalExecutionKey: entry.executionKey,
          status: "spawning",
          queuedAt: null,
          startedAt: now,
          completedAt: null,
          agentType: "reviewer",
          workDir: entry.workDir,
          source: "auto-visual-qa",
          routing: {
            tier: "sonnet",
            modelId: "anthropic/claude-sonnet-4-6",
            modelName: "Sonnet 4.6",
            reason: "Visual QA review after successful UI build",
          },
        };
        buildLog.builds.unshift(visualQAEntry);

        visualQASpawnData = {
          task: { ...task },
          visualQAEntry,
          projectName,
          projectDir,
          buildOutput: output.slice(-1500),
          executionKey: entry.executionKey,
        };

        notifyText = `👁️ Build complete, visual QA pipeline starting: ${String(task.title || taskId).replace(/"/g, "'")}`;
      } else {
        // Non-UI tasks go directly to code review (existing behavior)
        task.codeReviewState = "pending";
        task.codeReviewStartedAt = now;

        const reviewEntry = {
          id: `review-${Date.now()}`,
          taskId: task.id,
          taskTitle: task.title,
          project: task.project,
          executionKey: `${entry.executionKey}:review`,
          originalExecutionKey: entry.executionKey,
          status: "spawning",
          queuedAt: null,
          startedAt: now,
          completedAt: null,
          agentType: "reviewer",
          workDir: entry.workDir,
          source: "auto-review",
          routing: {
            tier: "sonnet",
            modelId: "anthropic/claude-sonnet-4-6",
            modelName: "Sonnet 4.6",
            reason: "Auto code review after successful build",
          },
        };
        buildLog.builds.unshift(reviewEntry);

        reviewSpawnData = {
          task: { ...task },
          reviewEntry,
          projectName,
          projectDir,
          buildOutput: output.slice(-1500),
        };

        notifyText = `🔍 Build complete, auto-reviewer spawning: ${String(task.title || taskId).replace(/"/g, "'")}`;
      }
    } else {
      // ── Auto-retry failed builds ──────────────────────────────────────
      const failureCount = (task.buildFailureCount || 0) + 1;
      task.buildFailureCount = failureCount;
      task.buildError = output.slice(-1500);
      completedAgentId = entry.assignedAgent || assignment.agentId || null;

      // Record agent memory even for failures
      memoryData = {
        agentId: assignment.agentId,
        taskId: task.id,
        taskTitle: task.title,
        project: task.project || "unscoped",
        output,
      };

      if (failureCount > MAX_BUILD_RETRIES) {
        // 3rd failure (or more) → move to blocked, alert operator lead
        transitionTask(task, "blocked", "build-failure-cap");
        task.buildState = "blocked";
        task.escalatedToLead = true;
        task.escalatedAt = now;
        task.escalationReason = `Build failed ${failureCount} times — auto-retry exhausted`;
        addPipelineComment(
          task,
          `🛑 Build failed ${failureCount} times — auto-retry exhausted, moved to blocked. Last error:\n${output.slice(-300)}`,
          "Pipeline",
          "🛑"
        );
        notifyText = `🛑 BUILD RETRY EXHAUSTED: "${String(task.title || taskId).replace(/"/g, "'")}" failed ${failureCount} times — moved to blocked. Needs triage.`;
        sendTelegramNotification(notifyText);
        createInAppNotification(
          "🛑 Build Retry Exhausted",
          `"${String(task.title || taskId).replace(/"/g, "'")}" failed ${failureCount} times — blocked`,
          "error",
          "/tasks"
        );
      } else {
        // Retry available — schedule retry after delay
        transitionTask(task, "in-progress", "build-failure");
        task.buildState = "failed";
        task.buildRetryScheduledAt = new Date(Date.now() + BUILD_RETRY_DELAY_MS).toISOString();
        addPipelineComment(
          task,
          `❌ Build failed (attempt ${failureCount}/${MAX_BUILD_RETRIES + 1}) — auto-retry scheduled in ${BUILD_RETRY_DELAY_MS / 1000}s`,
          "Pipeline",
          "🔄"
        );
        notifyText = `🔄 Build failed (attempt ${failureCount}/${MAX_BUILD_RETRIES + 1}): "${String(task.title || taskId).replace(/"/g, "'")}" — auto-retry in 60s`;
      }

      // Advance the AGENT's queue (not just the execution key) so the next queued task for
      // the same agent starts immediately, even if it's in a different project.
      nextTaskId = completedAgentId
        ? nextQueuedTaskIdForAgent(buildLog, completedAgentId)
        : nextQueuedTaskId(buildLog, entry.executionKey);
    }

    writeBuildLog(buildLog);
    writeTasks(tasks);
  });

  // Bridge Codex execution into canonical orchestration run model (non-blocking)
  if (codexBridgeFinalize.current) {
    const d = codexBridgeFinalize.current;
    const durationMs = new Date(d.completedAt).getTime() - new Date(d.startedAt).getTime();
    if (d.success) {
      bridgeCodexRunCompleted({ buildId: d.buildId, completedAt: d.completedAt, durationMs });
    } else {
      bridgeCodexRunFailed({
        buildId: d.buildId,
        factoryTaskId: d.taskId,
        assignedAgent: d.assignedAgent,
        startedAt: d.startedAt,
        completedAt: d.completedAt,
        durationMs,
        error: d.error || "Build failed",
      });
    }
  }

  // Record agent memory outside the lock (non-critical path)
  const completedMemoryData = memoryData as AgentMemoryData | null;
  if (completedMemoryData) {
    try {
      const { summary, lessons, knownIssues } = extractMemoryFromOutput(completedMemoryData.output);
      recordAgentMemory(completedMemoryData.agentId, {
        taskId: completedMemoryData.taskId,
        taskTitle: completedMemoryData.taskTitle,
        project: completedMemoryData.project,
        summary,
        lessons,
        knownIssues,
      });
    } catch (err) {
      console.error("[factory] Failed to record agent memory:", err);
    }
  }

  if (notifyText) sendSystemEvent(notifyText);
  if (blockerDetected) return; // Blocked tasks don't advance the pipeline

  if (!success && notifyText) {
    createInAppNotification("Build Failed", notifyText, "error");
    sendTelegramNotification(notifyText);
  }

  // Vigil QA handoff for tasks built by builder agents (Pixel/Forge)
  const pendingVigilQA = vigilQASpawnData as VigilQASpawnData | null;
  if (pendingVigilQA) {
    const { task, qaEntry, projectName, projectDir, buildOutput, builderAgentId, captureScreenshots } = pendingVigilQA;
    // For UI tasks: capture both Chromium + WebKit (Safari) screenshots for cross-browser QA
    const captures = captureScreenshots ? await captureAndStoreScreenshot(task.id, task, "after", true) : [];
    spawnVigilQAProcess(task, qaEntry, projectName, projectDir, buildOutput, builderAgentId, captures);
    // Builder agent is now free — advance their queue
    reconcileBuildQueue({ source: `post-build-agent:${buildId}`, force: true }).catch(() => {});
    return;
  }

  // UI tasks: capture screenshot then spawn visual QA review
  const pendingVisualQA = visualQASpawnData as VisualQASpawnData | null;
  if (pendingVisualQA) {
    const { task, visualQAEntry, projectName, projectDir, buildOutput } = pendingVisualQA;
    // Capture "after" screenshot, then spawn visual QA reviewer
    const captures = await captureAndStoreScreenshot(task.id, task, "after");
    spawnVisualQAProcess(task, visualQAEntry, projectName, projectDir, buildOutput, captures);
    // Builder agent is now free — advance their queue
    reconcileBuildQueue({ source: `post-build-agent:${buildId}`, force: true }).catch(() => {});
    return;
  }

  // Non-UI tasks: go directly to code review
  const pendingReview = reviewSpawnData as ReviewSpawnData | null;
  if (pendingReview) {
    const { task, reviewEntry, projectName, projectDir, buildOutput } = pendingReview;
    spawnReviewProcess(task, reviewEntry, projectName, projectDir, buildOutput);
    // Builder agent is now free — advance their queue
    reconcileBuildQueue({ source: `post-build-agent:${buildId}`, force: true }).catch(() => {});
    return;
  }

  // Directly kick the next queued task for the completed agent, then always reconcile
  // so other agents' queued tasks and housekeeping (stale builds, heartbeats) are handled.
  if (nextTaskId) {
    queueOrStartBuild(nextTaskId, { source: `post-build:${buildId}` }).catch((err) => {
      console.error("Failed to auto-start queued task:", err);
    });
  }

  reconcileBuildQueue({ source: `post-build:${buildId}`, force: true }).catch((err) => {
    console.error("Failed to auto-advance task queue:", err);
  });
}

function reviewPrompt(task: any, projectName: string, buildOutput: string) {
  const failureCount = task.reviewFailureCount || 0;
  const previousNotes = task.codeReviewNotes ? `\n### Previous Review Notes (failure #${failureCount})\n${task.codeReviewNotes}\n` : "";
  const isUiTask = hasAnyTag(task, VISUAL_REVIEW_TAGS);

  return [
    `## Auto Code Review: ${task.title}`,
    "",
    `**Project:** ${projectName}`,
    `**Task Type:** ${task.type || "feature"}`,
    `**Priority:** ${task.priority}`,
    failureCount > 0 ? `**Review Attempt:** ${failureCount + 1} (previously failed ${failureCount} time${failureCount > 1 ? "s" : ""})` : "",
    "",
    "### Task Description",
    task.description || task.title,
    "",
    ...(Array.isArray(task.acceptance_criteria) && task.acceptance_criteria.length > 0
      ? [
          "### Acceptance Criteria",
          "These verify-that statements MUST all be satisfied for the task to pass review:",
          ...task.acceptance_criteria.map((c: string) => `- ${c}`),
          "",
        ]
      : []),
    previousNotes,
    "### What the builder just did",
    "A build agent completed this task. The last 1500 chars of its output:",
    "```",
    buildOutput || "(no output captured)",
    "```",
    "",
    "### Your Review Steps",
    "Run each of these — be thorough, nothing marked Done unless actually done:",
    "",
    "1. `git log --oneline -3` — verify commits were made with a reasonable message",
    "2. `git diff HEAD~1` — read through every change. Check for:",
    "   - Broken imports or missing dependencies",
    "   - Syntax errors, unclosed brackets, template literal issues",
    "   - Incomplete implementations (TODO, placeholder, hardcoded stubs)",
    "   - Does the diff actually address the task description?",
    "3. `cp -r . /tmp/hiverunner-qa-build && cd /tmp/hiverunner-qa-build && npm run build 2>&1 | tail -80 && cd - && rm -rf /tmp/hiverunner-qa-build` — build in temp copy (do NOT run npm run build in the live directory). Failure = NEEDS_FIX",
    "4. `npm test 2>&1 | tail -50` — run tests if they exist. New test failures = NEEDS_FIX",
    Array.isArray(task.acceptance_criteria) && task.acceptance_criteria.length > 0 ? "5. **Acceptance criteria** — verify each criterion listed above is actually satisfied. Any unmet criterion = NEEDS_FIX." : "",
    isUiTask ? "5. For this UI task: check that any new pages/components are properly exported and routed. Look for missing CSS classes, broken JSX, or unhandled client/server component boundaries." : "",
    failureCount > 0 ? `6. IMPORTANT: This task failed review ${failureCount} time(s) before. Verify the previous issues noted above are ACTUALLY FIXED, not just acknowledged.` : "",
    "",
    "### Verdict",
    "Output EXACTLY one of the following blocks at the very end of your response — nothing after it:",
    "",
    "If the work looks correct, complete, and the build passes:",
    "VERDICT: APPROVED",
    "",
    "If there are specific bugs, build failures, or missing requirements:",
    "VERDICT: NEEDS_FIX",
    "NOTES:",
    "- [specific issue 1]",
    "- [specific issue 2]",
    "",
    "Only flag real defects. Do NOT flag style nits, prefer-X-over-Y suggestions, or theoretical improvements.",
    "But DO fail the review if: build doesn't compile, tests break, imports are missing, or the task description wasn't addressed.",
  ].join("\n");
}

function parseReviewVerdict(output: string): { verdict: "APPROVED" | "NEEDS_FIX"; notes: string } {
  if (/VERDICT:\s*APPROVED/i.test(output)) {
    return { verdict: "APPROVED", notes: "" };
  }
  if (/VERDICT:\s*NEEDS_FIX/i.test(output)) {
    const notesMatch = output.match(/NOTES:\s*([\s\S]+?)(?:\n{2,}|$)/i);
    const notes = notesMatch ? notesMatch[1].trim() : "Reviewer flagged issues — see review build output for details.";
    return { verdict: "NEEDS_FIX", notes };
  }
  // No parseable verdict — treat as approved so we don't block the pipeline
  return { verdict: "APPROVED", notes: "" };
}

async function finalizeReview(reviewBuildId: string, taskId: string, success: boolean, output: string) {
  let requeue = false;
  let notifyText = "";
  let notifyOutcome: "done" | "review" | "failed" | null = null;
  let notifyTask: any = null;
  let originalExecutionKey = "";
  let gaterSpawnData: {
    task: any; gaterEntry: any; projectName: string; projectDir: string; buildOutput: string; captures: any[];
  } | null = null;

  await withFactoryLock(async () => {
    const buildLog = readBuildLog();
    const tasks = readTasks();
    const projects = readProjects();
    const reviewEntry = buildLog.builds.find((b: any) => b.id === reviewBuildId);
    const task = tasks.find((t: any) => t.id === taskId);

    if (!reviewEntry || !task) return;

    originalExecutionKey = reviewEntry.originalExecutionKey || "";
    const now = new Date().toISOString();
    reviewEntry.completedAt = now;
    reviewEntry.output = output.slice(-1500);

    if (!success) {
      // Reviewer process itself failed — treat as approved to avoid blocking the pipeline
      reviewEntry.status = "failed";
      task.codeReviewState = "approved";
      task.codeReviewCompletedAt = now;
    } else {
      reviewEntry.status = "completed";
      const { verdict, notes } = parseReviewVerdict(output);
      task.codeReviewState = verdict === "APPROVED" ? "approved" : "needs-fix";
      task.codeReviewCompletedAt = now;
      if (notes) task.codeReviewNotes = notes;

      if (verdict === "NEEDS_FIX") {
        // GUARD: never resurrect a done task via code review rejection
        if (task.status === "done") {
          console.log(`[factory] Code review NEEDS_FIX but task ${taskId} is done — skipping rejection`);
          writeBuildLog(buildLog);
          writeTasks(tasks);
          return;
        }
        const failureCount = (task.reviewFailureCount || 0) + 1;
        task.reviewFailureCount = failureCount;
        transitionTask(task, "in-progress", "code-review");
        task.buildState = "failed";
        task.buildError = `Auto-reviewer requested changes (attempt ${failureCount}):\n${notes}`;
        task.lastReviewVerdict = "NEEDS_FIX";
        task.lastReviewerAgent = "QA Reviewer (Sonnet)";
        task.lastReviewNotes = notes;
        task.lastReviewAt = now;
        delete task.completedAt;
        requeue = true;

        // Re-assign to original builder with rejection comment
        const originalBuilder = task.assignedAgent || task.assignee;
        if (originalBuilder) {
          const builderAgent = getAgentByAnyId(originalBuilder);
          if (builderAgent) {
            task.assignee = builderAgent.name.replace(/\s*[^\w\s].*$/, "").trim() || builderAgent.name;
            addPipelineComment(task, `Code review rejected (attempt ${failureCount}) — reassigned to ${builderAgent.name} for fixes:\n${notes.slice(0, 300)}`, "QA Reviewer", "🔍");
          }
        }

        if (failureCount >= MAX_REVIEW_FAILURES_BEFORE_ESCALATION) {
          // Escalate to operator lead — this task has failed review too many times
          task.escalatedToLead = true;
          task.escalatedAt = now;
          task.escalationReason = `Failed auto-review ${failureCount} times. Latest issues: ${notes.slice(0, 300)}`;
          notifyText = `🚨 ESCALATION: Task failed review ${failureCount}x — needs operator attention: ${String(task.title || taskId).replace(/"/g, "'")}`;
          sendTelegramNotification(`🚨 QA ESCALATION: "${String(task.title || taskId).replace(/"/g, "'")}" has failed auto-review ${failureCount} times.\n\nLatest issues:\n${notes.slice(0, 500)}\n\nThis task needs manual intervention.`);
          createInAppNotification(
            "⚠️ QA Escalation",
            `"${String(task.title || taskId).replace(/"/g, "'")}" failed review ${failureCount}x — needs manual attention`,
            "warning",
            "/tasks"
          );
        } else {
          notifyText = `🔄 Auto-review NEEDS FIX (attempt ${failureCount}/${MAX_REVIEW_FAILURES_BEFORE_ESCALATION}): ${String(task.title || taskId).replace(/"/g, "'")}`;
        }
      }
    }

    if (task.codeReviewState === "approved") {
      task.lastReviewVerdict = "APPROVED";
      task.lastReviewerAgent = "QA Reviewer (Sonnet)";
      task.lastReviewAt = now;

      if (shouldRequireReview(task)) {
        transitionTask(task, "review", "code-review");
        task.reviewRequired = true;
        task.reviewStatus = "pending";
        task.reviewRequestedAt = now;
        autoAssignGater(task);

        if (shouldRequireVisualReview(task)) {
          const existingVisualReview = task.visualReview || {};
          const captureCount = Array.isArray(existingVisualReview.captures) ? existingVisualReview.captures.length : 0;
          task.visualReview = {
            ...existingVisualReview,
            required: true,
            status: captureCount > 0 ? "ready" : "pending-capture",
            lastUpdatedAt: now,
          };
        }

        // Create build log entry and prepare to spawn Gater as a real process
        const { projectName, projectDir } = getProjectMeta(task, projects);
        const gaterEntry = {
          id: `gater-qa-${Date.now()}`,
          taskId: task.id,
          taskTitle: task.title,
          project: task.project,
          executionKey: `${reviewEntry.executionKey || reviewEntry.originalExecutionKey || task.project}:gater-qa`,
          originalExecutionKey: reviewEntry.originalExecutionKey || reviewEntry.executionKey || "",
          status: "spawning",
          queuedAt: null,
          startedAt: now,
          completedAt: null,
          agentType: "gater-qa",
          workDir: reviewEntry.workDir || projectDir,
          source: "auto-gater-qa",
          routing: {
            tier: "sonnet",
            modelId: "anthropic/claude-sonnet-4-6",
            modelName: "Sonnet 4.6",
            reason: "Code review approved → Gater final QA gate",
          },
        };
        buildLog.builds.unshift(gaterEntry);

        // Collect existing screenshots for Gater
        const existingCaptures = Array.isArray(task.visualReview?.captures) ? task.visualReview.captures : [];

        gaterSpawnData = {
          task: { ...task },
          gaterEntry,
          projectName,
          projectDir,
          buildOutput: output.slice(-1500),
          captures: existingCaptures,
        };

        notifyText = `✅ Auto-review approved → spawning Gater QA: ${String(task.title || taskId).replace(/"/g, "'")}`;
        notifyOutcome = "review";
      } else {
        transitionTask(task, "done", "code-review", { force: true, reason: "auto-approve: review not required for this task type" });
        task.reviewRequired = false;
        task.reviewStatus = "not-needed";
        task.completedAt = now;
        addPipelineComment(task, "Auto-review approved — no human review required, task complete");
        notifyText = `✅ Auto-review approved → task complete: ${String(task.title || taskId).replace(/"/g, "'")}`;
        notifyOutcome = "done";
      }
    }

    notifyTask = { ...task };
    task.updated = now;
    writeBuildLog(buildLog);
    writeTasks(tasks);
  });

  // Telegram + in-app notification for task completion/review/failure
  if (notifyOutcome && notifyTask) {
    notifyTaskCompletion(notifyTask, notifyOutcome);
  } else if (notifyText) {
    sendSystemEvent(notifyText);
  }

  // Spawn Gater QA as a real Claude process
  if (gaterSpawnData) {
    const { task, gaterEntry, projectName, projectDir, buildOutput, captures } = gaterSpawnData;
    spawnGaterQAProcess(task, gaterEntry, projectName, projectDir, buildOutput, captures);
    // Review pipeline continues in finalizeGaterQA — don't advance build queue yet
    return;
  }

  if (requeue) {
    queueOrStartBuild(taskId, { source: `review-needs-fix:${reviewBuildId}` }).catch((err) => {
      console.error("Failed to re-queue task after review needs fix:", err);
    });
    return;
  }

  // Advance the build queue now that review is done
  if (originalExecutionKey) {
    const buildLog = readBuildLog();
    const nextTaskId = nextQueuedTaskId(buildLog, originalExecutionKey);
    if (nextTaskId) {
      queueOrStartBuild(nextTaskId, { source: `post-review:${reviewBuildId}` }).catch((err) => {
        console.error("Failed to start next task after review:", err);
      });
      return;
    }
  }
  reconcileBuildQueue({ source: `post-review:${reviewBuildId}`, force: true }).catch((err) => {
    console.error("Failed to advance queue after review:", err);
  });
}

function spawnReviewProcess(task: any, reviewEntry: any, projectName: string, projectDir: string, buildOutput: string) {
  const prompt = reviewPrompt(task, projectName, buildOutput);
  const args = ["--permission-mode", "bypassPermissions", "--model", REVIEWER_MODEL, "--print", prompt];

  sendSystemEvent(`🔍 Auto-reviewer spawning for: ${String(task.title || task.id).replace(/"/g, "'")}`);

  const reviewEnv = {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
  };

  const child = execFile(
    "claude",
    args,
    { cwd: projectDir, maxBuffer: 10 * 1024 * 1024, env: reviewEnv },
    (error, stdout, stderr) => {
      const output = summarizeOutput(error, stdout, stderr);
      finalizeReview(reviewEntry.id, task.id, !error, output).catch((err) => {
        console.error("Error finalizing review:", err);
      });
    }
  );

  child.on("spawn", () => {
    withFactoryLock(async () => {
      const buildLog = readBuildLog();
      const entry = buildLog.builds.find((b: any) => b.id === reviewEntry.id);
      if (entry && entry.status === "spawning") {
        entry.status = "running";
        entry.runningAt = new Date().toISOString();
        writeBuildLog(buildLog);
      }
      const tasks = readTasks();
      const t = tasks.find((t: any) => t.id === reviewEntry.taskId);
      if (t) {
        t.codeReviewState = "running";
        t.updated = new Date().toISOString();
        writeTasks(tasks);
      }
    }).catch(() => {});
  });

  child.on("error", (err) => {
    finalizeReview(reviewEntry.id, task.id, false, err.message).catch((finalizeErr) => {
      console.error("Error finalizing failed review spawn:", finalizeErr);
    });
  });
}

/** Spawn Gater QA agent as a real Claude process for final review gate */
function spawnGaterQAProcess(
  task: any,
  gaterEntry: any,
  projectName: string,
  projectDir: string,
  buildOutput: string,
  captures: any[],
) {
  const prompt = buildGaterReviewPrompt(task, projectName, buildOutput, captures);
  const args = ["--permission-mode", "bypassPermissions", "--model", REVIEWER_MODEL, "--print", prompt];

  sendSystemEvent(`🚧 Gater QA spawning for: ${String(task.title || task.id).replace(/"/g, "'")} — final review gate`);

  const gaterEnv = {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
  };

  const child = execFile(
    "claude",
    args,
    { cwd: projectDir, maxBuffer: 10 * 1024 * 1024, env: gaterEnv },
    (error, stdout, stderr) => {
      const output = summarizeOutput(error, stdout, stderr);
      finalizeGaterQA(gaterEntry.id, task.id, !error, output).catch((err) => {
        console.error("Error finalizing Gater QA:", err);
      });
    },
  );

  child.on("spawn", () => {
    withFactoryLock(async () => {
      const buildLog = readBuildLog();
      const entry = buildLog.builds.find((b: any) => b.id === gaterEntry.id);
      if (entry && entry.status === "spawning") {
        entry.status = "running";
        entry.runningAt = new Date().toISOString();
        writeBuildLog(buildLog);
      }
      const tasks = readTasks();
      const t = tasks.find((t: any) => t.id === task.id);
      if (t) {
        t.reviewStatus = "gater-reviewing";
        t.updated = new Date().toISOString();
        writeTasks(tasks);
      }
    }).catch(() => {});
  });

  child.on("error", (err) => {
    finalizeGaterQA(gaterEntry.id, task.id, false, err.message).catch((finalizeErr) => {
      console.error("Error finalizing failed Gater QA spawn:", finalizeErr);
    });
  });
}

/** Handle Gater QA completion — approved → done, rejected → back to in-progress, blocked → surface */
async function finalizeGaterQA(gaterBuildId: string, taskId: string, success: boolean, output: string) {
  let requeue = false;
  let notifyText = "";
  let notifyOutcome: "done" | "review" | "failed" | null = null;
  let notifyTask: any = null;

  await withFactoryLock(async () => {
    const buildLog = readBuildLog();
    const tasks = readTasks();
    const gaterEntry = buildLog.builds.find((b: any) => b.id === gaterBuildId);
    const task = tasks.find((t: any) => t.id === taskId);

    if (!gaterEntry || !task) return;

    const now = new Date().toISOString();
    gaterEntry.completedAt = now;
    gaterEntry.output = output.slice(-1500);

    if (!success) {
      // Gater process itself failed — treat as approved to avoid blocking the pipeline
      gaterEntry.status = "failed";
      console.warn(`[factory] Gater QA process failed for ${taskId}, treating as approved`);
      transitionTask(task, "done", "gater-qa", { force: true, reason: "Gater process failed — auto-approved to unblock pipeline" });
      finalizeTerminalBuildState(task, "completed", now);
      task.reviewStatus = "approved";
      task.reviewCompletedAt = now;
      task.completedAt = now;
      addPipelineComment(task, "Gater QA process failed — auto-approved to avoid blocking pipeline", "Gater", "🚧");
      notifyText = `⚠️ Gater QA failed (process error) — auto-approved: ${String(task.title || taskId).replace(/"/g, "'")}`;
      notifyOutcome = "done";
    } else {
      gaterEntry.status = "completed";
      const { verdict, notes } = parseReviewVerdict(output);

      // Check for BLOCKED verdict
      if (/VERDICT:\s*BLOCKED/i.test(output)) {
        const blockerMatch = output.match(/BLOCKED:\s*(.+?)(?:\n|$)/i);
        const blockerReason = blockerMatch ? blockerMatch[1].trim() : "Gater cannot verify this task";

        transitionTask(task, "blocked", "gater-qa");
        finalizeTerminalBuildState(task, "blocked", now);
        task.reviewStatus = "blocked";
        task.blocker = {
          reason: blockerReason,
          category: "cannot-verify" as const,
          raisedAt: now,
          raisedBy: "gater",
          notifiedLead: true,
          resolved: false,
        };
        addPipelineComment(task, `BLOCKED: ${blockerReason}`, "Gater", "🚧");
        notifyText = `🚧 Gater BLOCKED on: ${String(task.title || taskId).replace(/"/g, "'")} — ${blockerReason}`;
        sendTelegramNotification(`🚧 Gater BLOCKED: "${String(task.title || taskId).replace(/"/g, "'")}" — ${blockerReason}`);
        createInAppNotification("🚧 Gater Blocked", `"${String(task.title || taskId).replace(/"/g, "'")}" — ${blockerReason}`, "warning", "/tasks");
      } else if (verdict === "APPROVED") {
        // VISUAL VERIFICATION GATE: UI tasks must have screenshot evidence to be approved
        const isUITask = shouldRequireVisualReview(task);
        if (isUITask) {
          let hasVisualEvidence = false;
          try {
            const { hasVisualVerificationEvidence } = await import("@/lib/visual-qa");
            hasVisualEvidence = hasVisualVerificationEvidence(output);
          } catch { /* if import fails, no evidence */ }

          if (!hasVisualEvidence) {
            // Override APPROVED → BLOCKED: Gater approved without visual verification
            transitionTask(task, "blocked", "gater-qa");
            finalizeTerminalBuildState(task, "blocked", now);
            task.reviewStatus = "blocked";
            task.blocker = {
              reason: "UI task approved without visual verification — screenshots required",
              category: "cannot-verify" as const,
              raisedAt: now,
              raisedBy: "gater",
              notifiedLead: true,
              resolved: false,
            };
            task.lastReviewVerdict = "BLOCKED";
            task.lastReviewerAgent = "Gater";
            task.lastReviewAt = now;
            addPipelineComment(task, "🚧 BLOCKED: UI task approved without Playwright screenshot verification — visual QA is mandatory", "Gater", "🚧");
            notifyText = `🚧 Gater BLOCKED (no visual verification): ${String(task.title || taskId).replace(/"/g, "'")}`;
            sendTelegramNotification(`🚧 Gater visual QA gate: "${String(task.title || taskId).replace(/"/g, "'")}" — approved without screenshots, overridden to BLOCKED`);
            createInAppNotification("🚧 Visual QA Missing", `"${String(task.title || taskId).replace(/"/g, "'")}" needs Playwright screenshot verification`, "warning", "/tasks");

            writeBuildLog(buildLog);
            writeTasks(tasks);
            return;
          }
        }

        transitionTask(task, "done", "gater-qa", { force: true, reason: "Gater approved" });
        finalizeTerminalBuildState(task, "completed", now);
        task.reviewStatus = "approved";
        task.reviewCompletedAt = now;
        task.completedAt = now;
        task.lastReviewVerdict = "APPROVED";
        task.lastReviewerAgent = "Gater";
        task.lastReviewAt = now;
        addPipelineComment(task, "✅ Gater QA APPROVED — task complete (visual verification confirmed)", "Gater", "🚧");
        notifyText = `✅ Gater APPROVED: ${String(task.title || taskId).replace(/"/g, "'")}`;
        notifyOutcome = "done";
      } else {
        // NEEDS_FIX — send back to in-progress
        // GUARD: never resurrect a done task
        if (task.status === "done") {
          console.log(`[factory] Gater NEEDS_FIX but task ${taskId} is done — skipping rejection`);
          writeBuildLog(buildLog);
          writeTasks(tasks);
          return;
        }

        const failureCount = (task.reviewFailureCount || 0) + 1;
        task.reviewFailureCount = failureCount;
        transitionTask(task, "in-progress", "gater-qa");
        task.buildState = "failed";
        task.buildError = `Gater review rejected (attempt ${failureCount}):\n${notes}`;
        task.reviewStatus = "rejected";
        task.lastReviewVerdict = "NEEDS_FIX";
        task.lastReviewerAgent = "Gater";
        task.lastReviewNotes = notes;
        task.lastReviewAt = now;
        delete task.completedAt;
        requeue = true;

        // Re-assign to original builder
        const originalBuilder = task.assignedAgent || task.assignee;
        if (originalBuilder) {
          const builderAgent = getAgentByAnyId(originalBuilder);
          if (builderAgent) {
            task.assignee = builderAgent.name.replace(/\s*[^\w\s].*$/, "").trim() || builderAgent.name;
            addPipelineComment(task, `Gater review rejected (attempt ${failureCount}) — reassigned to ${builderAgent.name} for fixes:\n${notes.slice(0, 300)}`, "Gater", "🚧");
          }
        }

        if (failureCount >= MAX_REVIEW_FAILURES_BEFORE_ESCALATION) {
          task.escalatedToLead = true;
          task.escalatedAt = now;
          task.escalationReason = `Gater rejected ${failureCount} times. Latest issues: ${notes.slice(0, 300)}`;
          notifyText = `🚨 ESCALATION: Gater rejected ${failureCount}x — needs operator attention: ${String(task.title || taskId).replace(/"/g, "'")}`;
          sendTelegramNotification(`🚨 GATER ESCALATION: "${String(task.title || taskId).replace(/"/g, "'")}" rejected ${failureCount} times.\n\nLatest issues:\n${notes.slice(0, 500)}\n\nThis task needs manual intervention.`);
          createInAppNotification("⚠️ Gater Escalation", `"${String(task.title || taskId).replace(/"/g, "'")}" rejected ${failureCount}x — needs manual attention`, "warning", "/tasks");
        } else {
          notifyText = `🔄 Gater NEEDS FIX (attempt ${failureCount}/${MAX_REVIEW_FAILURES_BEFORE_ESCALATION}): ${String(task.title || taskId).replace(/"/g, "'")}`;
        }
      }
    }

    // Record Gater's memory from the output
    try {
      const { summary, lessons, knownIssues } = extractMemoryFromOutput(output);
      recordAgentMemory("gater", {
        taskId,
        taskTitle: `Gater QA review: ${taskId}`,
        project: task.project || "qa",
        summary: `Gater reviewed task. ${summary}`,
        lessons,
        knownIssues,
      });
    } catch (_) { /* non-critical */ }

    notifyTask = { ...task };
    task.updated = now;
    writeBuildLog(buildLog);
    writeTasks(tasks);
  });

  if (notifyOutcome && notifyTask) {
    notifyTaskCompletion(notifyTask, notifyOutcome);
  } else if (notifyText) {
    sendSystemEvent(notifyText);
  }

  if (requeue) {
    queueOrStartBuild(taskId, { source: `gater-needs-fix:${gaterBuildId}` }).catch((err) => {
      console.error("Failed to re-queue task after Gater rejection:", err);
    });
    return;
  }

  // Advance the build queue
  reconcileBuildQueue({ source: `post-gater-qa:${gaterBuildId}`, force: true }).catch((err) => {
    console.error("Failed to advance queue after Gater QA:", err);
  });
}

function spawnBuildProcess(task: any, buildEntry: any, projectName: string, projectDir: string) {
  const executor = selectBuildExecutor(buildEntry.routing, task, projectName);
  const forcedSpawnFailure = process.env.HIVERUNNER_E2E_BUILD_FORCE_SPAWN_FAILURE;

  if (forcedSpawnFailure) {
    const error = new Error(forcedSpawnFailure === "1" ? "Forced builder spawn failure for test" : forcedSpawnFailure);
    console.error(`[factory] Builder spawn forced to fail for ${task.id}:`, error.message);
    return blockTaskForSpawnFailure(buildEntry.id, task.id, error.message).then(() => {
      throw error;
    });
  }

  if (!existsSync(projectDir)) {
    const error = new Error(`Project directory does not exist: ${projectDir}`);
    console.error(`[factory] Builder spawn preflight failed for ${task.id}:`, error.message);
    return blockTaskForSpawnFailure(buildEntry.id, task.id, error.message).then(() => {
      throw error;
    });
  }

  if (!isCliAvailable(executor.command)) {
    const error = new Error(`Builder CLI not found on PATH: ${executor.command}`);
    console.error(`[factory] Builder spawn preflight failed for ${task.id}:`, error.message);
    return blockTaskForSpawnFailure(buildEntry.id, task.id, error.message).then(() => {
      throw error;
    });
  }

  sendSystemEvent(`🏭 Spawning agent for task: ${String(task.title || task.id).replace(/"/g, "'")} [${executor.actualModelName}]`);

  // Capture "before" screenshot for UI tasks (fire-and-forget, non-blocking)
  if (shouldRequireVisualReview(task)) {
    captureAndStoreScreenshot(task.id, task, "before").catch((err) => {
      console.error(`[factory] Before-screenshot capture failed for ${task.id}:`, err);
    });
  }

  // Ensure claude/codex binaries are findable — Next.js server may not have brew PATH
  const env = {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
  };

  if (process.env.HIVERUNNER_E2E_BUILD_STUB === "1") {
    return new Promise<{ pid: number | null }>((resolve, reject) => {
      const stubChild = execFile(
        process.execPath,
        ["-e", "setTimeout(() => process.exit(0), 250)"],
        { cwd: projectDir, maxBuffer: 1024 * 1024, env },
        (error, stdout, stderr) => {
          const output = summarizeOutput(error, stdout, stderr);
          finalizeBuild(buildEntry.id, task.id, !error, output).catch((err) => {
            console.error("Error finalizing stubbed build:", err);
          });
        }
      );

      stubChild.on("spawn", () => {
        const pid = typeof stubChild.pid === "number" ? stubChild.pid : null;
        updateRunningState(buildEntry.id, task.id, pid)
          .then(() => resolve({ pid }))
          .catch(async (err) => {
            console.error("Error marking stubbed build running:", err);
            await blockTaskForSpawnFailure(buildEntry.id, task.id, err instanceof Error ? err.message : String(err));
            reject(err);
          });
      });

      stubChild.on("error", async (err) => {
        console.error(`[factory] Stubbed builder spawn failed for ${task.id}:`, err);
        await blockTaskForSpawnFailure(buildEntry.id, task.id, err.message);
        reject(err);
      });
    });
  }

  return new Promise<{ pid: number | null }>((resolve, reject) => {
    let spawnSettled = false;
    let startupVerified = false;
    let spawnFailureHandled = false;
    let child: ReturnType<typeof execFile> | undefined;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let completion: { error: Error | null; stdout: string; stderr: string } | null = null;
    let finalized = false;
    let anthropicBridgeStarted = false;
    const pendingAnthropicChunks: string[] = [];

    const isAnthropicBuilder = executor.command === "claude" && executor.args.includes("stream-json");

    const flushAnthropicChunks = () => {
      if (!anthropicBridgeStarted || pendingAnthropicChunks.length === 0) return;
      for (const chunk of pendingAnthropicChunks.splice(0)) {
        bridgeAnthropicStdoutChunk({ buildId: buildEntry.id, chunk });
      }
    };

    const finalizeIfReady = () => {
      if (!startupVerified || !completion || finalized) return;
      finalized = true;
      const output = summarizeOutput(completion.error, completion.stdout, completion.stderr);
      const withExecutorNote = executor.fallbackReason
        ? `${executor.fallbackReason}\n\n${output}`
        : output;

      if (isAnthropicBuilder) {
        const durationMs = Date.now() - new Date(buildEntry.startedAt || Date.now()).getTime();
        if (completion.error) {
          bridgeAnthropicRunFailed({
            buildId: buildEntry.id,
            factoryTaskId: task.id,
            assignedAgent: buildEntry.assignedAgent || null,
            startedAt: buildEntry.startedAt || new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs,
            error: withExecutorNote || completion.error.message || "Build failed",
          });
        } else {
          bridgeAnthropicRunCompleted({
            buildId: buildEntry.id,
            completedAt: new Date().toISOString(),
            durationMs,
          });
        }
      }

      finalizeBuild(buildEntry.id, task.id, !completion.error, withExecutorNote).catch((err) => {
        console.error("Error finalizing build:", err);
      });
    };

    const failSpawn = async (message: string, err?: Error) => {
      if (spawnFailureHandled) return;
      spawnFailureHandled = true;
      try {
        await blockTaskForSpawnFailure(buildEntry.id, task.id, message);
      } catch (blockErr) {
        console.error("Error blocking task after failed spawn:", blockErr);
      }
      if (!spawnSettled) {
        spawnSettled = true;
        reject(err || new Error(message));
      }
    };

    const spawnTimeout = setTimeout(async () => {
      if (spawnSettled) return;
      const err = new Error(`Builder process did not emit spawn within ${BUILDER_SPAWN_TIMEOUT_MS}ms (${executor.command})`);
      console.error(`[factory] Builder spawn timeout for ${task.id}:`, err.message);
      try {
        child?.kill("SIGTERM");
      } catch (killErr) {
        console.error(`[factory] Failed to terminate timed-out builder for ${task.id}:`, killErr);
      }
      await failSpawn(err.message, err);
    }, BUILDER_SPAWN_TIMEOUT_MS);

    try {
      child = execFile(
        executor.command,
        executor.args,
        { cwd: projectDir, maxBuffer: 10 * 1024 * 1024, env },
        (error, stdout, stderr) => {
          completion = { error, stdout, stderr };
          finalizeIfReady();
        }
      );
    } catch (err) {
      clearTimeout(spawnTimeout);
      const spawnError = err instanceof Error ? err : new Error(String(err));
      console.error(`[factory] Builder spawn threw synchronously for ${task.id}:`, spawnError);
      void failSpawn(spawnError.message, spawnError);
      return;
    }

    if (isAnthropicBuilder && child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string | Buffer) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (!text) return;
        if (!anthropicBridgeStarted) {
          pendingAnthropicChunks.push(text);
          return;
        }
        bridgeAnthropicStdoutChunk({ buildId: buildEntry.id, chunk: text });
      });
    }

    child.on("exit", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
    });

    child.on("spawn", async () => {
      clearTimeout(spawnTimeout);
      const pid = typeof child.pid === "number" ? child.pid : null;

      if (isAnthropicBuilder && !anthropicBridgeStarted) {
        anthropicBridgeStarted = true;
        bridgeAnthropicRunStarted({
          buildId: buildEntry.id,
          factoryTaskId: task.id,
          factoryTaskTitle: task.title,
          assignedAgent: buildEntry.assignedAgent || null,
          startedAt: buildEntry.startedAt || new Date().toISOString(),
          modelId: executor.actualModelId,
          modelName: executor.actualModelName,
        });
        flushAnthropicChunks();
      }

      const stillAlive = await verifySpawnedProcess(pid);
      if (!stillAlive) {
        const startupMessage = buildSpawnStartupError(executor.command, pid, {
          exitCode,
          signal: exitSignal,
          output: completion ? summarizeOutput(completion.error, completion.stdout, completion.stderr) : null,
        });
        console.error(`[factory] Builder exited before startup verification for ${task.id}:`, startupMessage);
        await failSpawn(startupMessage, new Error(startupMessage));
        return;
      }

      startupVerified = true;
      try {
        await updateRunningState(buildEntry.id, task.id, pid);
      } catch (err) {
        console.error("Error marking build running:", err);
        await failSpawn(err instanceof Error ? err.message : String(err), err instanceof Error ? err : new Error(String(err)));
        return;
      }
      if (!spawnSettled) {
        spawnSettled = true;
        resolve({ pid });
      }
      finalizeIfReady();
    });

    child.on("error", async (err) => {
      clearTimeout(spawnTimeout);
      if (spawnSettled) return;
      console.error(`[factory] Builder spawn failed for ${task.id}:`, err);
      await failSpawn(err.message, err);
    });
  });
}

async function queueOrStartBuildDecision(taskId: string, options?: { source?: string }) {
  return withFactoryLock(async () => {
    const tasks = readTasks();
    const projects = readProjects();
    const buildLog = readBuildLog();
    const task = tasks.find((t: any) => t.id === taskId);

    if (!task) {
      return { kind: "missing" as const };
    }

    if (task.status !== "in-progress") {
      return { kind: "not-in-progress" as const, task };
    }

    const { projectName, executionKey, projectDir } = getProjectMeta(task, projects);
    const active = findActiveEntryForExecutionKey(buildLog, executionKey);
    let existing = findPendingEntryForTask(buildLog, taskId);

    if (existing && hasMissingBuilderProcess(existing)) {
      const now = new Date().toISOString();
      console.warn(`[factory] Reclaiming stale builder record for task ${taskId}: ${existing.id} has no live process`);
      existing.status = "failed";
      existing.completedAt = now;
      existing.error = existing.error || "Builder process missing";
      existing.output = "Builder process missing or died before HiveRunner observed a stable PID";
      existing.pid = null;
      if (task.activeBuildId === existing.id || task.buildState === "spawning" || task.buildState === "running") {
        clearTransientBuildTracking(task);
        delete task.buildState;
        delete task.buildTriggeredAt;
        delete task.buildCompletedAt;
        task.updated = now;
      }
      writeBuildLog(buildLog);
      writeTasks(tasks);
      existing = undefined;
    }

    if (existing) {
      const existingAgentId = existing.assignedAgent || task.assignedAgent || null;
      const agentBusyForExisting = existingAgentId ? findActiveBuildForAgent(buildLog, existingAgentId) : undefined;
      if (existing.status === "queued" && !active && !agentBusyForExisting) {
        const now = new Date().toISOString();
        existing.status = "spawning";
        existing.startedAt = now;
        existing.queuedAt = existing.queuedAt || now;

        task.buildState = "spawning";
        task.buildTriggeredAt = task.buildTriggeredAt || now;
        task.activeBuildId = existing.id;
        task.buildExecutionKey = executionKey;
        task.updated = now;

        writeBuildLog(buildLog);
        writeTasks(tasks);

        return {
          kind: "started" as const,
          task: { ...task },
          build: existing,
          projectName,
          projectDir,
        };
      }

      hydrateTaskFromPendingEntry(task, existing, executionKey);
      task.updated = new Date().toISOString();
      writeTasks(tasks);
      return { kind: "existing" as const, task: { ...task }, build: existing };
    }

    // Quota-aware scheduling gate — evaluate before creating a new build
    const quotaVerdict = evaluateTask(task, tasks);
    if (quotaVerdict.action === "debounced") {
      return {
        kind: "quota-debounced" as const,
        task: { ...task },
        verdict: quotaVerdict,
      };
    }
    if (quotaVerdict.action === "defer") {
      task.quotaDeferred = true;
      task.quotaDeferReason = quotaVerdict.reason;
      task.quotaDeferUntil = (quotaVerdict as any).deferUntil || null;
      task.updated = new Date().toISOString();
      writeTasks(tasks);
      return {
        kind: "quota-deferred" as const,
        task: { ...task },
        verdict: quotaVerdict,
      };
    }
    if (quotaVerdict.action === "block") {
      task.quotaBlocked = true;
      task.quotaBlockReason = quotaVerdict.reason;
      task.updated = new Date().toISOString();
      writeTasks(tasks);
      return {
        kind: "quota-blocked" as const,
        task: { ...task },
        verdict: quotaVerdict,
      };
    }
    // "allow" and "budget-warn" proceed — clear any prior deferral flags
    if (task.quotaDeferred) {
      delete task.quotaDeferred;
      delete task.quotaDeferReason;
      delete task.quotaDeferUntil;
    }
    if (task.quotaBlocked) {
      delete task.quotaBlocked;
      delete task.quotaBlockReason;
    }
    task.quotaVerdict = quotaVerdict.action;
    task.quotaReason = quotaVerdict.reason;

    // Named agent assignment FIRST — we need the agent ID to enforce per-agent concurrency
    const agentAssignment = autoAssignBuilder(task);
    const assignedAgentId = task.assignedAgent || agentAssignment.agentId || null;

    // Per-agent concurrency gate: DISABLED — allow parallel builds per agent for Sprint 2 throughput
    // const agentBusy = assignedAgentId ? findActiveBuildForAgent(buildLog, assignedAgentId) : undefined;
    const shouldQueue = !!active; // only queue if repo-level cap is hit

    const routing = routeTask(task);
    const executor = selectBuildExecutor(routing, task, projectName);
    const now = new Date().toISOString();
    const routingReason = executor.fallbackReason
      ? `${routing.reason}. ${executor.fallbackReason}`
      : routing.reason;

    const buildEntry = {
      id: `build-${Date.now()}`,
      taskId: task.id,
      taskTitle: task.title,
      project: task.project,
      executionKey,
      assignedAgent: assignedAgentId,
      status: shouldQueue ? "queued" : "spawning",
      queuedAt: shouldQueue ? now : null,
      startedAt: now,
      completedAt: null,
      agentType: executor.agentType,
      workDir: projectDir,
      source: options?.source || "factory",
      routing: {
        tier: routing.tier,
        modelId: executor.actualModelId,
        modelName: executor.actualModelName,
        preferredModelId: routing.modelId,
        preferredModelName: routing.modelName,
        complexityScore: routing.complexityScore,
        reason: routingReason,
        savingsPercent: routing.savingsPercent,
        executor: executor.executor,
        fallbackReason: executor.fallbackReason || null,
      },
    };

    buildLog.builds.unshift(buildEntry);

    task.buildState = shouldQueue ? "queued" : "spawning";
    task.buildQueuedAt = shouldQueue ? now : undefined;
    task.buildTriggeredAt = now;
    task.activeBuildId = buildEntry.id;
    task.buildExecutionKey = executionKey;
    task.routedModel = executor.actualModelName;
    task.routedTier = routing.tier;
    task.routingReason = routingReason;
    task.complexityScore = routing.complexityScore;
    task.savingsPercent = routing.savingsPercent;
    task.buildError = null;

    task.updated = now;

    writeBuildLog(buildLog);
    writeTasks(tasks);

    return {
      kind: shouldQueue ? ("queued" as const) : ("started" as const),
      task: { ...task },
      build: buildEntry,
      projectName,
      projectDir,
    };
  });
}

export async function queueOrStartBuild(taskId: string, options?: { source?: string }) {
  const decision = await queueOrStartBuildDecision(taskId, options);

  if (decision.kind === "started") {
    try {
      const spawn = await spawnBuildProcess(decision.task, decision.build, decision.projectName, decision.projectDir);
      const snapshot = readCurrentBuildTaskSnapshot(decision.build.id, taskId);
      return {
        ...decision,
        build: snapshot.build || decision.build,
        task: snapshot.task || decision.task,
        spawn,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const snapshot = readCurrentBuildTaskSnapshot(decision.build.id, taskId);
      return {
        kind: "spawn-failed" as const,
        error: errorMessage,
        build: snapshot.build || decision.build,
        task: snapshot.task || decision.task,
      };
    }
  }

  return decision;
}

export async function retryBuild(taskId: string, options?: { source?: string }) {
  let blocked = false;
  await withFactoryLock(async () => {
    const tasks = readTasks();
    const task = tasks.find((t: any) => t.id === taskId);
    if (!task) return;

    // GUARD: never resurrect a done task
    if (task.status === "done") {
      console.log(`[factory] retryBuild: task ${taskId} is done — refusing to retry`);
      blocked = true;
      return;
    }

    clearTransientBuildTracking(task);
    delete task.buildState;
    delete task.buildTriggeredAt;
    delete task.buildQueuedAt;
    delete task.buildStartedAt;
    delete task.buildCompletedAt;
    delete task.buildOutput;
    task.buildError = null;
    task.updated = new Date().toISOString();
    if (task.status !== "in-progress") {
      transitionTask(task, "in-progress", "retry");
    }
    writeTasks(tasks);
  });

  if (blocked) return { kind: "done-task-skipped" as const };
  return queueOrStartBuild(taskId, { source: options?.source || "retry" });
}

export const __testHooks = {
  queueOrStartBuildDecision,
  finalizeGaterQA,
  updateRunningState,
  blockTaskForSpawnFailure,
  spawnBuildProcess,
  verifySpawnedProcess,
  getProjectMeta,
  setLastReconcileAt(value: number) {
    lastReconcileAt = value;
  },
};
