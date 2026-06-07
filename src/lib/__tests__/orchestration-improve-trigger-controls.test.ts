import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { DEFAULT_ORCHESTRATION_COMPANY_ID } from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";
import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  tmpdir(),
  `orchestration-improve-trigger-controls-${process.pid}-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]", errorStackLines: 3 });

async function run() {
  console.log("\nOrchestration Improve Trigger Control Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-improve-trigger-controls-",
  });

  try {
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const {
      deactivateImprovementSuppression,
      dismissImprovementRecommendation,
      getImprovementDashboard,
      setCompanyImprovementPause,
      setImprovementTriggerEnabled,
      suggestImprovementRecommendation,
    } = await import("@/lib/orchestration/improvement-recommendations");

    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);
    const companyId = DEFAULT_ORCHESTRATION_COMPANY_ID;
    const scope = { type: "agent" as const, key: "agent-improve-controls" };
    const evidence = [{
      sourceType: "review",
      sourceId: "review-controls-1",
      title: "Reviewer return",
      summary: "Reviewer returned the task with repeatable capability evidence.",
      occurredAt: "2026-06-07T12:00:00.000Z",
    }];

    await test("pause, trigger disable, and scoped suppression gate future suggestions", () => {
      const first = suggestImprovementRecommendation({
        companyId,
        triggerKey: "missing_skill",
        triggerClass: "missing_capability",
        scope,
        title: "Add scoped regression skill",
        rationale: "The agent repeatedly missed regression coverage.",
        proposedChange: "Attach a scoped regression testing skill through governance.",
        severity: "high",
        confidence: "high",
        evidence,
        idempotencyKey: "ins-253-initial",
      }, db);
      assert.equal(first.outcome, "created");
      assert.ok(first.recommendation);
      assert.equal(first.recommendation.triggerKey, "missing_capability");
      assert.equal(first.firing.status, "created_recommendation");

      setCompanyImprovementPause({
        companyId,
        paused: true,
        reason: "Operator paused improvement suggestions.",
      }, db);
      const paused = suggestImprovementRecommendation({
        companyId,
        triggerKey: "missing_skill",
        scope,
        title: "Paused suggestion should not persist",
        evidence,
        idempotencyKey: "ins-253-paused",
      }, db);
      assert.equal(paused.outcome, "skipped");
      assert.equal(paused.reason, "company_paused");
      assert.equal(paused.recommendation, null);

      setCompanyImprovementPause({ companyId, paused: false }, db);
      setImprovementTriggerEnabled({
        companyId,
        triggerKey: "missing_capability",
        enabled: false,
      }, db);
      const disabled = suggestImprovementRecommendation({
        companyId,
        triggerKey: "missing_capability",
        scope,
        title: "Disabled trigger should not persist",
        evidence,
        idempotencyKey: "ins-253-disabled",
      }, db);
      assert.equal(disabled.outcome, "skipped");
      assert.equal(disabled.reason, "trigger_disabled");
      assert.equal(disabled.recommendation, null);

      setImprovementTriggerEnabled({
        companyId,
        triggerKey: "missing_capability",
        enabled: true,
      }, db);
      const dismissed = dismissImprovementRecommendation({
        companyId,
        recommendationId: first.recommendation.id,
        reason: "wrong_diagnosis",
        notes: "The operator dismissed this scope for now.",
      }, db);
      assert.equal(dismissed.status, "dismissed");
      assert.ok(dismissed.suppressionId);

      const suppressed = suggestImprovementRecommendation({
        companyId,
        triggerKey: "missing_capability",
        scope,
        title: "Suppressed suggestion should not persist",
        evidence,
        idempotencyKey: "ins-253-suppressed",
      }, db);
      assert.equal(suppressed.outcome, "suppressed");
      assert.equal(suppressed.recommendation, null);
      assert.equal(suppressed.suppression?.id, dismissed.suppressionId);

      deactivateImprovementSuppression({
        companyId,
        suppressionId: dismissed.suppressionId,
      }, db);
      const afterClear = suggestImprovementRecommendation({
        companyId,
        triggerKey: "missing_capability",
        scope,
        title: "Suggestion after suppression clears",
        evidence,
        idempotencyKey: "ins-253-after-clear",
      }, db);
      assert.equal(afterClear.outcome, "created");
      assert.ok(afterClear.recommendation);

      const blockedRows = db
        .prepare("SELECT COUNT(*) AS count FROM improvement_recommendations WHERE idempotency_key IN (?, ?, ?)")
        .get("ins-253-paused", "ins-253-disabled", "ins-253-suppressed") as { count: number };
      assert.equal(blockedRows.count, 0);

      const dashboard = getImprovementDashboard(companyId, db);
      assert.equal(dashboard.companyControl.automationPaused, false);
      assert.equal(dashboard.triggers.find((trigger) => trigger.triggerKey === "missing_capability")?.enabled, true);
      assert.equal(dashboard.firings.some((firing) => firing.status === "skipped" && firing.decisionReason === "trigger_disabled"), true);
      assert.equal(dashboard.firings.some((firing) => firing.status === "suppressed" && firing.suppressionId === dismissed.suppressionId), true);
      assert.equal(
        dashboard.recommendations.find((recommendation) => recommendation.id === first.recommendation?.id)?.status,
        "dismissed",
      );
      assert.equal(
        dashboard.recommendations.some((recommendation) => recommendation.id === afterClear.recommendation?.id),
        true,
      );
    });
  } finally {
    workspaceIsolation.dispose();
  }

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
