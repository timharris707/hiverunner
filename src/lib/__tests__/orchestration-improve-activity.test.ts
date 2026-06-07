import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";

import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import {
  createBasicFixtureTask,
  createFixtureAgent,
  createFixtureProject,
  DEFAULT_ORCHESTRATION_COMPANY_ID,
} from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  tmpdir(),
  `orchestration-improve-activity-${process.pid}-${Date.now()}.db`,
);

const IMPROVE_ACTIVITY_EVENT_TYPES = [
  "improve.recommendation_created",
  "improve.recommendation_dismissed",
  "improve.recommendation_suppressed",
  "improve.approval_package_created",
  "improve.approval_decision_synced",
  "improve.recommendation_applied",
] as const;

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]", errorStackLines: 3 });

async function run() {
  console.log("\nOrchestration Improve Activity Tests\n");
  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

  const {
    createProject,
    createProjectAgent,
    createTask,
    listActivityFeed,
  } = await import("@/lib/orchestration/service");
  const { recordImproveActivity } = await import("@/lib/orchestration/service/improvement-provenance");
  const {
    createImproveRecommendation,
    updateImproveRecommendation,
  } = await import("@/lib/orchestration/improvement-recommendations");
  const { getOrchestrationDb } = await import("@/lib/orchestration/db");

  const db = getOrchestrationDb();
  db.prepare("UPDATE companies SET company_code = ?, slug = ? WHERE id = ?")
    .run("INS", "insight", DEFAULT_ORCHESTRATION_COMPANY_ID);

  const project = createFixtureProject(createProject, {
    namePrefix: "Improve Activity Project",
    label: "activity",
    description: "Improve activity fixture",
    color: "#14b8a6",
    emoji: "I",
  });
  const agent = createFixtureAgent(createProjectAgent, {
    projectId: project.id,
    namePrefix: "ImproveActivityAgent",
    openclawPrefix: "improve-activity-agent",
    emoji: "A",
    role: "Implementation Engineer",
    skills: ["backend"],
  });
  const task = createBasicFixtureTask(createTask, {
    projectId: project.id,
    title: "Improve activity source task",
    assignee: agent.id,
    createdBy: agent.id,
    status: "review",
  });
  const taskKey = task.key ?? task.id;
  const approvalId = `approval-improve-${Date.now()}`;
  db.prepare(
    `INSERT INTO approvals
      (id, company_id, type, status, requested_by_agent_id, payload_json, linked_task_id, created_at, updated_at)
     VALUES (?, ?, 'hire_agent', 'pending', ?, '{}', ?, ?, ?)`,
  ).run(approvalId, DEFAULT_ORCHESTRATION_COMPANY_ID, agent.id, task.id, "2026-06-07T08:00:00.000Z", "2026-06-07T08:00:00.000Z");

  await test("Improve provenance records compact audit rows and Activity events", () => {
    const baseSource = {
      recommendationId: "rec-compact-1",
      recommendationType: "runtime_setting",
      category: "runner_reliability",
      severity: "high",
      confidence: 0.82,
      projectId: project.id,
      taskId: task.id,
      taskKey,
      agentId: agent.id,
      triggerId: "trigger-eval-failure-pattern",
      triggerHistoryId: "trigger-history-1",
      evidenceSetId: "evidence-set-1",
      evidenceCount: 42,
      evalCaseId: "eval-case-1",
      sourceRunId: "run-source-1",
    };

    recordImproveActivity({
      companyId: DEFAULT_ORCHESTRATION_COMPANY_ID,
      eventType: "improve.recommendation_created",
      actorAgentId: agent.id,
      source: {
        ...baseSource,
        recommendationStatus: "suggested",
        summary: "A compact recommendation was created from linked evidence.",
      },
      rawPayload: {
        trace: "SECRET_TRACE_SHOULD_NOT_LEAK",
        redactedSnapshot: { rawPayload: "SECRET_EVAL_SHOULD_NOT_LEAK" },
      },
    } as Parameters<typeof recordImproveActivity>[0] & Record<string, unknown>);

    recordImproveActivity({
      companyId: DEFAULT_ORCHESTRATION_COMPANY_ID,
      eventType: "improve.recommendation_dismissed",
      actorAgentId: agent.id,
      source: {
        ...baseSource,
        recommendationStatus: "dismissed",
        dismissalCategory: "not_actionable",
        reasonCode: "already_resolved",
        summary: "Dismissed after operator review.",
      },
    });

    recordImproveActivity({
      companyId: DEFAULT_ORCHESTRATION_COMPANY_ID,
      eventType: "improve.recommendation_suppressed",
      actorAgentId: agent.id,
      source: {
        ...baseSource,
        recommendationStatus: "dismissed",
        suppressionId: "suppression-1",
        suppressionScope: "recommendation_signature",
      },
    });

    recordImproveActivity({
      companyId: DEFAULT_ORCHESTRATION_COMPANY_ID,
      eventType: "improve.approval_package_created",
      actorAgentId: agent.id,
      source: {
        ...baseSource,
        recommendationStatus: "accepted-for-approval",
        approvalPackageId: "approval-package-1",
        approvalId,
        approvalStatus: "pending",
      },
    });

    recordImproveActivity({
      companyId: DEFAULT_ORCHESTRATION_COMPANY_ID,
      eventType: "improve.approval_decision_synced",
      actorAgentId: agent.id,
      source: {
        ...baseSource,
        recommendationStatus: "accepted-for-approval",
        approvalId,
        approvalStatus: "approved",
        approvalDecision: "approved",
      },
    });

    recordImproveActivity({
      companyId: DEFAULT_ORCHESTRATION_COMPANY_ID,
      eventType: "improve.recommendation_applied",
      actorAgentId: agent.id,
      source: {
        ...baseSource,
        recommendationStatus: "applied",
        approvalId,
        approvalStatus: "approved",
        appliedChangeId: "applied-change-1",
        appliedOutcome: "success",
        rollbackNoteId: "rollback-note-1",
      },
    });

    const rows = db
      .prepare(
        `SELECT event_type, task_id, approval_id, metadata_json
         FROM company_audit_events
         WHERE event_type LIKE 'improve.%'
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as Array<{
        event_type: string;
        task_id: string | null;
        approval_id: string | null;
        metadata_json: string;
      }>;

    assert.equal(rows.length, IMPROVE_ACTIVITY_EVENT_TYPES.length);
    assert.deepEqual(rows.map((row) => row.event_type).sort(), [...IMPROVE_ACTIVITY_EVENT_TYPES].sort());

    const serializedRows = JSON.stringify(rows);
    assert.doesNotMatch(serializedRows, /SECRET_TRACE_SHOULD_NOT_LEAK/);
    assert.doesNotMatch(serializedRows, /SECRET_EVAL_SHOULD_NOT_LEAK/);
    assert.doesNotMatch(serializedRows, /rawPayload|redactedSnapshot|traceSnapshot|evalSnapshot/);

    for (const row of rows) {
      assert.equal(row.task_id, task.id);
      assert.ok(row.metadata_json.length < 1800, `metadata should stay bounded for ${row.event_type}`);
      const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
      assert.equal(metadata.schema, "hiverunner.improve_activity.v1");
      assert.equal(metadata.recommendationId, "rec-compact-1");
      assert.equal(metadata.projectId, project.id);
      assert.equal(metadata.evidenceSetId, "evidence-set-1");
      assert.equal(metadata.evidenceCount, 42);
      assert.equal(metadata.evalCaseId, "eval-case-1");
      const sourceLinks = metadata.sourceLinks as Record<string, unknown>;
      assert.equal(sourceLinks.improve, "/INS/improve?recommendation=rec-compact-1");
      assert.equal(sourceLinks.evalCase, "/INS/evals/eval-case-1");
      assert.equal(sourceLinks.runTrace, `/INS/tasks/${encodeURIComponent(taskKey)}/runs/run-source-1`);
      assert.equal(sourceLinks.task, `/INS/tasks/${encodeURIComponent(taskKey)}`);
      if (row.event_type.includes("approval")) {
        assert.equal(row.approval_id, approvalId);
        assert.equal(sourceLinks.approval, `/INS/approvals/${approvalId}`);
      }
    }

    const feed = listActivityFeed({ limit: 40, projectId: project.id });
    const improveEvents = feed.activity.filter((event) => event.eventType.startsWith("improve."));
    assert.equal(improveEvents.length, IMPROVE_ACTIVITY_EVENT_TYPES.length);
    assert.ok(improveEvents.some((event) => event.message === "Improve recorded recommendation rec-compact-1"));
    assert.ok(improveEvents.some((event) => event.message === "Improve approval decision synced for recommendation rec-compact-1"));
    assert.ok(improveEvents.every((event) => event.metadata?.schema === "hiverunner.improve_activity.v1"));
    assert.doesNotMatch(JSON.stringify(improveEvents.map((event) => event.metadata)), /SECRET_|rawPayload|redactedSnapshot/);
  });

  await test("Improve recommendation mutations emit live Activity and audit provenance", () => {
    const mutationEvidence = [{
      id: "mutation-evidence-1",
      sourceType: "task",
      sourceId: task.id,
      taskId: task.id,
      taskKey,
      title: "Mutation evidence",
      summary: "Operator action provenance should link to compact source IDs only.",
    }];
    const dismissed = createImproveRecommendation({
      id: "rec-update-dismissed",
      companyId: DEFAULT_ORCHESTRATION_COMPANY_ID,
      triggerKey: "reviewer_request",
      scopeType: "agent",
      scopeKey: agent.id,
      title: "Dismiss through mutation service",
      rationale: "Fixture recommendation for dismissal provenance.",
      proposedChange: "No change should be applied.",
      severity: "medium",
      confidence: "medium",
      evidence: mutationEvidence,
    }, db);
    const suppressedViaMutation = createImproveRecommendation({
      id: "rec-update-suppressed",
      companyId: DEFAULT_ORCHESTRATION_COMPANY_ID,
      triggerKey: "missing_capability",
      scopeType: "agent",
      scopeKey: agent.id,
      title: "Suppress through mutation service",
      rationale: "Fixture recommendation for suppression provenance.",
      proposedChange: "Suppress repeated recommendations for this agent.",
      severity: "low",
      confidence: "medium",
      evidence: mutationEvidence,
    }, db);
    const applied = createImproveRecommendation({
      id: "rec-update-applied",
      companyId: DEFAULT_ORCHESTRATION_COMPANY_ID,
      triggerKey: "template_drift",
      scopeType: "project",
      scopeKey: project.id,
      title: "Apply through mutation service",
      rationale: "Fixture recommendation for applied provenance.",
      proposedChange: "Record a compact applied outcome.",
      severity: "high",
      confidence: "high",
      evidence: mutationEvidence,
    }, db);

    updateImproveRecommendation(DEFAULT_ORCHESTRATION_COMPANY_ID, dismissed.id, {
      action: "dismiss",
      reason: "wrong_diagnosis",
      notes: "Operator rejected this diagnosis.",
      actorAgentId: agent.id,
    }, db);
    updateImproveRecommendation(DEFAULT_ORCHESTRATION_COMPANY_ID, suppressedViaMutation.id, {
      action: "suppress",
      reason: "duplicate",
      notes: "Covered by another recommendation.",
      scopeType: "agent",
      scopeKey: agent.id,
      actorAgentId: agent.id,
    }, db);
    updateImproveRecommendation(DEFAULT_ORCHESTRATION_COMPANY_ID, applied.id, {
      action: "transition",
      status: "applied",
      reason: "success",
      actorAgentId: agent.id,
    }, db);

    const rows = db
      .prepare(
        `SELECT event_type, metadata_json
         FROM company_audit_events
         WHERE json_extract(metadata_json, '$.recommendationId') IN (?, ?, ?)
         ORDER BY created_at ASC, id ASC`,
      )
      .all(dismissed.id, suppressedViaMutation.id, applied.id) as Array<{
        event_type: string;
        metadata_json: string;
      }>;

    assert.deepEqual(rows.map((row) => row.event_type).sort(), [
      "improve.recommendation_applied",
      "improve.recommendation_dismissed",
      "improve.recommendation_suppressed",
    ]);

    const byType = new Map(rows.map((row) => [row.event_type, JSON.parse(row.metadata_json) as Record<string, unknown>]));
    assert.equal(byType.get("improve.recommendation_dismissed")?.reasonCode, "wrong_diagnosis");
    assert.equal(byType.get("improve.recommendation_suppressed")?.reasonCode, "duplicate");
    assert.equal(byType.get("improve.recommendation_applied")?.appliedOutcome, "success");
    for (const metadata of byType.values()) {
      assert.equal(metadata.schema, "hiverunner.improve_activity.v1");
      assert.equal(metadata.projectId, project.id);
      assert.ok((metadata.sourceLinks as Record<string, unknown>).improve);
      assert.ok(JSON.stringify(metadata).length < 1800);
    }

    const feed = listActivityFeed({ limit: 40, projectId: project.id, agentId: agent.id });
    const mutationEvents = feed.activity.filter((event) =>
      [dismissed.id, suppressedViaMutation.id, applied.id].includes(String(event.metadata?.recommendationId ?? "")),
    );
    assert.deepEqual(mutationEvents.map((event) => event.eventType).sort(), [
      "improve.recommendation_applied",
      "improve.recommendation_dismissed",
      "improve.recommendation_suppressed",
    ]);
  });
}

run().finally(() => finish());
