import Database from "better-sqlite3";
import path from "path";

async function main() {
  const dbPath = path.resolve("data-dev/orchestration.db");
  console.log(`Seeding development database directly at: ${dbPath}`);
  const db = new Database(dbPath);

  const companyId = "cd9607f7-24bd-4596-9bcb-b3c013a75b7b"; // Insight (INS)
  const projectId = "85fa1adf-f883-4dbb-88de-55a9e021d8df"; // HiveRunner
  const agentId = "38f83cb3-02a4-45c2-bcce-693ce166c12c"; // Corey

  // Clear existing improvement tables for Insight to ensure idempotency
  console.log("Clearing existing improvement tables for company Insight...");
  db.prepare("DELETE FROM improvement_recommendations WHERE company_id = ?").run(companyId);
  db.prepare("DELETE FROM improvement_trigger_firings WHERE company_id = ?").run(companyId);
  db.prepare("DELETE FROM improvement_trigger_controls WHERE company_id = ?").run(companyId);
  db.prepare("DELETE FROM improvement_suppressions WHERE company_id = ?").run(companyId);

  // Recommendations seed data
  const recommendations = [
    {
      id: "improve-1",
      company_id: companyId,
      trigger_key: "repeated_review_return",
      scope_type: "agent",
      scope_key: agentId,
      title: "Improve queue regression coverage",
      rationale: "Repeated returned work shows this agent needs explicit TDD guidance.",
      proposed_change: "Attach the Red-Green TDD skill to the agent profile.",
      severity: "high",
      confidence: "high",
      status: "suggested",
      project_id: projectId,
      trigger_class: "repeated_review_return",
      evidence_json: JSON.stringify([{
        id: "ev-1",
        sourceType: "trace",
        sourceId: "run-improve-1",
        runId: "run-improve-1",
        taskId: "task-1",
        taskKey: "INS-230",
        evalCaseId: "eval-improve-1",
        title: "Returned run trace",
        summary: "Reviewer returned task. Secret sk-proj-1234567890abcdefghijklmnop should never leak. [redacted]",
        occurredAt: "2026-06-06T20:00:00.000Z",
      }]),
      original_recommendation_json: JSON.stringify({ category: "add_missing_skill" }),
      current_recommendation_json: JSON.stringify({ category: "add_missing_skill" }),
      rollback_notes: "Remove the skill assignment if it creates noisy behavior.",
    },
    {
      id: "improve-2",
      company_id: companyId,
      trigger_key: "repeated_review_return",
      scope_type: "agent",
      scope_key: agentId,
      title: "Improve runner testing guidelines",
      rationale: "Another repeated returned task.",
      proposed_change: "Add testing handbook doc.",
      severity: "high",
      confidence: "high",
      status: "needs-more-evidence",
      project_id: projectId,
      trigger_class: "repeated_review_return",
      evidence_json: JSON.stringify([{
        id: "ev-2",
        sourceType: "trace",
        sourceId: "run-improve-2",
        runId: "run-improve-2",
        taskId: "task-1",
        taskKey: "INS-230",
        title: "Returned run trace 2",
        summary: "Reviewer returned.",
        occurredAt: "2026-06-06T21:00:00.000Z",
      }]),
      original_recommendation_json: JSON.stringify({ category: "add_missing_skill" }),
      current_recommendation_json: JSON.stringify({ category: "add_missing_skill" }),
      rollback_notes: "Rollback if needed.",
    },
    {
      id: "improve-3",
      company_id: companyId,
      trigger_key: "missing_capability",
      scope_type: "agent",
      scope_key: "d346d727-d555-4795-a43f-ced7e835c943", // Denise
      title: "Missing Denise capability",
      rationale: "Denise needs additional tool routing.",
      proposed_change: "Add missing capability.",
      severity: "medium",
      confidence: "medium",
      status: "needs-more-evidence",
      project_id: projectId,
      trigger_class: "missing_capability",
      evidence_json: JSON.stringify([{
        id: "ev-3",
        sourceType: "team",
        sourceId: "d346d727-d555-4795-a43f-ced7e835c943",
        agentId: "d346d727-d555-4795-a43f-ced7e835c943",
        title: "Team review",
        summary: "Lacks tool routing.",
        occurredAt: "2026-06-06T22:00:00.000Z",
      }]),
      original_recommendation_json: JSON.stringify({ category: "missing_skill" }),
      current_recommendation_json: JSON.stringify({ category: "missing_skill" }),
      rollback_notes: "Rollback if needed.",
    },
    {
      id: "improve-4",
      company_id: companyId,
      trigger_key: "template_drift",
      scope_type: "template",
      scope_key: "template-improve-1",
      title: "Template drift warning",
      rationale: "Template requires updating.",
      proposed_change: "Apply drift template fix.",
      severity: "low",
      confidence: "low",
      status: "needs-more-evidence",
      project_id: projectId,
      trigger_class: "template_drift",
      evidence_json: JSON.stringify([{
        id: "ev-4",
        sourceType: "template",
        sourceId: "template-improve-1",
        templateVersionId: "template-improve-1",
        title: "Template warning",
        summary: "Drift detected.",
        occurredAt: "2026-06-06T23:00:00.000Z",
      }]),
      original_recommendation_json: JSON.stringify({ category: "template_capability_slot_change" }),
      current_recommendation_json: JSON.stringify({ category: "template_capability_slot_change" }),
      rollback_notes: "Rollback if needed.",
    },
    {
      id: "improve-5",
      company_id: companyId,
      trigger_key: "runner_mismatch",
      scope_type: "runner",
      scope_key: "runner-1",
      title: "Runner mismatch alert",
      rationale: "Mismatch between runner capabilities and task needs.",
      proposed_change: "Align execution lanes.",
      severity: "medium",
      confidence: "high",
      status: "needs-more-evidence",
      project_id: projectId,
      trigger_class: "runner_mismatch",
      evidence_json: JSON.stringify([{
        id: "ev-5",
        sourceType: "task",
        sourceId: "task-1",
        taskId: "task-1",
        taskKey: "INS-230",
        title: "Runner alert",
        summary: "Diverged capabilities.",
        occurredAt: "2026-06-07T00:00:00.000Z",
      }]),
      original_recommendation_json: JSON.stringify({ category: "missing_tool_or_runtime" }),
      current_recommendation_json: JSON.stringify({ category: "missing_tool_or_runtime" }),
      rollback_notes: "Rollback if needed.",
    },
    {
      id: "improve-6",
      company_id: companyId,
      trigger_key: "reviewer_request",
      scope_type: "recommendation",
      scope_key: "rec-1",
      title: "Reviewer requested policy update",
      rationale: "Explicit review-time request.",
      proposed_change: "Update review checkpoints.",
      severity: "low",
      confidence: "medium",
      status: "needs-more-evidence",
      project_id: projectId,
      trigger_class: "reviewer_request",
      evidence_json: JSON.stringify([{
        id: "ev-6",
        sourceType: "review",
        sourceId: "rec-1",
        title: "Reviewer notes",
        summary: "Policy checklist.",
        occurredAt: "2026-06-07T01:00:00.000Z",
      }]),
      original_recommendation_json: JSON.stringify({ category: "reviewer_note" }),
      current_recommendation_json: JSON.stringify({ category: "reviewer_note" }),
      rollback_notes: "Rollback if needed.",
    }
  ];

  console.log("Inserting recommendations...");
  const insertRec = db.prepare(`
    INSERT INTO improvement_recommendations (
      id, company_id, trigger_key, scope_type, scope_key, title, rationale, proposed_change,
      severity, confidence, status, evidence_json, original_recommendation_json,
      current_recommendation_json, project_id, trigger_class, rollback_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of recommendations) {
    insertRec.run(
      rec.id, rec.company_id, rec.trigger_key, rec.scope_type, rec.scope_key, rec.title, rec.rationale, rec.proposed_change,
      rec.severity, rec.confidence, rec.status, rec.evidence_json, rec.original_recommendation_json,
      rec.current_recommendation_json, rec.project_id, rec.trigger_class, rec.rollback_notes
    );
  }

  // Seed trigger controls (7 trigger definitions)
  console.log("Inserting trigger controls...");
  const insertControl = db.prepare(`
    INSERT INTO improvement_trigger_controls (
      company_id, trigger_key, enabled, threshold_json, updated_at
    ) VALUES (?, ?, 1, '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `);

  const triggerKeys = [
    "severe_single_failure",
    "repeated_review_return",
    "missing_capability",
    "missing_tool_runtime",
    "template_drift",
    "runner_mismatch",
    "reviewer_request",
  ];

  for (const key of triggerKeys) {
    insertControl.run(companyId, key);
  }

  // Seed a trigger firing to satisfy E2E expectations
  console.log("Inserting trigger firing...");
  db.prepare(`
    INSERT INTO improvement_trigger_firings (
      id, company_id, trigger_key, scope_type, scope_key, status, decision_reason, evidence_json, recommendation_id, fired_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `).run(
    "firing-1",
    companyId,
    "repeated_review_return",
    "agent",
    agentId,
    "created_recommendation",
    "Repeated review return observed",
    JSON.stringify([{ id: "ev-1", sourceType: "trace", title: "Trace evidence" }]),
    "improve-1"
  );

  db.close();
  console.log("✅ Direct database seeding complete!");
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
