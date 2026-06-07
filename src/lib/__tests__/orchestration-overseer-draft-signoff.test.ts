import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  tmpdir(),
  `orchestration-overseer-draft-signoff-${process.pid}-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]", errorStackLines: 4 });

function hashDir(dir: string): string {
  const hash = crypto.createHash("sha256");
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        hash.update(full);
        hash.update(fs.readFileSync(full));
      }
    }
  };
  walk(dir);
  return hash.digest("hex");
}

async function run() {
  console.log("\nOrchestration Overseer Draft Signoff Tests\n");
  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

  const {
    createCompany,
    createCompanyGoal,
    createSprintPlanDrafts,
    updateSprintPlanDraft,
    listPendingSprintPlanDraftsForGoal,
  } = await import("@/lib/orchestration/company-service");
  const { createProject, createProjectAgent, listActivityFeed } = await import("@/lib/orchestration/service");
  const { createOverseerSession, listOverseerEvents } = await import("@/lib/orchestration/overseer/service");
  const {
    computeDraftContentHash,
    classifyDraftSignoffRisk,
    loadDraftReviewContext,
    recordReviewedDraftSnapshot,
    delegateDraftSignoff,
    evaluateDelegatedSignoff,
    applyDelegatedDraftSignoff,
    OVERSEER_DRAFT_SIGNOFF_DELEGATED_EVENT,
    OVERSEER_DRAFT_SIGNOFF_APPLIED_EVENT,
    OVERSEER_DRAFT_SIGNOFF_BLOCKED_EVENT,
    OVERSEER_DRAFT_REVIEW_EVENT,
  } = await import("@/lib/orchestration/overseer/draft-signoff");
  const { getOrchestrationDb } = await import("@/lib/orchestration/db");

  const db = getOrchestrationDb();
  const suffix = Date.now();
  const company = createCompany({
    name: `Draft Signoff ${suffix}`,
    description: "Delegated signoff fixture company.",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Draft Signoff Project ${suffix}`,
    description: "Delegated signoff fixture project.",
    color: "#14b8a6",
    emoji: "icon:layers",
    status: "active",
  }).project;
  const agentName = `Signoff Planner ${suffix}`;
  const agent = createProjectAgent({
    projectId: project.id,
    name: agentName,
    emoji: "icon:bot",
    role: "Planner",
    personality: "Deterministic signoff planner.",
    skills: [],
    status: "idle",
  }).agent;

  function newGoal(name: string) {
    return createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name,
      goal: "Signoff guard fixture goal.",
      goalKind: "company",
      status: "active",
    }).goal;
  }

  let sprintNameCounter = 0;
  function newLowRiskDraft(companyGoalId: string) {
    sprintNameCounter += 1;
    return createSprintPlanDrafts({
      companyIdOrSlug: company.id,
      companyGoalId,
      proposedByAgentId: agent.id,
      drafts: [
        {
          sequenceNumber: 1,
          sprint: {
            name: `Signoff sprint ${sprintNameCounter}`,
            objective: "Land a small reviewed slice.",
            defaultExecutionEngine: "symphony",
            defaultModelLane: "default",
          },
          tasks: [
            {
              id: "task-1",
              title: "Implement reviewed slice",
              description: "Small low-risk implementation.",
              assignee: agentName,
              priority: "P2",
              type: "feature",
              executionEngine: "symphony",
            },
          ],
        },
      ],
    }).drafts[0];
  }

  await test("content hash is stable and binds to draft substance", () => {
    const goal = newGoal("Hash binding goal");
    const draft = newLowRiskDraft(goal.sprint.id);
    const [reloaded] = listPendingSprintPlanDraftsForGoal({
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
    }).drafts;
    assert.equal(computeDraftContentHash(draft), computeDraftContentHash(reloaded));
    assert.equal(classifyDraftSignoffRisk(draft), "low");

    const mutated = updateSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
      tasks: [
        { ...draft.tasks[0], title: "Implement reviewed slice (scope creep)" },
      ],
    }).draft;
    assert.notEqual(computeDraftContentHash(draft), computeDraftContentHash(mutated));
  });

  await test("risk classifier flags completion proposals and oversized drafts", () => {
    const goal = newGoal("Risk classifier goal");
    const highDraft = createSprintPlanDrafts({
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      proposedByAgentId: agent.id,
      drafts: [
        {
          sequenceNumber: 1,
          sprint: { name: "Close goal", objective: "Done", completionProposal: true },
          tasks: [],
        },
      ],
    }).drafts[0];
    assert.equal(classifyDraftSignoffRisk(highDraft), "high");

    const manyTasks = Array.from({ length: 8 }, (_, i) => ({
      id: `t-${i}`,
      title: `Task ${i}`,
      assignee: agentName,
      executionEngine: "symphony" as const,
    }));
    const elevated = {
      ...highDraft,
      sprint: { ...highDraft.sprint, completionProposal: false },
      tasks: manyTasks,
    };
    assert.equal(classifyDraftSignoffRisk(elevated), "elevated");
  });

  await test("allowed low-risk signoff lands board tasks with audit evidence", () => {
    const goal = newGoal("Allowed signoff goal");
    const draft = newLowRiskDraft(goal.sprint.id);
    const session = createOverseerSession({ companyIdOrSlug: company.id, title: "Signoff session" }).session;

    const context = loadDraftReviewContext({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
    });
    assert.equal(context.drafts.length, 1);
    assert.equal(context.drafts[0].risk, "low");
    const reviewedHash = context.drafts[0].contentHash;

    const snapshot = recordReviewedDraftSnapshot({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
    }).snapshot;
    assert.equal(snapshot.contentHash, reviewedHash);

    delegateDraftSignoff({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
      reviewedContentHash: reviewedHash,
      allowRiskAtOrBelow: "low",
      reason: "Small reviewed slice, safe to land.",
    });

    const evaluation = evaluateDelegatedSignoff({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
    });
    assert.equal(evaluation.allowed, true);
    assert.equal(evaluation.evidence.hashMatched, true);

    const tasksBefore = db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
    const { approval } = applyDelegatedDraftSignoff({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
    });
    const tasksAfter = db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };

    assert.equal(approval.draft.status, "approved");
    assert.equal(approval.taskIds.length, 1);
    assert.equal(tasksAfter.count, tasksBefore.count + 1);

    const events = listOverseerEvents(session.id).events;
    const applied = events.find((event) => event.eventType === OVERSEER_DRAFT_SIGNOFF_APPLIED_EVENT);
    assert.ok(applied, "expected a signoff_applied audit event");
    assert.equal(applied?.event.contentHash, reviewedHash);
    assert.deepEqual(applied?.event.taskIds, approval.taskIds);
    assert.ok(
      events.some((event) => event.eventType === OVERSEER_DRAFT_REVIEW_EVENT),
      "expected a reviewed snapshot audit event",
    );

    const feed = listActivityFeed({ limit: 80 }).activity;
    const delegatedActivity = feed.find((event) =>
      event.eventType === OVERSEER_DRAFT_SIGNOFF_DELEGATED_EVENT &&
      event.metadata?.draftId === draft.id
    );
    const appliedActivity = feed.find((event) =>
      event.eventType === OVERSEER_DRAFT_SIGNOFF_APPLIED_EVENT &&
      event.metadata?.draftId === draft.id
    );
    assert.ok(delegatedActivity, "expected delegated signoff Activity event");
    assert.ok(appliedActivity, "expected applied signoff Activity event");
    assert.equal(delegatedActivity?.metadata?.reviewedContentHash, reviewedHash);
    assert.equal(appliedActivity?.metadata?.contentHash, reviewedHash);
    assert.equal(appliedActivity?.metadata?.taskCount, approval.taskIds.length);
    assert.equal(
      (appliedActivity?.metadata?.sourceLinks as Record<string, unknown>).goal,
      `/${company.code}/goals/${encodeURIComponent(goal.sprint.id)}`,
    );
    assert.match(
      String((appliedActivity?.metadata?.sourceLinks as Record<string, unknown>).draft),
      new RegExp(encodeURIComponent(draft.id)),
    );
    assert.equal(
      (appliedActivity?.metadata?.sourceLinks as Record<string, unknown>).overseer,
      `/${company.code}/overseer?session=${encodeURIComponent(session.id)}`,
    );
    const serializedSignoffActivity = JSON.stringify([delegatedActivity?.metadata, appliedActivity?.metadata]);
    assert.doesNotMatch(serializedSignoffActivity, /Implement reviewed slice/);
    assert.doesNotMatch(serializedSignoffActivity, /tasks_json|sprint_json|taskIds/);
  });

  await test("signoff is blocked after the reviewed draft is mutated", () => {
    const goal = newGoal("Changed draft goal");
    const draft = newLowRiskDraft(goal.sprint.id);
    const session = createOverseerSession({ companyIdOrSlug: company.id, title: "Changed draft session" }).session;

    const reviewedHash = recordReviewedDraftSnapshot({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
    }).snapshot.contentHash;
    delegateDraftSignoff({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
      reviewedContentHash: reviewedHash,
    });

    // Mutate the draft after delegation — the delegation is now stale.
    updateSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
      tasks: [{ ...draft.tasks[0], title: "Smuggled extra scope" }],
    });

    const evaluation = evaluateDelegatedSignoff({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
    });
    assert.equal(evaluation.allowed, false);
    assert.equal(evaluation.code, "draft_changed_since_review");

    const tasksBefore = db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
    assert.throws(
      () =>
        applyDelegatedDraftSignoff({
          sessionId: session.id,
          companyIdOrSlug: company.id,
          companyGoalId: goal.sprint.id,
          draftId: draft.id,
        }),
      /delegated_signoff_blocked|changed since/i,
    );
    const tasksAfter = db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
    assert.equal(tasksAfter.count, tasksBefore.count, "blocked signoff must not create board tasks");

    const stillPending = listPendingSprintPlanDraftsForGoal({
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
    }).drafts;
    assert.equal(stillPending.length, 1, "draft must remain pending after a blocked signoff");

    const blocked = listOverseerEvents(session.id).events.find(
      (event) => event.eventType === OVERSEER_DRAFT_SIGNOFF_BLOCKED_EVENT,
    );
    assert.ok(blocked, "expected a signoff_blocked audit event");
    const blockedActivity = listActivityFeed({ limit: 80 }).activity.find((event) =>
      event.eventType === OVERSEER_DRAFT_SIGNOFF_BLOCKED_EVENT &&
      event.metadata?.draftId === draft.id
    );
    assert.ok(blockedActivity, "expected blocked signoff Activity event");
    assert.equal(blockedActivity?.metadata?.code, "draft_changed_since_review");
    assert.equal(
      (blockedActivity?.metadata?.sourceLinks as Record<string, unknown>).goal,
      `/${company.code}/goals/${encodeURIComponent(goal.sprint.id)}`,
    );
    assert.equal(
      (blockedActivity?.metadata?.sourceLinks as Record<string, unknown>).overseer,
      `/${company.code}/overseer?session=${encodeURIComponent(session.id)}`,
    );
    const serializedBlockedActivity = JSON.stringify(blockedActivity?.metadata);
    assert.doesNotMatch(serializedBlockedActivity, /Smuggled extra scope/);
    assert.doesNotMatch(serializedBlockedActivity, /tasks_json|sprint_json|taskIds/);

    // Re-review + re-delegate against the new hash re-opens signoff.
    const [current] = stillPending;
    const newHash = computeDraftContentHash(current);
    assert.notEqual(newHash, reviewedHash);
    recordReviewedDraftSnapshot({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
    });
    delegateDraftSignoff({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
      reviewedContentHash: newHash,
    });
    const reEval = evaluateDelegatedSignoff({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
    });
    assert.equal(reEval.allowed, true, "re-review against the new hash should re-open signoff");
  });

  await test("delegation cannot escalate past its risk ceiling", () => {
    const goal = newGoal("Risk ceiling goal");
    const draft = createSprintPlanDrafts({
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      proposedByAgentId: agent.id,
      drafts: [
        {
          sequenceNumber: 1,
          sprint: { name: "Big sprint", objective: "Many tasks", defaultExecutionEngine: "symphony" },
          tasks: Array.from({ length: 8 }, (_, i) => ({
            id: `task-${i}`,
            title: `Task ${i}`,
            assignee: agentName,
            executionEngine: "symphony" as const,
          })),
        },
      ],
    }).drafts[0];
    const session = createOverseerSession({ companyIdOrSlug: company.id, title: "Risk ceiling session" }).session;
    const reviewedHash = recordReviewedDraftSnapshot({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
    }).snapshot.contentHash;
    delegateDraftSignoff({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
      reviewedContentHash: reviewedHash,
      allowRiskAtOrBelow: "low",
    });
    const evaluation = evaluateDelegatedSignoff({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
    });
    assert.equal(evaluation.allowed, false);
    assert.equal(evaluation.code, "risk_exceeds_delegation");
  });

  await test("signoff does not mutate the HiveRunner app source tree", () => {
    const goal = newGoal("No source mutation goal");
    const draft = newLowRiskDraft(goal.sprint.id);
    const session = createOverseerSession({ companyIdOrSlug: company.id, title: "No mutation session" }).session;
    const reviewedHash = recordReviewedDraftSnapshot({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
    }).snapshot.contentHash;
    delegateDraftSignoff({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
      reviewedContentHash: reviewedHash,
    });

    const overseerSourceDir = path.resolve(process.cwd(), "src/lib/orchestration/overseer");
    const before = hashDir(overseerSourceDir);
    applyDelegatedDraftSignoff({
      sessionId: session.id,
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: draft.id,
    });
    const after = hashDir(overseerSourceDir);
    assert.equal(after, before, "delegated signoff must not write to the app source tree");
  });

  finish();
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
