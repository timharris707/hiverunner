import { createCompany, hardDeleteCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { enqueueWakeup, executeHeartbeatRun, tick } from "@/lib/orchestration/engine/engine";
import { upsertCompanyRuntime } from "@/lib/orchestration/runtime-registry";
import { createProject, createProjectAgent, createTask } from "@/lib/orchestration/service";
import { updateDevExecutionTestMode } from "@/lib/orchestration/service/dev-execution-test-mode";
import { updateCompanyHiringGovernanceSettings } from "@/lib/orchestration/service/hiring-governance";

type StressOptions = {
  cleanup: boolean;
  maxMinutes: number;
  taskPrefix: string;
};

type CompanyRow = {
  id: string;
  slug: string;
  company_code?: string | null;
};

type TaskRow = {
  task_key: string;
  title: string;
  status: string;
  assignee: string | null;
};

type RunRow = {
  agent: string;
  provider: string;
  status: string;
  duration_ms: number | null;
  error: string | null;
};

const db = getOrchestrationDb();

process.env.PORT = process.env.PORT || "3010";
process.env.MC_DEV_EXECUTION_TEST_MODE = "1";
process.env.MC_SWEEP_INTERVAL_MS = process.env.MC_SWEEP_INTERVAL_MS || "1000";
process.env.MC_TICK_MAX_CONCURRENT = process.env.MC_TICK_MAX_CONCURRENT || "6";

function parseArgs(argv: string[]): StressOptions {
  const maxMinutesArg = argv.find((arg) => arg.startsWith("--max-minutes="));
  const maxMinutes = maxMinutesArg
    ? Math.max(1, Number.parseInt(maxMinutesArg.split("=")[1] ?? "", 10) || 45)
    : 45;
  const taskPrefixArg = argv.find((arg) => arg.startsWith("--task-prefix="));
  return {
    cleanup: !argv.includes("--keep"),
    maxMinutes,
    taskPrefix: taskPrefixArg?.split("=")[1]?.trim() || "qa-software-lab",
  };
}

function log(label: string, value?: unknown): void {
  if (value === undefined) {
    console.log(label);
    return;
  }
  console.log(label, JSON.stringify(value, null, 2));
}

function configureRuntime(input: {
  companyId: string;
  agentId: string;
  provider: string;
  model: string | null;
  command: string | null;
  displayName: string;
}): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE agents
     SET adapter_type = ?,
         model = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(input.provider, input.model, now, input.agentId);
  db.prepare(
    `INSERT INTO agent_runtime_state (agent_id, company_id, adapter_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET adapter_type = excluded.adapter_type, updated_at = excluded.updated_at`,
  ).run(input.agentId, input.companyId, input.provider, now, now);
  upsertCompanyRuntime({
    companyIdOrSlug: input.companyId,
    agentId: input.agentId,
    provider: input.provider,
    runtimeSlug: `${input.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${input.provider}`,
    displayName: input.displayName,
    runtimeKind: "cli",
    scope: "agent",
    command: input.command,
    status: "online",
    metadata: {
      source: "hiverunner-software-stress",
      commandPath: input.command,
      model: input.model,
    },
  });
}

function summarize(companyId: string): { tasks: TaskRow[]; runs: RunRow[] } {
  const tasks = db.prepare(
    `SELECT
       t.task_key,
       t.title,
       t.status,
       a.name AS assignee
     FROM tasks t
     LEFT JOIN agents a ON a.id = t.assignee_agent_id
     WHERE t.company_id = ?
       AND t.archived_at IS NULL
     ORDER BY t.task_number ASC`,
  ).all(companyId) as TaskRow[];

  const runs = db.prepare(
    `SELECT
       a.name AS agent,
       er.provider,
       er.status,
       er.duration_ms,
       er.error_message AS error
     FROM execution_runs er
     JOIN agents a ON a.id = er.agent_id
     WHERE a.company_id = ?
     ORDER BY er.created_at ASC`,
  ).all(companyId) as RunRow[];

  return { tasks, runs };
}

function boardState(companyId: string): {
  openTaskCount: number;
  activeRunCount: number;
  activeWakeCount: number;
} {
  const openTasks = db.prepare(
    `SELECT COUNT(*) AS count
     FROM tasks
     WHERE company_id = ?
       AND archived_at IS NULL
       AND status IN ('to-do','in_progress','review','blocked')`,
  ).get(companyId) as { count: number };
  const activeRuns = db.prepare(
    `SELECT COUNT(*) AS count
     FROM heartbeat_runs
     WHERE company_id = ?
       AND status IN ('queued','running')`,
  ).get(companyId) as { count: number };
  const activeWakes = db.prepare(
    `SELECT COUNT(*) AS count
     FROM agent_wakeup_requests
     WHERE company_id = ?
       AND status IN ('queued','claimed')`,
  ).get(companyId) as { count: number };
  return {
    openTaskCount: openTasks.count,
    activeRunCount: activeRuns.count,
    activeWakeCount: activeWakes.count,
  };
}

function hasTerminalBoard(companyId: string): boolean {
  const state = boardState(companyId);
  return state.openTaskCount === 0 && state.activeRunCount === 0 && state.activeWakeCount === 0;
}

function assertDirectiveChildrenAreLinked(companyId: string): void {
  const row = db.prepare(
    `SELECT COUNT(*) AS count
     FROM tasks t
     WHERE t.company_id = ?
       AND t.archived_at IS NULL
       AND t.task_number > 1
       AND t.parent_task_id IS NULL`,
  ).get(companyId) as { count: number };

  if (row.count > 0) {
    throw new Error(`Stress run created ${row.count} unparented worker task(s).`);
  }
}

function assertStressInvariants(companyId: string): void {
  assertDirectiveChildrenAreLinked(companyId);
}

async function driveCompanyUntilTerminal(company: CompanyRow, options: StressOptions): Promise<void> {
  const deadline = Date.now() + options.maxMinutes * 60_000;
  let idleSweeps = 0;
  let tickIndex = 0;

  while (Date.now() < deadline) {
    tickIndex += 1;
    const result = await tick(db);
    const state = boardState(company.id);
    log(`[tick ${tickIndex}] ${result.status} claimed=${result.claimedCount}`, {
      runs: result.runs,
      sweep: result.sweep,
      state,
    });

    if (hasTerminalBoard(company.id)) return;

    const sweepRan = result.sweep != null;
    const hadSweepMovement = (result.sweep?.wakesEnqueued ?? 0) > 0 || (result.sweep?.wakesCoalesced ?? 0) > 0;
    if (sweepRan && !result.claimed && !hadSweepMovement && state.activeRunCount === 0 && state.activeWakeCount === 0) {
      idleSweeps += 1;
    } else {
      idleSweeps = 0;
    }

    if (idleSweeps >= 8) {
      throw new Error("Stress run stalled: open tasks remain but no runs or sweep wakeups are moving.");
    }

    await new Promise((resolve) => setTimeout(resolve, state.activeRunCount > 0 ? 15_000 : 1500));
  }

  throw new Error(`Stress run exceeded ${options.maxMinutes} minute limit.`);
}

async function createStressCompany(options: StressOptions): Promise<CompanyRow> {
  const nowSlug = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
  const companySlug = `${options.taskPrefix}-${nowSlug}`;
  const companyName = `HiveRunner Software Stress ${nowSlug}`;

  const company = createCompany({
    name: companyName,
    slug: companySlug,
    description: "Disposable HiveRunner multi-provider software-company stress test.",
    status: "active",
    owner: {
      displayName: "Local Operator",
      email: "tim@example.local",
      role: "owner",
    },
  }).company;

  process.env.MC_SWEEP_COMPANIES = company.slug;
  updateCompanyHiringGovernanceSettings({
    companyIdOrSlug: company.id,
    autoApproveNewHires: true,
    db,
  });
  updateDevExecutionTestMode({
    companyIdOrSlug: company.id,
    enabled: true,
    durationMinutes: Math.min(120, Math.max(10, options.maxMinutes + 10)),
    actor: "codex-qa",
    note: "Disposable HiveRunner multi-provider software-company stress test.",
  }, db);

  const project = createProject({
    companyId: company.id,
    name: "Weather Edge Mini",
    description: "Build a small web-based weather decision surface in the company workspace.",
    color: "#0ea5e9",
    emoji: "W",
    status: "active",
  }).project;

  const ceo = createProjectAgent({
    projectId: project.id,
    companyId: company.id,
    name: "Orion",
    emoji: "O",
    role: "CEO",
    personality: "Practical software-company CEO. Hire specialists, delegate clearly, keep tasks scoped, and require proof.",
    model: "openai-codex/gpt-5.5",
    skills: ["orchestration", "delegation", "software planning", "quality control"],
    status: "idle",
  }).agent;

  configureRuntime({
    companyId: company.id,
    agentId: ceo.id,
    provider: "codex",
    model: "openai-codex/gpt-5.5",
    command: "codex",
    displayName: "Orion Codex Runtime",
  });

  const directive = createTask({
    projectId: project.id,
    title: "CEO orchestration stress test: build Weather Edge Mini",
    description: [
      "You are the CEO of a disposable HiveRunner software company. Do not do the project yourself.",
      "Hire exactly six runnable agents using top-level runtimeProvider/model fields, then create one scoped task for each hired agent.",
      "Use this team mix:",
      "1. Backend engineer — runtimeProvider codex, model openai-codex/gpt-5.5.",
      "2. Frontend engineer — runtimeProvider anthropic, model anthropic/claude-opus-4-7.",
      "3. Research analyst — runtimeProvider gemini, model google/gemini-2.5-flash.",
      "4. QA lead — runtimeProvider hermes. Omit model if you are unsure; Hermes should use its configured default.",
      "5. Integration engineer — runtimeProvider codex, model openai-codex/gpt-5.4.",
      "6. Runtime analyst — runtimeProvider anthropic, model anthropic/claude-haiku-4-5.",
      "Project: build a tiny local web-based Weather Edge Mini prototype inside the company project workspace.",
      "Expected deliverable: simple HTML/CSS/JS or similar static artifact with mock weather signals, risk levels, and an operator-readable summary.",
      "Tasks should be basic but real: research inputs, backend/data shape, frontend UI, integration wiring, runtime assumptions, and QA verification.",
      "This is a mocked prototype, not current weather research. If web search or external data tools are unavailable, agents should proceed from general weather-domain assumptions and state those assumptions instead of blocking.",
      "Every output must be mc-action blocks. Include hire_agent actions first, then create_task actions assigned by exact agent name, then update this task to review.",
    ].join("\n"),
    priority: "P1",
    type: "directive",
    status: "in-progress",
    assignee: ceo.id,
    labels: ["qa-stress", "disposable", "multi-provider"],
    createdBy: "codex",
  }).task;

  const wake = enqueueWakeup({
    agentId: ceo.id,
    companyId: company.id,
    source: "explicit",
    reason: "multi-provider software company stress test",
    invocationSource: "on_demand",
    contextSnapshot: {
      wakeSource: "qa-stress-test",
      wakeReason: "multi_provider_software_company",
      taskId: directive.id,
    },
  }, db);

  log("[setup]", {
    companyId: company.id,
    companySlug: company.slug,
    companyCode: company.companyCode,
    projectId: project.id,
    ceoId: ceo.id,
    directiveTask: directive.taskKey,
    heartbeatRunId: wake.heartbeatRunId,
  });

  const ceoResult = await executeHeartbeatRun(wake.heartbeatRunId, db);
  log("[ceo-result]", ceoResult);
  log("[after-ceo]", summarize(company.id));

  return {
    id: company.id,
    slug: company.slug,
    company_code: company.companyCode,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let company: CompanyRow | null = null;

  try {
    company = await createStressCompany(options);
    await driveCompanyUntilTerminal(company, options);
    assertStressInvariants(company.id);
    log("[final-summary]", summarize(company.id));
  } finally {
    if (company) {
      updateDevExecutionTestMode({
        companyIdOrSlug: company.id,
        enabled: false,
        actor: "codex-qa",
      }, db);
      if (options.cleanup) {
        log("[cleanup]", hardDeleteCompany(company.slug));
      } else {
        log("[kept]", { companySlug: company.slug, companyId: company.id });
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
