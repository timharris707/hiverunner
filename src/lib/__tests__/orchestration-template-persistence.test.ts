import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import {
  createIsolatedOrchestrationWorkspace,
  resetSqliteDatabaseFiles,
} from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import type { RunTraceEvidenceInput } from "@/lib/orchestration/run-trace";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  tmpdir(),
  `orchestration-template-persistence-${process.pid}-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]", errorStackLines: 3 });

function columnNames(db: Database.Database, tableName: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

function traceInput(input: {
  runId: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  sourceTemplateVersionId: string;
  templateIntakeAnswerId: string;
}): RunTraceEvidenceInput {
  return {
    run: {
      id: input.runId,
      status: "succeeded",
      providerId: "codex",
      invocationSource: "issue_assigned",
      startedAt: "2026-06-06T20:00:00.000Z",
      finishedAt: "2026-06-06T20:01:00.000Z",
      durationMs: 60_000,
      error: null,
    },
    task: {
      id: input.taskId,
      key: input.taskKey,
      title: input.taskTitle,
      status: "done",
      priority: "P1",
    },
    provider: {
      id: "codex",
      displayName: "Codex",
      capabilities: {
        liveText: true,
        actionDetection: true,
        structuredTools: true,
        persistedTranscript: true,
      },
    },
    metrics: {
      durationMs: 60_000,
      inputTokens: 100,
      outputTokens: 40,
      actionsFound: 1,
      actionsExecuted: 1,
    },
    transcript: {
      entries: [{ id: "entry-1", body: "Finished template-generated task.", type: "assistant_text_final" }],
      provenance: { totalEntries: 1, fullTranscriptAvailable: true, source: "execution_run_transcript_events" },
    },
    timeline: [
      { id: "started", kind: "run_start", summary: "started", ts: Date.parse("2026-06-06T20:00:00.000Z"), source: "execution_transcript" },
      { id: "done", kind: "run_end", summary: "done", ts: Date.parse("2026-06-06T20:01:00.000Z"), source: "execution_transcript" },
    ],
    workspaceRunVisibility: { schema: "hiverunner.workspace_run_visibility.v1" },
    memoryEvidence: { records: [] },
    template: {
      sourceTemplateVersionId: input.sourceTemplateVersionId,
      templateIntakeAnswerId: input.templateIntakeAnswerId,
      provenance: { source: "template-generated-task" },
    },
    rawPayload: { result: "safe" },
  };
}

async function run() {
  console.log("\nOrchestration Template Persistence Tests\n");
  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-template-persistence-",
  });

  try {
    const {
      approveSprintPlanDraft,
      createCompany,
      createCompanyGoal,
      createSprintPlanDraft,
    } = await import("@/lib/orchestration/company-service");
    const { getOrchestrationDb, runOrchestrationMigrations } = await import("@/lib/orchestration/db");
    const { BUILT_IN_STARTER_SPRINT_TEMPLATES } = await import("@/lib/orchestration/starter-sprint-templates");
    const {
      createTemplateIntakeAnswer,
      createTemplateVersion,
      getTemplateIntakeAnswer,
      getTemplateVersion,
      linkTemplateGeneratedExecutionRun,
    } = await import("@/lib/orchestration/template-persistence");
    const {
      createProject,
      createProjectAgent,
      createTask,
      getTask,
      listProjectSprints,
    } = await import("@/lib/orchestration/service");
    const { createEvalCase } = await import("@/lib/orchestration/eval-cases");
    const { buildRedactedRunTraceExport } = await import("@/lib/orchestration/run-trace");

    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);

    const suffix = Date.now();
    const company = createCompany({
      name: `Template Persistence ${suffix}`,
      description: "Template persistence fixture company.",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: `Template Persistence Project ${suffix}`,
      description: "Template persistence fixture project.",
      color: "#22c55e",
      emoji: "icon:layers",
      status: "active",
    }).project;
    const agent = createProjectAgent({
      projectId: project.id,
      name: `Template Runner ${suffix}`,
      emoji: "icon:bot",
      role: "Implementation engineer",
      personality: "Deterministic fixture agent.",
      skills: [],
      status: "idle",
    }).agent;
    const companyGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: "Template-backed delivery goal",
      goal: "Create work from an immutable template.",
      goalKind: "company",
      status: "active",
    }).goal;
    const planningTask = createTask({
      projectId: project.id,
      title: "Plan template-backed sprint",
      description: "Fixture planning task.",
      priority: "P1",
      type: "research",
      status: "to-do",
      labels: [],
      createdBy: agent.id,
    }).task;

    let localTemplateId = "";
    let intakeAnswerId = "";
    let materializedTaskId = "";
    let materializedSprintId = "";

    await test("migration is idempotent and stores rollback notes", () => {
      const builtIn = getTemplateVersion("builtin-starter-sprint-build-v1");
      assert.equal(builtIn?.scope, "built_in");
      assert.equal(builtIn?.templateKey, "starter-sprint-build");
      assert.match(builtIn?.rollbackNotes ?? "", /rollback/i);

      for (const template of BUILT_IN_STARTER_SPRINT_TEMPLATES) {
        const seeded = getTemplateVersion(template.templateVersionId);
        assert.equal(seeded?.scope, "built_in");
        assert.equal(seeded?.companyId, null);
        assert.equal(seeded?.templateKey, template.id);
        assert.equal(seeded?.version, 1);
        assert.equal(seeded?.template.templateVersionId, template.templateVersionId);
        assert.deepEqual(seeded?.intakeSchema, JSON.parse(JSON.stringify(template.intake)));
        assert.match(seeded?.rollbackNotes ?? "", /immutable/i);
      }

      for (const tableName of [
        "template_versions",
        "template_intake_answers",
        "template_generated_work",
        "template_persistence_migration_notes",
      ]) {
        assert.ok(columnNames(db, tableName).length > 0, `${tableName} should exist`);
      }

      for (const [tableName, expected] of Object.entries({
        sprints: ["source_template_version_id", "template_intake_answer_id", "template_generation_provenance_json"],
        tasks: ["source_template_version_id", "template_intake_answer_id", "template_generation_provenance_json"],
        execution_runs: ["source_template_version_id", "template_intake_answer_id"],
        eval_cases: ["source_template_version_id", "template_intake_answer_id"],
        goal_sprint_plan_drafts: ["source_template_version_id", "intake_answer_id", "generation_provenance_json"],
      })) {
        const columns = columnNames(db, tableName);
        for (const column of expected) assert.ok(columns.includes(column), `${tableName}.${column} should exist`);
      }

      const note = db
        .prepare("SELECT rollback_notes FROM template_persistence_migration_notes WHERE migration_version = 116")
        .get() as { rollback_notes: string } | undefined;
      assert.match(note?.rollback_notes ?? "", /Rollback/i);

      const dir = mkdtempSync(path.join(tmpdir(), "orchestration-template-v116-"));
      const dbPath = path.join(dir, "orchestration.db");
      const legacyDb = new Database(dbPath);
      try {
        runOrchestrationMigrations(legacyDb);
        legacyDb.prepare("DELETE FROM schema_migrations WHERE version = 116").run();
        assert.doesNotThrow(() => runOrchestrationMigrations(legacyDb));
        assert.doesNotThrow(() => runOrchestrationMigrations(legacyDb));
        const applied = legacyDb
          .prepare("SELECT name FROM schema_migrations WHERE version = 116")
          .get() as { name: string } | undefined;
        const noteCount = legacyDb
          .prepare("SELECT COUNT(*) AS count FROM template_persistence_migration_notes WHERE migration_version = 116")
          .get() as { count: number };
        assert.equal(applied?.name, "template_version_intake_and_generated_work_persistence");
        assert.equal(noteCount.count, 1);
      } finally {
        legacyDb.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    await test("template versions are immutable and company-scoped", () => {
      const local = createTemplateVersion({
        companyId: company.id,
        templateKey: "starter-sprint-build",
        version: 1,
        name: "Company starter sprint",
        description: "Company-local starter sprint fixture.",
        template: {
          sprint: { name: "Build", objective: "Ship one useful slice." },
          tasks: [{ title: "Build slice", type: "feature" }],
        },
        intakeSchema: { fields: [{ id: "objective", type: "text" }] },
        createdBy: agent.id,
      });
      localTemplateId = local.id;

      assert.equal(local.scope, "company");
      assert.equal(local.companyId, company.id);
      assert.match(local.rollbackNotes, /immutable/i);
      assert.throws(
        () => db.prepare("UPDATE template_versions SET name = ? WHERE id = ?").run("Mutated", local.id),
        /immutable/i,
      );
      assert.throws(
        () => db.prepare("DELETE FROM template_versions WHERE id = ?").run(local.id),
        /immutable/i,
      );
    });

    await test("intake answers round-trip and replay idempotently", () => {
      const intake = createTemplateIntakeAnswer({
        companyId: company.id,
        templateVersionId: localTemplateId,
        companyGoalId: companyGoal.sprint.id,
        planningTaskId: planningTask.id,
        submittedByAgentId: agent.id,
        answers: {
          objective: "Build the persistence slice",
          constraints: ["no stable edits", "preserve provenance"],
        },
        normalizedAnswers: {
          constraints: ["no stable edits", "preserve provenance"],
          objective: "Build the persistence slice",
        },
        idempotencyKey: "ins-232-template-intake",
      });
      intakeAnswerId = intake.id;

      const replay = createTemplateIntakeAnswer({
        companyId: company.id,
        templateVersionId: localTemplateId,
        companyGoalId: companyGoal.sprint.id,
        planningTaskId: planningTask.id,
        submittedByAgentId: agent.id,
        answers: {
          constraints: ["no stable edits", "preserve provenance"],
          objective: "Build the persistence slice",
        },
        idempotencyKey: "ins-232-template-intake",
      });
      const loaded = getTemplateIntakeAnswer(intake.id);

      assert.equal(replay.id, intake.id);
      assert.deepEqual(loaded?.answers, {
        constraints: ["no stable edits", "preserve provenance"],
        objective: "Build the persistence slice",
      });
      assert.throws(
        () => createTemplateIntakeAnswer({
          companyId: company.id,
          templateVersionId: localTemplateId,
          answers: { objective: "different" },
          idempotencyKey: "ins-232-template-intake",
        }),
        /idempotency key/i,
      );
    });

    await test("draft approval links generated work to template, intake, sprint, and task", () => {
      const draft = createSprintPlanDraft({
        companyIdOrSlug: company.id,
        companyGoalId: companyGoal.sprint.id,
        planningTaskId: planningTask.id,
        proposedByAgentId: agent.id,
        sourceTemplateVersionId: localTemplateId,
        intakeAnswerId,
        generationProvenance: { generator: "test", mode: "template" },
        sprint: {
          name: "Template persistence sprint",
          objective: "Materialize template-backed work.",
          successCriteria: ["Template provenance survives approval"],
          validationChecks: ["Generated-work rows exist"],
          outOfScope: ["Stable lane edits"],
          defaultExecutionEngine: "hiverunner",
          defaultModelLane: "default",
        },
        tasks: [
          {
            id: "draft-task-1",
            title: "Implement template persistence",
            description: "Fixture materialized task.",
            assignee: agent.id,
            priority: "P1",
            type: "feature",
            validation: "Focused persistence test passes",
          },
        ],
      }).draft;

      assert.equal(draft.sourceTemplateVersionId, localTemplateId);
      assert.equal(draft.intakeAnswerId, intakeAnswerId);
      assert.equal(draft.sprint.sourceTemplateVersionId, localTemplateId);
      assert.equal(draft.tasks[0]?.sourceTemplateVersionId, localTemplateId);

      const approved = approveSprintPlanDraft({
        companyIdOrSlug: company.id,
        companyGoalId: companyGoal.sprint.id,
        draftId: draft.id,
        actorUserId: "operator-test",
      });
      materializedSprintId = approved.sprint.sprint.id;
      materializedTaskId = approved.taskIds[0] ?? "";

      const createdTask = getTask(materializedTaskId).task;
      const listedSprint = listProjectSprints(project.id).sprints.find((item) => item.id === materializedSprintId);
      assert.equal(approved.sprint.sprint.sourceTemplateVersionId, localTemplateId);
      assert.equal(approved.sprint.sprint.templateIntakeAnswerId, intakeAnswerId);
      assert.equal(listedSprint?.sourceTemplateVersionId, localTemplateId);
      assert.equal(createdTask.sourceTemplateVersionId, localTemplateId);
      assert.equal(createdTask.templateIntakeAnswerId, intakeAnswerId);

      const generated = db
        .prepare(
          `SELECT generated_type, generated_id, rollback_notes, provenance_json
           FROM template_generated_work
           WHERE template_version_id = ?
           ORDER BY generated_type, generated_id`,
        )
        .all(localTemplateId) as Array<{
          generated_type: string;
          generated_id: string;
          rollback_notes: string;
          provenance_json: string;
        }>;
      const generatedTypes = generated.map((row) => row.generated_type).sort();
      assert.deepEqual(generatedTypes, ["sprint", "sprint_plan_draft", "task"]);
      assert.ok(generated.some((row) => row.generated_type === "sprint_plan_draft" && row.generated_id === draft.id));
      assert.ok(generated.some((row) => row.generated_type === "sprint" && row.generated_id === materializedSprintId));
      assert.ok(generated.some((row) => row.generated_type === "task" && row.generated_id === materializedTaskId));
      assert.ok(generated.every((row) => /rollback/i.test(row.rollback_notes)));
      assert.ok(generated.every((row) => JSON.parse(row.provenance_json).generator === "test"));
    });

    await test("execution runs link back to source template provenance", () => {
      const executionRunId = "template-execution-run-1";
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO execution_runs
          (id, task_id, agent_id, provider, execution_engine, runner_provider, status, started_at, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'codex', 'hiverunner', 'codex', 'completed', ?, ?, ?, ?)`,
      ).run(
        executionRunId,
        materializedTaskId,
        agent.id,
        now,
        now,
        now,
        now,
      );

      const linked = linkTemplateGeneratedExecutionRun({
        companyId: company.id,
        taskId: materializedTaskId,
        executionRunId,
        provenance: { source: "test-execution-run" },
      });

      assert.equal(linked?.generatedType, "execution_run");
      assert.equal(linked?.executionRunId, executionRunId);
      assert.equal(linked?.taskId, materializedTaskId);
      assert.equal(linked?.templateVersionId, localTemplateId);
      assert.equal(linked?.intakeAnswerId, intakeAnswerId);
      assert.equal(linked?.provenance.source, "test-execution-run");

      const executionRun = db
        .prepare(
          `SELECT source_template_version_id, template_intake_answer_id, template_generation_provenance_json
           FROM execution_runs
           WHERE id = ?`,
        )
        .get(executionRunId) as {
          source_template_version_id: string | null;
          template_intake_answer_id: string | null;
          template_generation_provenance_json: string;
        };
      assert.equal(executionRun.source_template_version_id, localTemplateId);
      assert.equal(executionRun.template_intake_answer_id, intakeAnswerId);
      assert.equal(JSON.parse(executionRun.template_generation_provenance_json).source, "test-execution-run");
    });

    await test("run trace and eval-case context preserve template provenance", () => {
      const task = getTask(materializedTaskId).task;
      const redactedSnapshot = buildRedactedRunTraceExport(traceInput({
        runId: "template-run-1",
        taskId: task.id,
        taskKey: task.key ?? task.id,
        taskTitle: task.title,
        sourceTemplateVersionId: localTemplateId,
        templateIntakeAnswerId: intakeAnswerId,
      }));
      const template = redactedSnapshot.template as Record<string, unknown> | null | undefined;
      assert.equal(template?.sourceTemplateVersionId, localTemplateId);
      assert.equal(template?.templateIntakeAnswerId, intakeAnswerId);

      const evalCase = createEvalCase({
        companyId: company.id,
        projectId: project.id,
        sourceTask: {
          id: task.id,
          key: task.key ?? task.id,
          title: task.title,
          type: task.type,
        },
        sourceRun: {
          id: "template-run-1",
          traceRoute: `/INS/tasks/${encodeURIComponent(task.key ?? task.id)}/runs/template-run-1`,
          executionEngine: "hiverunner",
          runnerProvider: "openai",
          providerId: "codex",
          runnerModel: "gpt-5",
          agentId: agent.id,
          agentName: agent.name,
        },
        sourceSprint: { id: materializedSprintId, key: null },
        sourceGoal: { id: companyGoal.sprint.id, key: companyGoal.sprint.sprintKey ?? null },
        templateContext: { templateKey: "starter-sprint-build" },
        sourceTemplateVersionId: localTemplateId,
        templateIntakeAnswerId: intakeAnswerId,
        review: {
          outcome: "accepted",
          rationale: "Template provenance round-trip verified.",
          reviewerAgentId: agent.id,
          reviewerName: agent.name,
          reviewedAt: "2026-06-06T22:00:00.000Z",
        },
        captureQuality: redactedSnapshot.captureQuality.label,
        evidenceGaps: redactedSnapshot.evidenceGaps,
        redactedSnapshot,
        idempotencyKey: "template-run-1:accepted",
        createdByAgentId: agent.id,
      }, db);

      assert.equal(evalCase.sourceTemplateVersionId, localTemplateId);
      assert.equal(evalCase.templateIntakeAnswerId, intakeAnswerId);
      assert.equal(evalCase.templateContext.sourceTemplateVersionId, localTemplateId);
      assert.equal(evalCase.templateContext.templateIntakeAnswerId, intakeAnswerId);

      const generated = db
        .prepare(
          `SELECT generated_type, eval_case_id, provenance_json
           FROM template_generated_work
           WHERE generated_type = 'eval_case' AND eval_case_id = ?
           LIMIT 1`,
        )
        .get(evalCase.id) as { generated_type: string; eval_case_id: string; provenance_json: string } | undefined;
      assert.equal(generated?.generated_type, "eval_case");
      assert.equal(generated?.eval_case_id, evalCase.id);
      assert.equal(JSON.parse(generated?.provenance_json ?? "{}").sourceRunId, "template-run-1");
    });
  } finally {
    workspaceIsolation.dispose();
  }

  finish();
}

void run();
