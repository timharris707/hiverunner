/**
 * Fast-lane model bake-off driver (first real use of the experiments subsystem).
 *
 * Creates one experiment per frozen corpus source (7 completed-run traces +
 * 1 eval case), each with 5 runner_model variants, then executes attempts by
 * spawning the per-provider external runner against a snapshot workspace
 * lease. Usage, transcript events, and comparison snapshots persist through
 * the standard experiment tables.
 *
 * Target the exec-dev lane by pointing ORCHESTRATION_DB_PATH at
 * data-exec-dev/orchestration.db before launching:
 *
 *   ORCHESTRATION_DB_PATH="$PWD/data-exec-dev/orchestration.db" \
 *     node ./scripts/run-ts-test.mjs scripts/run-fast-lane-bakeoff.ts -- --smoke
 *
 * Modes:
 *   --smoke              1 source x all variants x 1 attempt (pipeline proof)
 *   --full               8 sources x 5 variants x --repeats attempts
 *   --task-keys A,B      restrict sources
 *   --variants k1,k2     restrict variant keys
 *   --repeats N          attempts per variant (default 3)
 *   --timebox-minutes N  per-attempt timebox (default 40)
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  approveExperimentVariants,
  createExperimentDraft,
  type ExperimentRecord,
} from "@/lib/orchestration/experiments";
import {
  runExperimentAttempt,
  type ExperimentAttemptExecutorContext,
  type ExperimentAttemptExecutorResult,
} from "@/lib/orchestration/experiment-attempt-runner";

type ModelSpec = {
  key: string;
  name: string;
  provider: "codex" | "anthropic" | "gemini";
  model: string;
  /**
   * Per-attempt gemini CLI auth override. The CLI's user settings pin
   * oauth-personal (Code Assist), whose tier 404s on gemini-3.5 generation
   * even though the API-key surface serves it (verified live 2026-06-11).
   * Workspace-level .gemini/settings.json wins over user settings, so the
   * executor drops one into the snapshot workspace — scoped to that attempt;
   * OAuth cells in the same matrix are untouched.
   */
  workspaceAuth?: "gemini-api-key";
};

// Lineup verified live 2026-06-11: gpt-5-mini is rejected on ChatGPT-account
// codex (gpt-5.4-mini replaces it). gemini-3.5-flash is served by the
// API-key surface but NOT by the CLI's oauth-personal tier (generation
// 404s under both bare and -preview ids) — so it runs with the
// workspaceAuth override below, and gemini-3-flash stays as the
// oauth-surface flash baseline. Cross-surface caveat belongs in the report.
const MODELS: ModelSpec[] = [
  { key: "spark-gpt-5-3", name: "Codex Spark (gpt-5.3-codex-spark)", provider: "codex", model: "gpt-5.3-codex-spark" },
  { key: "haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic", model: "claude-haiku-4-5" },
  { key: "mini-gpt-5-4", name: "GPT-5.4 Mini", provider: "codex", model: "gpt-5.4-mini" },
  { key: "flash-gemini-3", name: "Gemini 3 Flash", provider: "gemini", model: "gemini-3-flash" },
  { key: "flash-gemini-3-5", name: "Gemini 3.5 Flash", provider: "gemini", model: "gemini-3.5-flash", workspaceAuth: "gemini-api-key" },
  { key: "control-gpt-5-5", name: "Control (gpt-5.5)", provider: "codex", model: "gpt-5.5" },
];

const RUNNER_BY_PROVIDER: Record<ModelSpec["provider"], string> = {
  anthropic: "hiverunner-claude-runner.mjs",
  gemini: "hiverunner-gemini-runner.mjs",
  codex: "hiverunner-symphony-runner.mjs",
};

const CORPUS_TASK_KEYS = ["INS-264", "INS-266", "INS-277", "INS-260", "INS-129", "INS-147", "INS-184"];
const EVAL_CASE_TASK_KEY = "INS-278";
const COMPANY_SLUG = "insight";
const BAKEOFF_VERSION = "fast-lane-bakeoff-v1";

type CliOptions = {
  smoke: boolean;
  full: boolean;
  taskKeys: string[] | null;
  variantKeys: string[] | null;
  repeats: number;
  timeboxMinutes: number;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    smoke: false,
    full: false,
    taskKeys: null,
    variantKeys: null,
    repeats: 3,
    timeboxMinutes: 40,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--smoke") options.smoke = true;
    else if (arg === "--full") options.full = true;
    else if (arg === "--task-keys") options.taskKeys = String(argv[++index] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    else if (arg === "--variants") options.variantKeys = String(argv[++index] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    else if (arg === "--repeats") options.repeats = Math.max(1, Number.parseInt(String(argv[++index] ?? "3"), 10) || 3);
    else if (arg === "--timebox-minutes") options.timeboxMinutes = Math.max(5, Number.parseInt(String(argv[++index] ?? "40"), 10) || 40);
  }
  if (!options.smoke && !options.full) {
    console.error("Pass --smoke or --full (see header comment for usage).");
    process.exit(1);
  }
  return options;
}

// WAL-inode sentinel (2026-06-11 split-journal incident): the on-disk WAL was
// swapped out from under a live driver once (mechanism not reproduced in two
// controlled tests); after a swap, every write lands in an orphaned journal
// and cross-checkpoints corrupt the DB file. This guard turns any recurrence
// into a loud abort — the idempotent re-run resumes cleanly.
const RESOLVED_DB_PATH = process.env.ORCHESTRATION_DB_PATH ?? path.join(process.cwd(), "data", "orchestration.db");
let walInodeBaseline: number | null = null;
function walInode(): number | null {
  try { return fs.statSync(`${RESOLVED_DB_PATH}-wal`).ino; } catch { return null; }
}
function assertWalStable(label: string): void {
  const current = walInode();
  if (walInodeBaseline === null) {
    if (current !== null) walInodeBaseline = current;
    return;
  }
  if (current === null || current !== walInodeBaseline) {
    console.error(
      `[bakeoff] FATAL: WAL inode changed ${walInodeBaseline} -> ${current ?? "deleted"} at ${label}; ` +
      "aborting to avoid split-journal corruption. Re-run the same command to resume.",
    );
    process.exit(2);
  }
}

// Bare script spawns don't get Next's env files, and a missing key would
// silently block every gemini-3.5 cell at preflight (fire_basket pattern:
// self-load, then fail loud at startup rather than per-attempt).
function ensureGoogleApiKey(): void {
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY) return;
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const match = raw.match(/^GOOGLE_AI_API_KEY=("?)(.+?)\1\s*$/m);
    if (match) process.env.GOOGLE_AI_API_KEY = match[2];
  } catch {
    // handled by the startup presence check
  }
}

type CorpusSource = {
  taskKey: string;
  source: { kind: "run_trace" | "eval_case"; id: string };
  task: { id: string; task_key: string; title: string; description: string };
};

function loadCorpusSources(db: ReturnType<typeof getOrchestrationDb>, filterKeys: string[] | null): CorpusSource[] {
  const sources: CorpusSource[] = [];
  const taskByKey = db.prepare(
    "SELECT id, task_key, title, description FROM tasks WHERE task_key = ? LIMIT 1",
  );
  // Exclude experiment-attempt runs: bake-off cells complete as the matrix
  // fills, and without this filter later-created experiments would source
  // their run_trace lineage from earlier bake-off runs instead of the frozen
  // production run.
  const latestRunForTask = db.prepare(
    "SELECT id FROM execution_runs WHERE task_id = ? AND status = 'completed' " +
    "AND (session_id IS NULL OR session_id NOT LIKE 'experiment-attempt:%') " +
    "ORDER BY completed_at DESC LIMIT 1",
  );
  const evalCaseForTask = db.prepare(
    "SELECT id, source_task_id FROM eval_cases WHERE source_task_key = ? LIMIT 1",
  );

  for (const taskKey of CORPUS_TASK_KEYS) {
    if (filterKeys && !filterKeys.includes(taskKey)) continue;
    const task = taskByKey.get(taskKey) as CorpusSource["task"] | undefined;
    if (!task) throw new Error(`Corpus task ${taskKey} not found in target DB`);
    const run = latestRunForTask.get(task.id) as { id: string } | undefined;
    if (!run) throw new Error(`No completed run found for corpus task ${taskKey}`);
    sources.push({ taskKey, source: { kind: "run_trace", id: run.id }, task });
  }

  if (!filterKeys || filterKeys.includes(EVAL_CASE_TASK_KEY)) {
    const evalCase = evalCaseForTask.get(EVAL_CASE_TASK_KEY) as { id: string; source_task_id: string | null } | undefined;
    if (!evalCase) throw new Error(`Eval case for ${EVAL_CASE_TASK_KEY} not found in target DB`);
    const task = (evalCase.source_task_id
      ? db.prepare("SELECT id, task_key, title, description FROM tasks WHERE id = ? LIMIT 1").get(evalCase.source_task_id)
      : taskByKey.get(EVAL_CASE_TASK_KEY)) as CorpusSource["task"] | undefined;
    if (!task) throw new Error(`Source task for eval case ${EVAL_CASE_TASK_KEY} not found`);
    sources.push({ taskKey: EVAL_CASE_TASK_KEY, source: { kind: "eval_case", id: evalCase.id }, task });
  }

  return sources;
}

// The experiments subsystem caps variantCap at 3, so the 5-model matrix maps
// to one experiment per (source, model) cell: 8 sources x 5 models = 40
// experiments, each with a single runner_model variant and `repeats` attempts.
function ensureExperiment(
  db: ReturnType<typeof getOrchestrationDb>,
  corpus: CorpusSource,
  model: ModelSpec,
  repeats: number,
  timeboxMinutes: number,
): ExperimentRecord {
  const experiment = createExperimentDraft({
    companyIdOrSlug: COMPANY_SLUG,
    source: corpus.source,
    objective: "reduce_cost",
    definitionOfBetter:
      "Same-or-better completion quality than the gpt-5.5 control at lower duration and fresh-input token cost on a frozen fast-lane task.",
    hypothesis:
      `${model.name} matches gpt-5.5 quality on fast-lane work at a fraction of the latency and cost.`,
    workspaceMode: "snapshot",
    // attemptLimit is a cap, not a target — and idempotent reuse keeps the
    // limits stored at first creation, so a smoke-created experiment with
    // attemptLimit 1 would reject the full run's attempts 2-3. Always create
    // with headroom for the full 3-repeat matrix (subsystem max is 10).
    limits: { variantCap: 1, attemptLimit: Math.min(10, Math.max(3, repeats)), timeboxMinutes },
    variants: [{
      key: model.key,
      name: model.name,
      changeType: "runner_model" as const,
      plannedChange: { runnerProvider: model.provider, runnerModel: model.model },
    }],
    idempotencyKey: `${BAKEOFF_VERSION}:${corpus.taskKey}:${model.key}`,
    createdByUserId: "tim",
  }, db);

  return approveExperimentVariants({
    companyIdOrSlug: COMPANY_SLUG,
    experimentId: experiment.id,
    variantKeys: [model.key],
    approvedByUserId: "tim",
  }, db);
}

function lastJsonLine(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // keep scanning upward; runners emit a single JSON object on the last line
    }
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function runRunner(input: {
  runnerScript: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
  signal: AbortSignal;
  envOverrides?: Record<string, string>;
}): Promise<{ stdout: string; stderr: string; exitCode: number | null; durationMs: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [path.join(process.cwd(), "scripts", input.runnerScript)], {
      cwd: process.cwd(),
      env: { ...process.env, ...(input.envOverrides ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, input.timeoutMs);
    const onAbort = () => {
      child.kill("SIGTERM");
    };
    input.signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      input.signal.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, exitCode, durationMs: Date.now() - startedAt, timedOut });
    });
    child.stdin.write(JSON.stringify(input.payload));
    child.stdin.end();
  });
}

function buildExecutor(corpus: CorpusSource, model: ModelSpec, timeoutMs: number) {
  return async (context: ExperimentAttemptExecutorContext): Promise<ExperimentAttemptExecutorResult> => {
    const payload = {
      schema: "hiverunner.symphony.execution.v1",
      runId: `bakeoff-${context.experiment.id.slice(0, 8)}-${context.variant.key}-${context.attemptNumber}`,
      runnerModel: model.model,
      task: {
        id: corpus.task.id,
        key: corpus.task.task_key,
        title: corpus.task.title,
        description: corpus.task.description,
        project: { name: "HiveRunner" },
        company: { name: "Insight" },
      },
      workspace: {
        cwd: context.workspace.cwd,
        sourceWorkspaceRoot: context.workspace.cwd,
        companyWorkspaceRoot: context.workspace.cwd,
        additionalWritableDirs: [],
        runtimeCapabilities: { trustedLocalExecution: true, capabilities: [] },
      },
      prompt: [
        corpus.task.description || corpus.task.title,
        "",
        "Complete this task inside the provided workspace.",
        "When finished, summarize what you changed and why.",
      ].join("\n"),
    };

    const envOverrides: Record<string, string> = {};
    if (model.provider === "gemini") {
      // Default 120s no-output watchdog killed flash cells on heavy sources
      // where the model thinks silently past 2 minutes; the 40-min timebox
      // still bounds the attempt.
      envOverrides.HIVERUNNER_GEMINI_NO_OUTPUT_TIMEOUT_MS = "600000";
    }
    if (model.workspaceAuth === "gemini-api-key") {
      const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
      if (!key) throw new Error(`${model.key} requires a Google API key (GEMINI_API_KEY/GOOGLE_AI_API_KEY) for workspaceAuth`);
      envOverrides.GEMINI_API_KEY = key;
      const settingsDir = path.join(context.workspace.cwd, ".gemini");
      fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(
        path.join(settingsDir, "settings.json"),
        JSON.stringify({ security: { auth: { selectedType: "gemini-api-key" } } }),
      );
    }

    const result = await runRunner({
      runnerScript: RUNNER_BY_PROVIDER[model.provider],
      payload,
      timeoutMs,
      signal: context.signal,
      envOverrides,
    });
    const parsed = lastJsonLine(result.stdout) ?? {};
    const usage = (parsed.usage && typeof parsed.usage === "object" ? parsed.usage : {}) as Record<string, unknown>;
    // A blocked runner preflight (e.g. gemini 3.5 model gating) exits 0 with
    // no error field but never generates — record it as a failed attempt, not
    // a 0-token "success" that the idempotent skip would then never replay.
    const preflight = (parsed.preflight && typeof parsed.preflight === "object" ? parsed.preflight : null) as Record<string, unknown> | null;
    const preflightBlocked = preflight !== null && preflight.status !== "passed" && preflight.status !== "skipped";
    const errorMessage = preflightBlocked
      ? `Runner preflight blocked (${String(preflight?.terminalErrorClass ?? "unknown")}): ${String(preflight?.stderrTail ?? "")}`.trim()
      : typeof parsed.error === "string" && parsed.error
        ? parsed.error
        : result.timedOut
          ? `Runner timed out after ${timeoutMs}ms`
          : result.exitCode !== 0
            ? `Runner exited with code ${result.exitCode}`
            : null;
    const totalTokens = numberOrNull(parsed.totalTokens ?? usage.totalTokens) ?? 0;
    context.recordIteration({ tokens: totalTokens });

    return {
      status: errorMessage ? "failed" : "succeeded",
      resultText: typeof parsed.resultText === "string" ? parsed.resultText : "",
      errorMessage,
      metrics: {
        runnerProvider: model.provider,
        runnerModel: model.model,
        inputTokens: numberOrNull(parsed.inputTokens ?? usage.inputTokens),
        outputTokens: numberOrNull(parsed.outputTokens ?? usage.outputTokens),
        cacheReadInputTokens: numberOrNull(parsed.cacheReadInputTokens ?? usage.cacheReadInputTokens),
        totalTokens,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      },
      verification: { runnerExitCode: result.exitCode, runnerTimedOut: result.timedOut },
      transcriptEvents: Array.isArray(parsed.transcriptEvents) ? parsed.transcriptEvents : [],
    };
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = getOrchestrationDb();
  const dbPath = process.env.ORCHESTRATION_DB_PATH ?? "(default data/orchestration.db)";
  const sourceWorkspaceRoot = process.cwd();

  const selectedModels = MODELS.filter((model) => !options.variantKeys || options.variantKeys.includes(model.key));
  ensureGoogleApiKey();
  const googleKeyPresent = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY);
  console.log(`[bakeoff] google api key: ${googleKeyPresent ? "present" : "MISSING"}`);
  if (!googleKeyPresent && selectedModels.some((model) => model.workspaceAuth === "gemini-api-key")) {
    console.error("[bakeoff] fatal: selected lineup includes a workspaceAuth=gemini-api-key variant but no GEMINI_API_KEY/GOOGLE_AI_API_KEY is resolvable (.env.local)");
    process.exit(1);
  }
  let corpusSources = loadCorpusSources(db, options.taskKeys);
  let repeats = options.repeats;
  if (options.smoke) {
    corpusSources = corpusSources.slice(0, 1);
    repeats = 1;
  }

  const totalAttempts = corpusSources.length * selectedModels.length * repeats;
  console.log(`[bakeoff] db=${dbPath}`);
  console.log(`[bakeoff] sources=${corpusSources.map((item) => item.taskKey).join(",")}`);
  console.log(`[bakeoff] variants=${selectedModels.map((model) => model.key).join(",")}`);
  console.log(`[bakeoff] repeats=${repeats} totalAttempts=${totalAttempts}`);

  const summary: Array<{ taskKey: string; variant: string; attempt: number; status: string; durationMs: number | null; totalTokens: number | null }> = [];
  let infraFailures = 0;

  for (const corpus of corpusSources) {
    for (const model of selectedModels) {
      const experiment = ensureExperiment(db, corpus, model, repeats, options.timeboxMinutes);
      assertWalStable(`${corpus.taskKey} x ${model.key} cell start`);
      console.log(`[bakeoff] experiment ${experiment.id} ready for ${corpus.taskKey} x ${model.key} (${corpus.source.kind}:${corpus.source.id.slice(0, 8)})`);
      const existingAttempts = experiment.attempts.filter((attempt) =>
        attempt.variantId === experiment.variants.find((variant) => variant.key === model.key)?.id &&
        (attempt.status === "succeeded" || attempt.status === "failed" || attempt.status === "timed_out"));
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        if (existingAttempts.some((attempt) => attempt.attemptNumber === repeat)) {
          console.log(`[bakeoff] skip ${corpus.taskKey} ${model.key} attempt ${repeat} (already recorded)`);
          continue;
        }
        const label = `${corpus.taskKey} ${model.key} attempt ${repeat}/${repeats}`;
        console.log(`[bakeoff] start ${label}`);
        try {
          const attempt = await runExperimentAttempt({
            companyIdOrSlug: COMPANY_SLUG,
            experimentId: experiment.id,
            variantKey: model.key,
            attemptNumber: repeat,
            sourceWorkspaceRoot,
            runtimeLimits: {
              timeboxMs: options.timeboxMinutes * 60_000,
              maxIterations: 5,
              maxCostUsd: 50,
              // Gross-of-cache accounting: codex/gemini usage counts the full
              // re-read context every iteration, so heavy tasks "spend" tens
              // of millions while fresh usage stays small. 10M cancelled mini
              // cells mid-matrix (and a cancelled attempt bricks its variant:
              // 'cancelled' is not attempt-runnable). The timebox is the real
              // guard; keep this as a runaway backstop only.
              maxTokens: 100_000_000,
            },
            runnerProvider: model.provider,
            runnerModel: model.model,
            executor: buildExecutor(corpus, model, options.timeboxMinutes * 60_000),
          }, db);
          const runRow = db.prepare(
            "SELECT duration_ms, token_usage_json FROM execution_runs WHERE id = ? LIMIT 1",
          ).get(attempt.executionRunId) as { duration_ms: number | null; token_usage_json: string | null } | undefined;
          let runTokens: number | null = null;
          try {
            runTokens = numberOrNull(JSON.parse(runRow?.token_usage_json ?? "{}")?.totalTokens);
          } catch {
            runTokens = null;
          }
          summary.push({
            taskKey: corpus.taskKey,
            variant: model.key,
            attempt: repeat,
            status: attempt.status,
            durationMs: numberOrNull(runRow?.duration_ms),
            totalTokens: runTokens,
          });
          console.log(`[bakeoff] done  ${label}: ${attempt.status} run=${attempt.executionRunId}`);
          assertWalStable(`${label} end`);
        } catch (error) {
          infraFailures += 1;
          const message = error instanceof Error ? error.message : String(error);
          summary.push({ taskKey: corpus.taskKey, variant: model.key, attempt: repeat, status: `infra_error: ${message.slice(0, 80)}`, durationMs: null, totalTokens: null });
          console.error(`[bakeoff] FAIL ${label}: ${message}`);
        }
      }
    }
  }

  console.log("\n[bakeoff] summary:");
  for (const row of summary) {
    const duration = row.durationMs === null ? "-" : `${Math.round(row.durationMs / 1000)}s`;
    const tokens = row.totalTokens === null ? "-" : String(row.totalTokens);
    console.log(`  ${row.taskKey}\t${row.variant}\tattempt ${row.attempt}\t${row.status}\t${duration}\t${tokens} tok`);
  }
  if (infraFailures > 0) {
    console.error(`[bakeoff] ${infraFailures} attempt(s) hit infrastructure errors`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[bakeoff] fatal:", error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
