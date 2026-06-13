/**
 * H3 — Memory bookends contract test.
 *
 * Covers:
 *  - designation-aware onboarding-asset bucket (companies.lead_agent_id beats
 *    the role string; heuristic only as fallback)
 *  - per-agent run-lesson append/read/dedupe on the voice-lane MEMORY.md
 *  - record_lesson mc-action dispatch + execution-run metadata proof
 *  - engine-enforced stub at run end (FIX 9/11 philosophy) with compact-run
 *    and agent-recorded exemptions
 *  - lessons injection + bookend instruction in buildHeartbeatPrompt
 *
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-agent-lessons.db \
 *   node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-agent-lessons.test.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createIsolatedOrchestrationWorkspace, resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${name}`);
      console.error(`    ${message}`);
    });
}

console.log("\nOrchestration Agent Lessons (H3 memory bookends) Contract Test\n");

async function run() {
  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);
  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-agent-lessons-",
  });

  try {
    const { createCompany } = await import("@/lib/orchestration/company-service");
    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { setCompanyLeadAgent } = await import("@/lib/orchestration/company-lead");
    const { resolveOnboardingAssetBucket } = await import("@/lib/orchestration/engine/onboarding-bucket");
    const {
      appendAgentRunLesson,
      buildAgentLessonsPromptSection,
      enforceLessonsBookendAtRunEnd,
      isLessonsBookendEligible,
      readAgentRunLessons,
      resolveAgentMemoryFilePath,
    } = await import("@/lib/orchestration/engine/agent-lessons");
    const { executeMcAction } = await import("@/lib/orchestration/engine/action-dispatcher");
    const { loadOnboardingAssets, buildHeartbeatPrompt, getOrCreateTaskSession } = await import("@/lib/orchestration/engine/engine");
    const { parseJson } = await import("@/lib/orchestration/engine/persistence");

    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);

    const company = createCompany({
      name: `Lessons Co ${Date.now()}`,
      description: "H3 fixture",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: "Lessons Project",
      description: "H3 fixture project",
      color: "#0ea5e9",
      emoji: "icon:sparkles",
      status: "active",
    }).project;

    const eagle = createProjectAgent({
      projectId: project.id,
      companyId: company.id,
      name: "Eagle",
      emoji: "icon:bird",
      role: "Eagle", // arbitrary operator title, no lead keywords
      personality: "Decisive",
      status: "idle",
      skills: [],
    }).agent;
    const ceoTitled = createProjectAgent({
      projectId: project.id,
      companyId: company.id,
      name: "Vanity CEO",
      emoji: "icon:crown",
      role: "CEO of Weather",
      personality: "Grand",
      status: "idle",
      skills: [],
    }).agent;
    const builder = createProjectAgent({
      projectId: project.id,
      companyId: company.id,
      name: "Ralph",
      emoji: "icon:wrench",
      role: "Backend Engineer",
      personality: "Methodical",
      status: "idle",
      skills: [],
    }).agent;
    const analyst = createProjectAgent({
      projectId: project.id,
      companyId: company.id,
      name: "Misty",
      emoji: "icon:cloud",
      role: "Meteorologist",
      personality: "Curious",
      status: "idle",
      skills: [],
    }).agent;

    const bucketContext = (agentId: string) => ({ db, companyId: company.id, agentId });

    await test("bucket falls back to role heuristic when no designation exists", () => {
      db.prepare("UPDATE companies SET lead_agent_id = NULL WHERE id = ?").run(company.id);
      assert.equal(resolveOnboardingAssetBucket("Eagle", bucketContext(eagle.id)), "default");
      assert.equal(resolveOnboardingAssetBucket("CEO of Weather", bucketContext(ceoTitled.id)), "ceo");
      assert.equal(resolveOnboardingAssetBucket("weather ceo"), "ceo", "legacy contextless call keeps heuristic");
    });

    await test("designation beats the role string in both directions", () => {
      setCompanyLeadAgent({ companyId: company.id, agentId: eagle.id }, db);
      assert.equal(resolveOnboardingAssetBucket("Eagle", bucketContext(eagle.id)), "ceo", "designated lead gets lead bucket despite arbitrary title");
      assert.equal(resolveOnboardingAssetBucket("CEO of Weather", bucketContext(ceoTitled.id)), "default", "CEO-titled non-lead must not get lead bucket once a designation exists");
    });

    await test("loadOnboardingAssets serves the lead bucket to a designated arbitrary-titled lead", () => {
      const assets = loadOnboardingAssets("eagle", bucketContext(eagle.id));
      assert.ok(assets["HEARTBEAT.md"], "designated lead must receive ceo/HEARTBEAT.md");
      assert.match(assets["HEARTBEAT.md"], /mc-action/);
      const vanity = loadOnboardingAssets("ceo of weather", bucketContext(ceoTitled.id));
      assert.ok(!vanity["SOUL.md"], "non-lead must not receive the ceo bucket's SOUL.md");
    });

    await test("lessons append/read roundtrip: newest first, duplicates skipped", () => {
      const first = appendAgentRunLesson(db, {
        companyId: company.id,
        agentId: builder.id,
        lesson: "Always run the focused parser tests before registering the artifact",
        source: "agent",
        taskKey: "LES-1",
        runId: "11111111-aaaa",
      });
      assert.equal(first.saved, true);
      const second = appendAgentRunLesson(db, {
        companyId: company.id,
        agentId: builder.id,
        lesson: "Migration edits need a rollback note in the same comment",
        source: "agent",
        taskKey: "LES-2",
        runId: "22222222-bbbb",
      });
      assert.equal(second.saved, true);
      const duplicate = appendAgentRunLesson(db, {
        companyId: company.id,
        agentId: builder.id,
        lesson: "Always run the focused parser tests before registering the artifact",
        source: "agent",
        taskKey: "LES-3",
        runId: "33333333-cccc",
      });
      assert.equal(duplicate.saved, false);
      assert.equal(duplicate.reason, "duplicate_lesson");

      const lessons = readAgentRunLessons(db, company.id, builder.id);
      assert.equal(lessons.length, 2);
      assert.match(lessons[0], /Migration edits/, "newest lesson must be first");
      assert.match(lessons[1], /parser tests/);
    });

    await test("lessons coexist with voice-lane operator memory in the same file", () => {
      const filePath = resolveAgentMemoryFilePath(db, company.id, builder.id);
      assert.ok(filePath, "memory file path must resolve");
      const body = readFileSync(filePath as string, "utf-8");
      assert.match(body, /## Run lessons/);
      // Voice-style subject sections appended after lessons exist must survive
      // the next lesson write.
      const withVoice = `${body}\n## Operator preferences\n- Prefers blunt summaries _(remembered 2026-06-12)_\n`;
      writeFileSync(filePath as string, withVoice, "utf-8");
      appendAgentRunLesson(db, {
        companyId: company.id,
        agentId: builder.id,
        lesson: "Voice sections and run lessons share MEMORY.md",
        source: "agent",
        runId: "44444444-dddd",
      });
      const after = readFileSync(filePath as string, "utf-8");
      assert.match(after, /## Operator preferences/);
      assert.match(after, /Prefers blunt summaries/);
      assert.match(after, /Voice sections and run lessons share MEMORY\.md/);
    });

    await test("memory path honors a stored workspace_root that differs from the env recompute (H3 split-brain fix)", () => {
      const storedRoot = mkdtempSync(path.join(os.tmpdir(), "mc-lessons-stored-root-"));
      try {
        const splitCo = createCompany({
          name: `Split Brain Co ${Date.now()}`,
          description: "stored-root fixture",
          status: "active",
        }).company;
        const splitProject = createProject({
          companyId: splitCo.id,
          name: "Split Project",
          description: "stored-root fixture project",
          color: "#f59e0b",
          emoji: "icon:compass",
          status: "active",
        }).project;
        const splitAgent = createProjectAgent({
          projectId: splitProject.id,
          companyId: splitCo.id,
          name: "Pathy",
          emoji: "icon:map",
          role: "Backend Engineer",
          personality: "Literal",
          status: "idle",
          skills: [],
        }).agent;

        // Simulate the env-cutover split: the row keeps the provisioning-time
        // root while the process env would recompute somewhere else.
        db.prepare("UPDATE companies SET workspace_root = ?, workspace_source = 'provisioned' WHERE id = ?")
          .run(storedRoot, splitCo.id);

        const filePath = resolveAgentMemoryFilePath(db, splitCo.id, splitAgent.id);
        assert.ok(filePath, "memory file path must resolve");
        assert.equal(
          filePath,
          path.join(storedRoot, "memory", "agents", splitAgent.id, "MEMORY.md"),
          "stored workspace_root must win over the env recompute",
        );

        const write = appendAgentRunLesson(db, {
          companyId: splitCo.id,
          agentId: splitAgent.id,
          lesson: "Lessons follow the runtime workspace, not the process env",
          source: "agent",
          runId: "55555555-eeee",
        });
        assert.equal(write.saved, true);
        assert.ok(existsSync(filePath as string), "lesson file must land under the stored root");
        const lessons = readAgentRunLessons(db, splitCo.id, splitAgent.id);
        assert.match(lessons[0], /follow the runtime workspace/);

        // openclaw-sourced companies keep the canonical env pin (adapter parity).
        db.prepare("UPDATE companies SET workspace_source = 'openclaw' WHERE id = ?").run(splitCo.id);
        const openclawPath = resolveAgentMemoryFilePath(db, splitCo.id, splitAgent.id);
        assert.ok(openclawPath, "openclaw path must still resolve");
        assert.ok(
          !(openclawPath as string).startsWith(storedRoot),
          "openclaw companies must pin to the canonical env root, matching the execution adapters",
        );
      } finally {
        rmSync(storedRoot, { recursive: true, force: true });
      }
    });

    await test("eligibility: designated lead + builder roles in, others out", () => {
      assert.equal(isLessonsBookendEligible(db, { id: eagle.id, role: "Eagle", company_id: company.id }), true, "designated lead is eligible regardless of title");
      assert.equal(isLessonsBookendEligible(db, { id: builder.id, role: "Backend Engineer", company_id: company.id }), true, "builder roles are eligible");
      assert.equal(isLessonsBookendEligible(db, { id: analyst.id, role: "Meteorologist", company_id: company.id }), false, "non-lead non-builder roles start out of scope");
    });

    const task = createTask({
      projectId: project.id,
      title: "Lessons fixture task",
      description: "Run-end bookend fixture.",
      priority: "P2",
      type: "feature",
      status: "in-progress",
      labels: [],
      createdBy: "test",
    }).task;

    function insertExecutionRun(metadata: Record<string, unknown> = {}): string {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, session_id, status, started_at, completed_at,
            error_message, token_usage_json, duration_ms, idempotency_key, execution_engine,
            runner_provider, runner_model, model_lane, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, 'anthropic', ?, 'completed', ?, ?, NULL, '{}', 60000,
            ?, 'hiverunner', 'anthropic', 'claude-fable-5', 'default', ?, ?, ?)`,
      ).run(id, task.id, builder.id, `lessons-session-${id.slice(0, 8)}`, now, now, `run-${id}`, JSON.stringify(metadata), now, now);
      return id;
    }

    await test("record_lesson mc-action writes the lesson and stamps the execution run", async () => {
      const executionRunId = insertExecutionRun();
      const outcome = await executeMcAction(
        { action: "record_lesson", taskKey: task.id, lesson: "Dispatch path writes lessons synchronously" },
        {
          agentId: builder.id,
          agentName: "Ralph",
          companyId: company.id,
          taskKey: task.id,
          runId: randomUUID(),
          executionRunId,
        },
        db,
      );
      assert.equal(outcome.kind, "recorded_lesson");
      const lessons = readAgentRunLessons(db, company.id, builder.id);
      assert.match(lessons[0], /Dispatch path writes lessons synchronously/);
      const row = db.prepare("SELECT metadata_json FROM execution_runs WHERE id = ?").get(executionRunId) as { metadata_json: string };
      assert.equal(parseJson(row.metadata_json).lessonRecordedByAgent, true);
    });

    await test("run-end enforcement appends an engine stub when the agent skipped the bookend", () => {
      const executionRunId = insertExecutionRun();
      const result = enforceLessonsBookendAtRunEnd(db, {
        agentId: builder.id,
        taskId: task.id,
        runId: randomUUID(),
        executionRunId,
        status: "failed",
        error: "adapter timeout after 1200s",
        durationMs: 1200000,
      });
      assert.equal(result.stubAppended, true);
      const lessons = readAgentRunLessons(db, company.id, builder.id);
      assert.match(lessons[0], /engine stub/);
      assert.match(lessons[0], /adapter timeout/);
      const row = db.prepare("SELECT metadata_json FROM execution_runs WHERE id = ?").get(executionRunId) as { metadata_json: string };
      const metadata = parseJson(row.metadata_json) as { lessonsBookend?: { stubAppended?: boolean } };
      assert.equal(metadata.lessonsBookend?.stubAppended, true);
    });

    await test("run-end enforcement is a no-op when the agent already recorded a lesson", () => {
      const executionRunId = insertExecutionRun({ lessonRecordedByAgent: true });
      const result = enforceLessonsBookendAtRunEnd(db, {
        agentId: builder.id,
        taskId: task.id,
        runId: randomUUID(),
        executionRunId,
        status: "completed",
      });
      assert.equal(result.stubAppended, false);
      assert.equal(result.reason, "agent_recorded_lesson");
    });

    await test("run-end enforcement exempts compact-prompt runs and ineligible agents", () => {
      const compactRunId = insertExecutionRun({ compactPromptPolicy: { schema: "hiverunner.compact_task_prompt.v1" } });
      const compact = enforceLessonsBookendAtRunEnd(db, {
        agentId: builder.id,
        taskId: task.id,
        runId: randomUUID(),
        executionRunId: compactRunId,
        status: "completed",
      });
      assert.equal(compact.stubAppended, false);
      assert.equal(compact.reason, "compact_prompt_run");

      const ineligible = enforceLessonsBookendAtRunEnd(db, {
        agentId: analyst.id,
        taskId: task.id,
        runId: randomUUID(),
        executionRunId: insertExecutionRun(),
        status: "completed",
      });
      assert.equal(ineligible.stubAppended, false);
      assert.equal(ineligible.reason, "agent_not_eligible");
    });

    await test("buildHeartbeatPrompt injects lessons + bookend instruction for eligible agents only", () => {
      const agentRowSql = `
        SELECT id, name, role, personality, company_id, openclaw_agent_id, adapter_type,
               adapter_config_json, runtime_config_json, capabilities,
               NULL AS runtime_workspace_root
        FROM agents WHERE id = ? LIMIT 1
      `;
      const builderRow = db.prepare(agentRowSql).get(builder.id) as never;
      const session = getOrCreateTaskSession({ agentId: builder.id, companyId: company.id, taskKey: task.id }, db);
      const wake = { wakeSource: "issue_assigned", wakeReason: "lessons_bookend_test" };
      const prompt = buildHeartbeatPrompt(builderRow, wake, session, db);
      assert.match(prompt, /Lessons From Your Previous Runs/);
      assert.match(prompt, /Lessons bookend:/);
      assert.match(prompt, /record_lesson/);
      assert.match(prompt, /Dispatch path writes lessons synchronously/, "existing lesson content must be injected");

      const analystRow = db.prepare(agentRowSql).get(analyst.id) as never;
      const analystSession = getOrCreateTaskSession({ agentId: analyst.id, companyId: company.id, taskKey: task.id }, db);
      const analystPrompt = buildHeartbeatPrompt(analystRow, wake, analystSession, db);
      assert.ok(!analystPrompt.includes("Lessons bookend:"), "ineligible roles must not get the bookend instruction yet");
    });

    await test("lessons prompt section builder returns the formatted section", () => {
      const sectionPreview = buildAgentLessonsPromptSection(db, { id: builder.id, role: "Backend Engineer", company_id: company.id });
      assert.ok(sectionPreview && sectionPreview.includes("## Lessons From Your Previous Runs"));
    });

    const total = passed + failed;
    console.log(`\nResult: ${passed}/${total} passed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    workspaceIsolation.dispose();
  }
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
