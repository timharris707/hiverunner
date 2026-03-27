/* eslint-disable @typescript-eslint/no-explicit-any */
import { execFile } from "child_process";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { routeTask } from "@/lib/llm-router";

const DATA_DIR = join(process.cwd(), "data");
const TASKS_FILE = join(DATA_DIR, "tasks.json");
const PROJECTS_FILE = join(DATA_DIR, "projects.json");
const BUILD_LOG_FILE = join(DATA_DIR, "build-log.json");
const LOCKS_DIR = join(DATA_DIR, "locks");
const FACTORY_LOCK_FILE = join(LOCKS_DIR, "factory.lock");

mkdirSync(LOCKS_DIR, { recursive: true });

const ACTIVE_BUILD_STATUSES = new Set(["spawning", "running"]);
const PENDING_BUILD_STATUSES = new Set(["queued", "spawning", "running"]);
const REVIEW_TAGS = new Set(["ui", "trading-live", "external", "marketing", "money"]);
const VISUAL_REVIEW_TAGS = new Set(["ui"]);
const RECONCILE_INTERVAL_MS = 15_000;
const MAX_ON_DECK_PER_PROJECT = 1;
const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const PROJECT_DIRS: Record<string, string> = {
  "mission-control": "projects/mission-control-app",
  "advisory-board": "projects/mission-control-app",
  "crypto-trading": "projects/crypto-trading",
  "weather-trading": "projects/weather-trading",
  "stock-trading": "projects/stock-trading",
  "snapaudit": "projects/snapaudit",
  "idea-intake": "projects/idea-intake",
  "infrastructure": "",
  "org": "",
  "karpathy-loop": "projects/karpathy-loop",
};

let lastReconcileAt = 0;

type BuildExecutorDecision = {
  agentType: "openclaw";
  command: "openclaw";
  args: string[];
  actualModelId: string;
  actualModelName: string;
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
  return readJSON(TASKS_FILE, [] as any[]);
}

export function writeTasks(tasks: any[]) {
  writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

export function readProjects(): any[] {
  return readJSON(PROJECTS_FILE, [] as any[]);
}

export function readBuildLog(): { builds: any[] } {
  return readJSON(BUILD_LOG_FILE, { builds: [] as any[] });
}

export function writeBuildLog(data: { builds: any[] }) {
  writeFileSync(BUILD_LOG_FILE, JSON.stringify(data, null, 2));
}

async function withFactoryLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const staleMs = 30_000;
  const maxWaitMs = 5_000;
  const started = Date.now();

  while (true) {
    try {
      writeFileSync(FACTORY_LOCK_FILE, String(Date.now()), { flag: "wx" });
      break;
    } catch {
      try {
        const existingTs = Number(readFileSync(FACTORY_LOCK_FILE, "utf-8"));
        if (!Number.isNaN(existingTs) && Date.now() - existingTs > staleMs) {
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
  const workspaceRoot = process.env.WORKSPACE_ROOT || join(process.cwd(), "..", "..");
  const relProjectDir = PROJECT_DIRS[task.project] ?? "";
  const projectDir = relProjectDir ? join(workspaceRoot, relProjectDir) : workspaceRoot;
  return { project, projectName, executionKey, projectDir };
}

function buildPrompt(task: any, projectName: string, executorLabel: string) {
  return [
    `## Task: ${task.title}`,
    "",
    `**Project:** ${projectName}`,
    `**Type:** ${task.type || "feature"}`,
    `**Priority:** ${task.priority}`,
    `**Executor:** ${executorLabel}`,
    "",
    "### Description",
    task.description || task.title,
    "",
    "### Requirements",
    "- Make the necessary code changes to complete this task",
    "- Run the build (npm run build) and make sure it passes",
    "- Run tests if they exist",
    "- Commit with a clear message describing what was built",
    "- Push to the remote repository",
    "- Keep the implementation focused on the scoped task; do not rewrite unrelated areas",
    "",
    "When completely finished, run this command to notify the system:",
    `openclaw system event --text \"Done: ${String(task.title || "Task").replace(/"/g, '\\"')}\" --mode now`,
  ].join("\n");
}

function buildOpenClawExecutor(routing: any, prompt: string, fallbackReason?: string): BuildExecutorDecision {
  const tier = routing?.tier;
  const actualModelId = tier === "opus"
    ? "anthropic/claude-opus-4-6"
    : tier === "haiku"
      ? "anthropic/claude-haiku-3-5"
      : "anthropic/claude-sonnet-4-6";
  const actualModelName = tier === "opus" ? "Opus 4.6" : tier === "haiku" ? "Haiku 3.5" : "Sonnet 4.6";

  return {
    agentType: "openclaw",
    command: "openclaw",
    args: ["agent", "--local", "--message", prompt],
    actualModelId,
    actualModelName,
    fallbackReason,
  };
}

function selectBuildExecutor(routing: any, task: any, projectName: string): BuildExecutorDecision {
  // Primary path: spawn agent via OpenClaw
  const tier = routing?.tier;
  const executorLabel = tier === "opus"
    ? "OpenClaw Agent · Opus 4.6"
    : tier === "haiku"
      ? "OpenClaw Agent · Haiku 3.5"
      : "OpenClaw Agent · Sonnet 4.6";
  const prompt = buildPrompt(task, projectName, executorLabel);

  return buildOpenClawExecutor(routing, prompt);
}

function hasAnyTag(task: any, tags: Set<string>) {
  return Array.isArray(task.tags) && task.tags.some((tag: string) => tags.has(String(tag).toLowerCase()));
}

function shouldRequireReview(task: any) {
  return hasAnyTag(task, REVIEW_TAGS);
}

function shouldRequireVisualReview(task: any) {
  return hasAnyTag(task, VISUAL_REVIEW_TAGS);
}

function findPendingEntryForTask(buildLog: { builds: any[] }, taskId: string) {
  return buildLog.builds.find((b: any) => b.taskId === taskId && PENDING_BUILD_STATUSES.has(b.status));
}

function findActiveEntryForExecutionKey(buildLog: { builds: any[] }, executionKey: string) {
  return buildLog.builds.find((b: any) => b.executionKey === executionKey && ACTIVE_BUILD_STATUSES.has(b.status));
}

function nextQueuedTaskId(buildLog: { builds: any[] }, executionKey: string) {
  const queued = buildLog.builds
    .filter((b: any) => b.executionKey === executionKey && b.status === "queued")
    .sort((a: any, b: any) => new Date(a.queuedAt || a.startedAt || 0).getTime() - new Date(b.queuedAt || b.startedAt || 0).getTime());
  return queued[0]?.taskId || null;
}

function summarizeOutput(error: Error | null, stdout: string, stderr: string) {
  const raw = error ? `${stderr || stdout || error.message}` : `${stdout || stderr || "Build completed successfully"}`;
  return raw.slice(-1500);
}

function sendSystemEvent(text: string) {
  execFile("openclaw", ["system", "event", "--text", text, "--mode", "now"], () => {});
}

function hydrateTaskFromPendingEntry(task: any, entry: any, executionKey: string) {
  const pendingState = entry.status === "queued" ? "queued" : entry.status === "spawning" ? "spawning" : "running";
  task.buildState = pendingState;
  task.activeBuildId = entry.id;
  task.buildExecutionKey = executionKey;
  task.buildTriggeredAt = task.buildTriggeredAt || entry.startedAt || entry.queuedAt || new Date().toISOString();
  task.buildQueuedAt = entry.queuedAt || task.buildQueuedAt;
  task.buildStartedAt = entry.runningAt || task.buildStartedAt;

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
}

function comparePriority(a: any, b: any) {
  const pa = PRIORITY_ORDER[a.priority] ?? 9;
  const pb = PRIORITY_ORDER[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  return new Date(a.created || 0).getTime() - new Date(b.created || 0).getTime();
}

/**
 * Autonomous task advancement:
 * 1. on-deck → in-progress when build capacity is available for that execution key
 * 2. backlog → on-deck when the on-deck queue for a project is below threshold
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

  // Group tasks by project
  const byProject = new Map<string, any[]>();
  for (const task of tasks) {
    const proj = task.project || "unscoped";
    if (!byProject.has(proj)) byProject.set(proj, []);
    byProject.get(proj)!.push(task);
  }

  for (const [, projectTasks] of byProject) {
    const onDeck = projectTasks.filter((t: any) => t.status === "on-deck").sort(comparePriority);
    const backlog = projectTasks.filter((t: any) => t.status === "backlog").sort(comparePriority);
    const inProgress = projectTasks.filter((t: any) => t.status === "in-progress");

    // Step 1: on-deck → in-progress if no active/pending build for this execution key
    if (onDeck.length > 0) {
      const candidate = onDeck[0];
      const { executionKey } = getProjectMeta(candidate, projects);
      const hasActiveBuild = findActiveEntryForExecutionKey(buildLog, executionKey);
      const hasInProgressBuild = inProgress.some(
        (t: any) => findPendingEntryForTask(buildLog, t.id)
      );

      if (!hasActiveBuild && !hasInProgressBuild) {
        candidate.status = "in-progress";
        candidate.updated = now;
        promoted.push(candidate.id);
        changed = true;
      }
    }

    // Step 2: backlog → on-deck if on-deck count is below threshold
    const currentOnDeckCount = projectTasks.filter((t: any) => t.status === "on-deck").length;
    const slotsAvailable = MAX_ON_DECK_PER_PROJECT - currentOnDeckCount;

    if (slotsAvailable > 0 && backlog.length > 0) {
      const toAdvance = backlog.slice(0, slotsAvailable);
      for (const task of toAdvance) {
        task.status = "on-deck";
        task.updated = now;
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
    return { skipped: true, recoveredTaskIds: [] as string[], hydratedTaskIds: [] as string[], advancedTaskIds: [] as string[], promotedTaskIds: [] as string[] };
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
          tasksToKick.add(task.id);
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
    }

    // Autonomous task advancement
    const advancement = advanceTasks(tasks, projects, buildLog);
    if (advancement.changed) changed = true;
    for (const id of advancement.promoted) tasksToKick.add(id);

    if (changed) {
      writeTasks(tasks);
    }

    return {
      recoveredTaskIds,
      hydratedTaskIds,
      advancedTaskIds: advancement.advanced,
      promotedTaskIds: advancement.promoted,
      taskIdsToKick: Array.from(tasksToKick),
    };
  });

  for (const taskId of sweep.taskIdsToKick) {
    await queueOrStartBuild(taskId, { source: options?.source || "reconcile" });
  }

  return {
    skipped: false,
    recoveredTaskIds: sweep.recoveredTaskIds,
    hydratedTaskIds: sweep.hydratedTaskIds,
    advancedTaskIds: sweep.advancedTaskIds,
    promotedTaskIds: sweep.promotedTaskIds,
  };
}

async function updateRunningState(buildId: string, taskId: string) {
  await withFactoryLock(async () => {
    const buildLog = readBuildLog();
    const tasks = readTasks();
    const entry = buildLog.builds.find((b: any) => b.id === buildId);
    const task = tasks.find((t: any) => t.id === taskId);

    if (entry && entry.status === "spawning") {
      entry.status = "running";
      entry.runningAt = new Date().toISOString();
      writeBuildLog(buildLog);
    }

    if (task && ["spawning", "queued"].includes(task.buildState)) {
      task.buildState = "running";
      task.buildStartedAt = new Date().toISOString();
      task.updated = new Date().toISOString();
      writeTasks(tasks);
    }
  });
}

async function finalizeBuild(buildId: string, taskId: string, success: boolean, output: string) {
  let nextTaskId: string | null = null;
  let notifyText = "";

  await withFactoryLock(async () => {
    const buildLog = readBuildLog();
    const tasks = readTasks();
    const entry = buildLog.builds.find((b: any) => b.id === buildId);
    const task = tasks.find((t: any) => t.id === taskId);

    if (!entry || !task) return;

    const now = new Date().toISOString();
    entry.status = success ? "completed" : "failed";
    entry.completedAt = now;
    entry.output = output.slice(-1500);

    task.updated = now;
    task.buildOutput = output.slice(-1500);
    task.buildCompletedAt = now;
    clearTransientBuildTracking(task);

    if (success) {
      task.buildState = "completed";
      task.buildError = null;

      if (shouldRequireReview(task)) {
        task.status = "review";
        task.reviewRequired = true;
        task.reviewStatus = "pending";
        task.reviewRequestedAt = now;

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

        notifyText = `✅ Task ready for review: ${String(task.title || taskId).replace(/"/g, "'")}`;
      } else {
        task.status = "done";
        task.reviewRequired = false;
        task.reviewStatus = "not-needed";
        task.completedAt = now;
        notifyText = `✅ Task completed: ${String(task.title || taskId).replace(/"/g, "'")}`;
      }
    } else {
      task.status = "in-progress";
      task.buildState = "failed";
      task.buildError = output.slice(-1500);
      notifyText = `❌ Task failed: ${String(task.title || taskId).replace(/"/g, "'")} — check build log`;
    }

    writeBuildLog(buildLog);
    writeTasks(tasks);

    nextTaskId = nextQueuedTaskId(buildLog, entry.executionKey);
  });

  if (notifyText) sendSystemEvent(notifyText);
  if (nextTaskId) {
    queueOrStartBuild(nextTaskId, { source: `post-build:${buildId}` }).catch((err) => {
      console.error("Failed to auto-start queued task:", err);
    });
    return;
  }

  reconcileBuildQueue({ source: `post-build:${buildId}`, force: true }).catch((err) => {
    console.error("Failed to auto-advance task queue:", err);
  });
}

function spawnBuildProcess(task: any, buildEntry: any, projectName: string, projectDir: string) {
  const executor = selectBuildExecutor(buildEntry.routing, task, projectName);

  sendSystemEvent(`🏭 Spawning agent for task: ${String(task.title || task.id).replace(/"/g, "'")} [${executor.actualModelName}]`);

  const child = execFile(
    executor.command,
    executor.args,
    { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 },
    (error, stdout, stderr) => {
      const output = summarizeOutput(error, stdout, stderr);
      const withExecutorNote = executor.fallbackReason
        ? `${executor.fallbackReason}\n\n${output}`
        : output;
      finalizeBuild(buildEntry.id, task.id, !error, withExecutorNote).catch((err) => {
        console.error("Error finalizing build:", err);
      });
    }
  );

  child.on("spawn", () => {
    updateRunningState(buildEntry.id, task.id).catch((err) => {
      console.error("Error marking build running:", err);
    });
  });

  child.on("error", (err) => {
    finalizeBuild(buildEntry.id, task.id, false, err.message).catch((finalizeErr) => {
      console.error("Error finalizing failed spawn:", finalizeErr);
    });
  });
}

export async function queueOrStartBuild(taskId: string, options?: { source?: string }) {
  const decision = await withFactoryLock(async () => {
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
    const existing = findPendingEntryForTask(buildLog, taskId);

    if (existing) {
      if (existing.status === "queued" && !active) {
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
      status: active ? "queued" : "spawning",
      queuedAt: active ? now : null,
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
        fallbackReason: executor.fallbackReason || null,
      },
    };

    buildLog.builds.unshift(buildEntry);

    task.buildState = active ? "queued" : "spawning";
    task.buildQueuedAt = active ? now : undefined;
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
      kind: active ? ("queued" as const) : ("started" as const),
      task: { ...task },
      build: buildEntry,
      projectName,
      projectDir,
    };
  });

  if (decision.kind === "started") {
    spawnBuildProcess(decision.task, decision.build, decision.projectName, decision.projectDir);
  }

  return decision;
}

export async function retryBuild(taskId: string, options?: { source?: string }) {
  await withFactoryLock(async () => {
    const tasks = readTasks();
    const task = tasks.find((t: any) => t.id === taskId);
    if (!task) return;

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
      task.status = "in-progress";
    }
    writeTasks(tasks);
  });

  return queueOrStartBuild(taskId, { source: options?.source || "retry" });
}
