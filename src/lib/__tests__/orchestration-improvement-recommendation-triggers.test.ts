import assert from "node:assert/strict";

import { createSyncTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  BUILT_IN_RECOMMENDATION_TRIGGER_SOURCE_IDS,
  MAX_RECOMMENDATION_EVIDENCE_ITEMS,
  buildBuiltInImprovementRecommendations,
  type BuiltInImprovementTriggerInput,
} from "@/lib/orchestration/improvement-recommendation-triggers";

const { test, finish } = createSyncTestRunner({ passLabel: "pass", failLabel: "fail" });

console.log("\nImprovement Recommendation Trigger Source Tests\n");

function evidence(prefix: string, count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-evidence-${index + 1}`,
    source: index % 2 === 0 ? "run_trace" : "review",
    summary: `${prefix} evidence ${index + 1}: reviewer cited a repeated missing capability with local-only details.`,
    occurredAt: `2026-06-0${Math.min(index + 1, 9)}T12:00:00.000Z`,
    route: `/INS/tasks/${prefix.toUpperCase()}-${index + 1}`,
    metadata: {
      taskType: "feature",
      repeatedCount: index + 1,
      secretLikeValue: "sk-proj-1234567890abcdefghijklmnopqrstuv",
    },
  }));
}

const triggerInputs: BuiltInImprovementTriggerInput[] = [
  {
    source: "missing_skill",
    companyId: "company-1",
    agent: { id: "agent-backend", name: "Mannie", role: "Senior Back End Engineer" },
    skill: { name: "Red-Green TDD", reason: "Backend tasks repeatedly need behavior-focused test coverage." },
    taskType: "feature",
    evidence: evidence("missing-skill", 7),
  },
  {
    source: "missing_tool_runtime",
    companyId: "company-1",
    subject: { kind: "agent", id: "agent-browser", label: "Lens" },
    requirement: {
      kind: "runtime",
      name: "playwright-browser-automation",
      reason: "Browser proof was requested but the runtime capability was absent.",
    },
    evidence: evidence("missing-runtime", 3),
  },
  {
    source: "suggested_new_agent_role",
    companyId: "company-1",
    role: {
      name: "Security Review Specialist",
      capabilities: ["threat modeling", "release risk review"],
      reason: "Security-sensitive review work has no dedicated owner.",
    },
    scope: { kind: "task_type", id: "security-review", label: "Security review tasks" },
    evidence: evidence("new-role", 2),
  },
  {
    source: "bench_or_exclude_agent",
    companyId: "company-1",
    agent: { id: "agent-generalist", name: "Generalist", role: "Implementation Engineer" },
    action: "exclude",
    scope: { kind: "template", id: "template-release", label: "Release Hardening" },
    reason: "Reviewer returns show this agent should not be routed to release-hardening work.",
    evidence: evidence("bench-agent", 2),
  },
  {
    source: "template_capability_slot_change",
    companyId: "company-1",
    template: { id: "starter-sprint-build", name: "Build Something" },
    slot: { id: "verification", label: "Verification" },
    change: {
      action: "move_lane",
      fromLane: "useful",
      toLane: "required",
      reason: "Generated build sprints repeatedly add QA as a required gate.",
    },
    evidence: evidence("template-slot", 4),
  },
  {
    source: "reviewer_notes",
    companyId: "company-1",
    target: { kind: "eval_case", id: "eval-1", label: "Returned release eval case" },
    reviewer: { id: "agent-reviewer", name: "Gator" },
    notes: "Capture rollback checklist expectations directly on this eval case.",
    evidence: evidence("reviewer-notes", 2),
  },
];

test("defines only the v1 built-in trigger sources", () => {
  assert.deepEqual(BUILT_IN_RECOMMENDATION_TRIGGER_SOURCE_IDS, [
    "missing_skill",
    "missing_tool_runtime",
    "suggested_new_agent_role",
    "bench_or_exclude_agent",
    "template_capability_slot_change",
    "reviewer_notes",
  ]);
  assert.equal(BUILT_IN_RECOMMENDATION_TRIGGER_SOURCE_IDS.includes("custom_trigger_builder" as never), false);
});

test("creates bounded evidence-backed recommendations for every built-in source", () => {
  const result = buildBuiltInImprovementRecommendations(triggerInputs);

  assert.equal(result.skipped.length, 0);
  assert.equal(result.suppressed.length, 0);
  assert.equal(result.recommendations.length, triggerInputs.length);
  assert.deepEqual(
    result.recommendations.map((recommendation) => recommendation.triggerSource),
    BUILT_IN_RECOMMENDATION_TRIGGER_SOURCE_IDS,
  );

  for (const recommendation of result.recommendations) {
    assert.equal(recommendation.status, "suggested");
    assert.equal(recommendation.evidence.length > 0, true, `${recommendation.triggerSource} must cite evidence`);
    assert.equal(
      recommendation.evidence.length <= MAX_RECOMMENDATION_EVIDENCE_ITEMS,
      true,
      `${recommendation.triggerSource} must bound cited evidence`,
    );
    assert.match(recommendation.dedupeKey, /^built_in:/);
    assert.match(recommendation.evidenceFingerprint, /^[a-f0-9]{64}$/);
    assert.ok(recommendation.rationale.includes("Evidence:"), `${recommendation.triggerSource} must cite its evidence`);
    assert.ok(recommendation.proposedChange.length > 0, `${recommendation.triggerSource} must propose a change`);
    assert.ok(recommendation.rollbackNotes.length > 0, `${recommendation.triggerSource} must include correction notes`);
    assert.equal(JSON.stringify(recommendation.evidence).includes("sk-proj-"), false);
  }
});

test("maps each source to the low-risk recommendation type and trigger class", () => {
  const result = buildBuiltInImprovementRecommendations(triggerInputs);
  const bySource = new Map(result.recommendations.map((recommendation) => [recommendation.triggerSource, recommendation]));

  assert.equal(bySource.get("missing_skill")?.recommendationType, "add_missing_skill");
  assert.equal(bySource.get("missing_skill")?.triggerClass, "missing_capability");
  assert.equal(bySource.get("missing_tool_runtime")?.recommendationType, "configure_missing_tool_runtime");
  assert.equal(bySource.get("missing_tool_runtime")?.triggerClass, "missing_tool_runtime");
  assert.equal(bySource.get("suggested_new_agent_role")?.recommendationType, "suggest_new_agent_role");
  assert.equal(bySource.get("suggested_new_agent_role")?.triggerClass, "missing_capability");
  assert.equal(bySource.get("bench_or_exclude_agent")?.recommendationType, "bench_or_exclude_agent");
  assert.equal(bySource.get("bench_or_exclude_agent")?.triggerClass, "repeated_review_return");
  assert.equal(bySource.get("template_capability_slot_change")?.recommendationType, "change_template_capability_slot");
  assert.equal(bySource.get("template_capability_slot_change")?.triggerClass, "template_drift");
  assert.equal(bySource.get("reviewer_notes")?.recommendationType, "add_reviewer_notes");
  assert.equal(bySource.get("reviewer_notes")?.triggerClass, "reviewer_request");
});

test("company-scoped new-role recommendations cite the company affected surface", () => {
  const result = buildBuiltInImprovementRecommendations([{
    ...triggerInputs[2]!,
    scope: { kind: "company", id: "company-1", label: "Insight" },
  }]);

  assert.equal(result.recommendations.length, 1);
  assert.deepEqual(result.recommendations[0]?.affectedSurfaces, [
    { kind: "new_agent_role", label: "Security Review Specialist" },
    { kind: "company", id: "company-1", label: "Insight" },
  ]);
  assert.equal(result.recommendations[0]?.affectedSurfaces.some((surface) => surface.kind === "task_type"), false);
});

test("suppressed recommendations do not repeat without new evidence", () => {
  const first = buildBuiltInImprovementRecommendations([triggerInputs[0]!]);
  const recommendation = first.recommendations[0]!;
  const suppressed = buildBuiltInImprovementRecommendations([triggerInputs[0]!], {
    suppressions: [{
      id: "suppression-1",
      dedupeKey: recommendation.dedupeKey,
      evidenceFingerprint: recommendation.evidenceFingerprint,
    }],
  });

  assert.equal(suppressed.recommendations.length, 0);
  assert.equal(suppressed.suppressed.length, 1);
  assert.equal(suppressed.suppressed[0]?.suppressionId, "suppression-1");

  const withNewEvidence: BuiltInImprovementTriggerInput = {
    ...triggerInputs[0]!,
    evidence: [
      ...triggerInputs[0]!.evidence,
      {
        id: "missing-skill-evidence-new",
        source: "eval_case",
        summary: "A newly returned eval case cites the same missing skill after the prior dismissal.",
        occurredAt: "2026-06-10T12:00:00.000Z",
      },
    ],
  };
  const next = buildBuiltInImprovementRecommendations([withNewEvidence], {
    suppressions: [{
      id: "suppression-1",
      dedupeKey: recommendation.dedupeKey,
      evidenceFingerprint: recommendation.evidenceFingerprint,
    }],
  });

  assert.equal(next.suppressed.length, 0);
  assert.equal(next.recommendations.length, 1);
  assert.notEqual(next.recommendations[0]?.evidenceFingerprint, recommendation.evidenceFingerprint);
  assert.deepEqual(next.recommendations[0]?.supersedesSuppressionIds, ["suppression-1"]);
});

test("null or missing suppression fingerprints do not suppress changed evidence", () => {
  const first = buildBuiltInImprovementRecommendations([triggerInputs[0]!]);
  const recommendation = first.recommendations[0]!;
  const withNewEvidence: BuiltInImprovementTriggerInput = {
    ...triggerInputs[0]!,
    evidence: [
      ...triggerInputs[0]!.evidence,
      {
        id: "missing-skill-evidence-new-for-null-suppression",
        source: "eval_case",
        summary: "A newly returned eval case cites the same missing skill after an unfingerprinted dismissal.",
        occurredAt: "2026-06-11T12:00:00.000Z",
      },
    ],
  };
  const next = buildBuiltInImprovementRecommendations([withNewEvidence], {
    suppressions: [
      {
        id: "suppression-null-fingerprint",
        dedupeKey: recommendation.dedupeKey,
        evidenceFingerprint: null,
      },
      {
        id: "suppression-missing-fingerprint",
        dedupeKey: recommendation.dedupeKey,
      },
    ],
  });

  assert.equal(next.suppressed.length, 0);
  assert.equal(next.recommendations.length, 1);
  assert.notEqual(next.recommendations[0]?.evidenceFingerprint, recommendation.evidenceFingerprint);
  assert.deepEqual(next.recommendations[0]?.supersedesSuppressionIds, [
    "suppression-null-fingerprint",
    "suppression-missing-fingerprint",
  ]);
});

test("skips trigger inputs that have no citeable evidence", () => {
  const result = buildBuiltInImprovementRecommendations([{
    ...triggerInputs[1]!,
    evidence: [],
  }]);

  assert.equal(result.recommendations.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0]?.reason, "missing_evidence");
});

finish();
