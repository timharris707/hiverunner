import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import {
  createIsolatedOrchestrationWorkspace,
  resetSqliteDatabaseFiles,
} from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { DEFAULT_ORCHESTRATION_COMPANY_ID } from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  tmpdir(),
  `orchestration-improvement-recommendations-${process.pid}-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]", errorStackLines: 3 });

function columnNames(db: Database.Database, tableName: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

async function run() {
  console.log("\nOrchestration Improvement Recommendation Persistence Tests\n");
  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-improvement-recommendations-",
  });

  try {
    const { getOrchestrationDb, runOrchestrationMigrations } = await import("@/lib/orchestration/db");
    const {
      createImprovementEvidenceSet,
      createImprovementRecommendation,
      createImprovementSuppression,
      createImprovementTriggerFiring,
      getImprovementRecommendation,
      linkImprovementRecommendationApproval,
      listImprovementRecommendations,
      setImprovementRecommendationWritesEnabled,
      suggestImprovementRecommendation,
      updateImprovementRecommendationStatus,
    } = await import("@/lib/orchestration/improvement-recommendations");

    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);
    const companyId = DEFAULT_ORCHESTRATION_COMPANY_ID;

    await test("migration creates additive lifecycle tables and recovers after rerun", () => {
      for (const tableName of [
        "improvement_company_controls",
        "improvement_trigger_controls",
        "improvement_suppressions",
        "improvement_trigger_firings",
        "improvement_recommendations",
        "improvement_write_controls",
        "improvement_evidence_sets",
        "improvement_recommendation_approval_links",
        "improvement_persistence_migration_notes",
      ]) {
        assert.ok(columnNames(db, tableName).length > 0, `${tableName} should exist`);
      }

      for (const column of [
        "trigger_class",
        "source_trigger_firing_id",
        "evidence_set_id",
        "operator_text",
        "original_generated_text",
        "proposed_change_json",
        "affected_surfaces_json",
        "rollback_notes",
      ]) {
        assert.ok(columnNames(db, "improvement_recommendations").includes(column), `recommendations.${column}`);
      }

      const note = db
        .prepare("SELECT rollback_notes FROM improvement_persistence_migration_notes WHERE migration_version = 118")
        .get() as { rollback_notes: string } | undefined;
      assert.match(note?.rollback_notes ?? "", /writes_enabled = 0/);
      assert.match(note?.rollback_notes ?? "", /stop new recommendation, trigger firing, and evidence set creation/i);
      assert.match(note?.rollback_notes ?? "", /preserving existing trigger firings/i);

      const dir = mkdtempSync(path.join(tmpdir(), "orchestration-improve-v118-"));
      const dbPath = path.join(dir, "orchestration.db");
      const legacyDb = new Database(dbPath);
      try {
        runOrchestrationMigrations(legacyDb);
        legacyDb.prepare("DELETE FROM schema_migrations WHERE version = 118").run();
        assert.doesNotThrow(() => runOrchestrationMigrations(legacyDb));
        assert.doesNotThrow(() => runOrchestrationMigrations(legacyDb));
        const applied = legacyDb
          .prepare("SELECT name FROM schema_migrations WHERE version = 118")
          .get() as { name: string } | undefined;
        const notes = legacyDb
          .prepare("SELECT COUNT(*) AS count FROM improvement_persistence_migration_notes WHERE migration_version = 118")
          .get() as { count: number };
        assert.equal(applied?.name, "improvement_recommendation_lifecycle_persistence");
        assert.equal(notes.count, 1);
      } finally {
        legacyDb.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    let coreRecommendationId = "";
    let evidenceSetId = "";
    let triggerFiringId = "";

    await test("stores trigger firing, evidence set, editable text, surfaces, and idempotency", () => {
      const firing = createImprovementTriggerFiring({
        companyId,
        triggerKey: "eval-case-returned-reviewer-note",
        triggerClass: "review_evidence",
        scopeType: "company",
        scopeKey: companyId,
        status: "needs_more_evidence",
        decisionReason: "Reviewer returned an eval case with missing setup evidence.",
        evidence: [{
          sourceType: "eval_case",
          sourceId: "eval-case-1",
          route: "/HIVE/evals?case=eval-case-1",
          summary: "Returned eval case had missing setup evidence.",
          payload: { token: "[REDACTED:api_key]" },
        }],
        thresholds: { minReturnedCases: 1 },
        metadata: { source: "test" },
      });
      triggerFiringId = firing.id;

      const evidenceSet = createImprovementEvidenceSet({
        companyId,
        triggerFiringId,
        summary: "One returned eval case plus reviewer rationale.",
        evidenceStrength: "single",
        evidenceItems: firing.evidence,
        redactionSummary: { apiKeys: 1 },
      });
      evidenceSetId = evidenceSet.id;

      const created = createImprovementRecommendation({
        companyId,
        triggerKey: firing.triggerKey,
        triggerClass: firing.triggerClass,
        title: "Add setup evidence checklist to reviewer handoff",
        rationale: "Returned eval cases are missing repeatable setup evidence.",
        proposedChange: "Add a checklist to the reviewer handoff template.",
        proposedChangeSummary: "Update reviewer handoff template with setup evidence checklist.",
        proposedChangeJson: { kind: "template_note", template: "reviewer-handoff" },
        severity: "high",
        confidence: "high",
        evidenceSetId,
        sourceTriggerFiringId: triggerFiringId,
        originalGeneratedText: "Generated recommendation text v1",
        operatorText: "Operator-edited recommendation text v1",
        affectedSurfaces: [{ type: "template", id: "reviewer-handoff", label: "Reviewer handoff" }],
        rollbackNotes: "Revert the template note or supersede with a corrected recommendation.",
        idempotencyKey: "ins-247-core-recommendation",
      });

      assert.equal(created.outcome, "created");
      assert.ok(created.recommendation);
      coreRecommendationId = created.recommendation.id;
      assert.equal(created.recommendation.evidenceSet?.id, evidenceSetId);
      assert.equal(created.recommendation.triggerFiring?.id, triggerFiringId);
      assert.equal(created.recommendation.operatorText, "Operator-edited recommendation text v1");
      assert.equal(created.recommendation.originalGeneratedText, "Generated recommendation text v1");
      assert.equal(created.recommendation.affectedSurfaces[0]?.type, "template");
      assert.equal(created.recommendation.proposedChangeJson.kind, "template_note");

      const replayed = createImprovementRecommendation({
        companyId,
        triggerKey: firing.triggerKey,
        triggerClass: firing.triggerClass,
        title: "Replay should not duplicate",
        idempotencyKey: "ins-247-core-recommendation",
      });
      const count = db
        .prepare("SELECT COUNT(*) AS count FROM improvement_recommendations WHERE idempotency_key = ?")
        .get("ins-247-core-recommendation") as { count: number };
      assert.equal(replayed.outcome, "existing");
      assert.equal(replayed.recommendation?.id, coreRecommendationId);
      assert.equal(count.count, 1);
    });

    await test("supports lifecycle statuses and normalized filters", () => {
      const needs = createImprovementRecommendation({
        companyId,
        triggerKey: "needs-more-evidence-fixture",
        triggerClass: "review_evidence",
        title: "Needs more evidence fixture",
        idempotencyKey: "ins-247-needs",
      }).recommendation;
      assert.ok(needs);
      assert.equal(
        updateImprovementRecommendationStatus({
          recommendationId: needs.id,
          status: "needs_more_evidence",
        }).status,
        "needs-more-evidence",
      );

      const accepted = createImprovementRecommendation({
        companyId,
        triggerKey: "accepted-fixture",
        triggerClass: "approval_bridge",
        title: "Accepted fixture",
        idempotencyKey: "ins-247-accepted",
      }).recommendation;
      assert.ok(accepted);
      const acceptedUpdated = updateImprovementRecommendationStatus({
        recommendationId: accepted.id,
        status: "accepted_for_approval",
      });
      assert.equal(acceptedUpdated.status, "accepted-for-approval");
      assert.ok(acceptedUpdated.acceptedAt);

      const dismissed = createImprovementRecommendation({
        companyId,
        triggerKey: "dismissed-fixture",
        triggerClass: "suppression",
        title: "Dismissed fixture",
        idempotencyKey: "ins-247-dismissed",
      }).recommendation;
      assert.ok(dismissed);
      const suppression = createImprovementSuppression({
        companyId,
        triggerKey: dismissed.triggerKey,
        triggerClass: dismissed.triggerClass,
        scopeType: "company",
        scopeKey: companyId,
        reason: "wrong_diagnosis",
        notes: "Fixture dismissal feedback.",
        sourceRecommendationId: dismissed.id,
        evidenceFingerprint: "returned-eval-case:v1",
      });
      const dismissedUpdated = updateImprovementRecommendationStatus({
        recommendationId: dismissed.id,
        status: "dismissed",
        dismissalReason: "wrong_diagnosis",
        dismissalNotes: "The diagnosis was not correct.",
        suppressionId: suppression.id,
      });
      assert.equal(dismissedUpdated.status, "dismissed");
      assert.equal(dismissedUpdated.suppression?.evidenceFingerprint, "returned-eval-case:v1");

      const replacement = createImprovementRecommendation({
        companyId,
        triggerKey: "replacement-fixture",
        triggerClass: "supersession",
        title: "Replacement fixture",
        idempotencyKey: "ins-247-replacement",
      }).recommendation;
      const superseded = createImprovementRecommendation({
        companyId,
        triggerKey: "superseded-fixture",
        triggerClass: "supersession",
        title: "Superseded fixture",
        idempotencyKey: "ins-247-superseded",
      }).recommendation;
      assert.ok(replacement);
      assert.ok(superseded);
      assert.equal(
        updateImprovementRecommendationStatus({
          recommendationId: superseded.id,
          status: "superseded",
          supersededByRecommendationId: replacement.id,
        }).supersededByRecommendationId,
        replacement.id,
      );

      const applied = createImprovementRecommendation({
        companyId,
        triggerKey: "applied-fixture",
        triggerClass: "approval_bridge",
        title: "Applied fixture",
        idempotencyKey: "ins-247-applied",
      }).recommendation;
      assert.ok(applied);
      const appliedUpdated = updateImprovementRecommendationStatus({
        recommendationId: applied.id,
        status: "applied",
      });
      assert.equal(appliedUpdated.status, "applied");
      assert.ok(appliedUpdated.appliedAt);

      const needsRows = listImprovementRecommendations({ companyId, status: "needs_more_evidence" });
      assert.ok(needsRows.some((row) => row.id === needs.id));
    });

    await test("links accepted recommendations to approvals without coupling approval status", () => {
      const recommendation = createImprovementRecommendation({
        companyId,
        triggerKey: "approval-link-fixture",
        triggerClass: "approval_bridge",
        title: "Approval link fixture",
        idempotencyKey: "ins-247-approval-link",
      }).recommendation;
      assert.ok(recommendation);

      const approvalId = "ins-247-approval";
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO approvals (
           id, company_id, type, status, payload_json, created_at, updated_at
         )
         VALUES (?, ?, 'hire_agent', 'pending', '{}', ?, ?)`,
      ).run(approvalId, companyId, now, now);

      const link = linkImprovementRecommendationApproval({
        recommendationId: recommendation.id,
        approvalId,
        status: "submitted",
        approvalPackage: { preview: "No durable mutation is applied by recommendation persistence." },
        rollbackNotes: "Cancel the approval or supersede the recommendation.",
      });
      assert.equal(link.approvalId, approvalId);

      const reloaded = getImprovementRecommendation(recommendation.id);
      assert.equal(reloaded?.status, "accepted-for-approval");
      assert.equal(reloaded?.approval?.id, approvalId);
      assert.equal(reloaded?.approval?.status, "pending");
      assert.equal(reloaded?.approvalLinks[0]?.approvalPackage.preview, "No durable mutation is applied by recommendation persistence.");
    });

    await test("already-applied recommendations suppress repeat suggestions for the same idempotency key", () => {
      const idempotencyKey = `ins-255-applied-repeat-${Date.now()}`;
      const first = suggestImprovementRecommendation({
        companyId,
        triggerKey: "missing_capability",
        triggerClass: "approval_bridge",
        scopeType: "company",
        scopeKey: companyId,
        title: "Applied repeat fixture",
        rationale: "The same evidence should not reopen a completed recommendation.",
        proposedChange: "Keep the previously applied recommendation terminal.",
        evidence: [{
          sourceType: "review",
          sourceId: "applied-repeat-review-1",
          summary: "Reviewer confirmed the explicit apply path has already completed.",
        }],
        idempotencyKey,
      });
      assert.equal(first.outcome, "created");
      assert.ok(first.recommendation);

      const applied = updateImprovementRecommendationStatus({
        recommendationId: first.recommendation.id,
        status: "applied",
      });
      assert.equal(applied.status, "applied");

      const repeat = suggestImprovementRecommendation({
        companyId,
        triggerKey: "missing_capability",
        triggerClass: "approval_bridge",
        scopeType: "company",
        scopeKey: companyId,
        title: "Applied repeat fixture",
        rationale: "The same evidence should stay suppressed once applied.",
        proposedChange: "Do not create a second recommendation.",
        evidence: [{
          sourceType: "review",
          sourceId: "applied-repeat-review-1",
          summary: "Reviewer confirmed the explicit apply path has already completed.",
        }],
        idempotencyKey,
      });

      assert.equal(repeat.outcome, "suppressed");
      assert.equal(repeat.reason, "already_applied");
      assert.equal(repeat.recommendation?.id, first.recommendation.id);
      assert.equal(repeat.recommendation?.status, "applied");
      assert.equal(repeat.firing?.status, "suppressed");
      assert.equal(repeat.firing?.decisionReason, "already_applied");
      assert.equal(repeat.suppression, null);

      const recommendationCount = db
        .prepare("SELECT COUNT(*) AS count FROM improvement_recommendations WHERE idempotency_key = ?")
        .get(idempotencyKey) as { count: number };
      assert.equal(recommendationCount.count, 1);
    });

    await test("optional readers tolerate recommendations without optional rows", () => {
      const created = createImprovementRecommendation({
        companyId,
        triggerKey: "optional-reader-fixture",
        triggerClass: "reader",
        title: "Optional reader fixture",
        idempotencyKey: "ins-247-optional-reader",
      }).recommendation;
      assert.ok(created);

      const reloaded = getImprovementRecommendation(created.id);
      assert.equal(reloaded?.evidenceSet, null);
      assert.equal(reloaded?.triggerFiring, null);
      assert.equal(reloaded?.suppression, null);
      assert.equal(reloaded?.approval, null);
      assert.deepEqual(listImprovementRecommendations({ companyId: "missing-company" }), []);
    });

    await test("write-disable rollback preserves existing evidence and blocks new Improve creation writes", () => {
      const beforeEvidence = db
        .prepare("SELECT COUNT(*) AS count FROM improvement_evidence_sets WHERE id = ?")
        .get(evidenceSetId) as { count: number };
      const beforeTriggerFiring = db
        .prepare("SELECT COUNT(*) AS count FROM improvement_trigger_firings WHERE id = ?")
        .get(triggerFiringId) as { count: number };
      assert.equal(beforeEvidence.count, 1);
      assert.equal(beforeTriggerFiring.count, 1);

      setImprovementRecommendationWritesEnabled({
        companyId,
        enabled: false,
        reason: "Rollback test disables new writes.",
      });
      const blocked = createImprovementRecommendation({
        companyId,
        triggerKey: "blocked-while-disabled",
        triggerClass: "rollback",
        title: "Should not persist",
        idempotencyKey: "ins-247-disabled",
      });
      assert.equal(blocked.outcome, "writes_disabled");
      assert.equal(blocked.recommendation, null);

      assert.throws(
        () => createImprovementTriggerFiring({
          id: "ins-247-disabled-trigger-firing",
          companyId,
          triggerKey: "blocked-trigger-while-disabled",
          triggerClass: "rollback",
          scopeType: "company",
          scopeKey: companyId,
          status: "skipped",
          decisionReason: "Should not persist while writes are disabled.",
        }),
        /writes are disabled/,
      );
      assert.throws(
        () => createImprovementEvidenceSet({
          companyId,
          summary: "Should not persist while writes are disabled.",
          evidenceStrength: "manual",
          evidenceItems: [{ sourceType: "manual", sourceId: "disabled-evidence" }],
        }),
        /writes are disabled/,
      );
      const blockedSuggestion = suggestImprovementRecommendation({
        companyId,
        triggerKey: "missing_capability",
        triggerClass: "rollback",
        scopeType: "company",
        scopeKey: companyId,
        title: "Should not persist through suggestion path",
        evidence: [{
          sourceType: "manual",
          sourceId: "disabled-suggestion",
          summary: "Rollback disabled suggestions should not create trigger firings.",
        }],
        idempotencyKey: "ins-247-disabled-suggestion",
      });
      assert.equal(blockedSuggestion.outcome, "writes_disabled");
      assert.equal(blockedSuggestion.firing, null);
      assert.equal(blockedSuggestion.recommendation, null);

      const afterEvidence = db
        .prepare("SELECT COUNT(*) AS count FROM improvement_evidence_sets WHERE id = ?")
        .get(evidenceSetId) as { count: number };
      const afterTriggerFiring = db
        .prepare("SELECT COUNT(*) AS count FROM improvement_trigger_firings WHERE id = ?")
        .get(triggerFiringId) as { count: number };
      const blockedCount = db
        .prepare("SELECT COUNT(*) AS count FROM improvement_recommendations WHERE idempotency_key = ?")
        .get("ins-247-disabled") as { count: number };
      const blockedTriggerCount = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM improvement_trigger_firings
           WHERE id = ?
              OR EXISTS (
                SELECT 1
                FROM json_each(CASE WHEN json_valid(evidence_json) THEN evidence_json ELSE '[]' END) evidence
                WHERE json_extract(evidence.value, '$.sourceId') = ?
              )`,
        )
        .get("ins-247-disabled-trigger-firing", "disabled-suggestion") as { count: number };
      const blockedEvidenceCount = db
        .prepare("SELECT COUNT(*) AS count FROM improvement_evidence_sets WHERE summary = ?")
        .get("Should not persist while writes are disabled.") as { count: number };
      const blockedSuggestionCount = db
        .prepare("SELECT COUNT(*) AS count FROM improvement_recommendations WHERE idempotency_key = ?")
        .get("ins-247-disabled-suggestion") as { count: number };
      assert.equal(afterEvidence.count, 1);
      assert.equal(afterTriggerFiring.count, 1);
      assert.equal(blockedCount.count, 0);
      assert.equal(blockedTriggerCount.count, 0);
      assert.equal(blockedEvidenceCount.count, 0);
      assert.equal(blockedSuggestionCount.count, 0);
      assert.ok(getImprovementRecommendation(coreRecommendationId));

      setImprovementRecommendationWritesEnabled({ companyId, enabled: true });
    });

    await test("rejects unredacted credential-like evidence payloads", () => {
      assert.throws(
        () => createImprovementEvidenceSet({
          companyId,
          evidenceItems: [{
            sourceType: "manual",
            sourceId: "unsafe",
            payload: { apiKey: "sk-proj-1234567890abcdefghijklmnopqrstuv" },
          }],
        }),
        /unredacted credential-like value/,
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
