import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

const isolation = createIsolatedOrchestrationWorkspace({
  prefix: "mc-review-decision-",
});

import { createCompany } from "@/lib/orchestration/company-service";
import { createCompanyMemoryRecord, listCompanyMemoryRecords } from "@/lib/orchestration/company-memory";
import {
  assignCompanySkillToAgent,
  createCompanySkill,
  listAgentSkillAssignments,
  listCompanySkills,
} from "@/lib/orchestration/company-skills";
import { OrchestrationApiError } from "@/lib/orchestration/api";
import { routeCompanyReviewCandidates } from "@/lib/orchestration/review-routing";
import { submitCompanyReviewDecision } from "@/lib/orchestration/review-decision";
import { createProject, createProjectAgent, createTask } from "@/lib/orchestration/service";
import { executeMcAction, parseActionsFromText } from "@/lib/orchestration/engine/engine";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  listCompanySkillEffectiveness,
  recordRuntimeSkillAvailabilityForRun,
  recordTaskSkillReviewOutcome,
} from "@/lib/orchestration/skill-effectiveness";
import { resolveCompanyAgentWorkspacePath } from "@/lib/workspaces/company-paths";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  PASS ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nOrchestration Review Decision Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  isolation.syncDatabase(getOrchestrationDb());
  const stamp = Date.now();
  const company = createCompany({
    name: `Review Decision Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Review Decision Project ${stamp}`,
    description: "fixture project",
    color: "#22d3ee",
    emoji: "icon:folder",
    status: "active",
  }).project;

  const bruce = createProjectAgent({
    projectId: project.id,
    name: "Bruce (Lead)",
    emoji: "icon:crown",
    role: "CEO / Product Lead",
    personality: "Lead fixture.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const ralph = createProjectAgent({
    projectId: project.id,
    name: "Ralph (Repo Steward)",
    emoji: "icon:git-branch",
    role: "Repo Steward",
    personality: "Release fixture.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const castor = createProjectAgent({
    projectId: project.id,
    name: "Castor (Legal)",
    emoji: "icon:scale",
    role: "Legal",
    personality: "Legal fixture.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const task = createTask({
    projectId: project.id,
    title: "Review decision fixture",
    description: "Fixture task.",
    priority: "P2",
    type: "research",
    status: "done",
    assignee: bruce.id,
    labels: [],
    createdBy: "test",
  }).task;

  const legalMemory = createCompanyMemoryRecord(company.id, {
    title: "Loan agreement compliance note",
    body: "Loan agreement disclosure and lending compliance constraints need legal review before reuse.",
    kind: "domain_constraint",
    scope: "project",
    status: "draft",
    source: "extractor",
    confidence: 0.76,
    projectId: project.id,
    agentId: bruce.id,
    taskId: task.id,
    reviewRequired: true,
    reviewState: "requested",
  }).memory;
  const releaseSkill = createCompanySkill(company.id, {
    name: "Release Steward Workflow",
    description: "Before pushing code, inspect git status, run tests, and report the commit.",
    slug: "release-steward-workflow",
    source: "learned",
    scope: "project",
    status: "draft",
    reviewRequired: true,
    reviewState: "requested",
  }).skill;
  const qaSkill = createCompanySkill(company.id, {
    name: "QA Verification Checklist",
    description: "Before accepting a build, inspect test evidence, browser behavior, and failure visibility.",
    slug: "qa-verification-checklist",
    source: "learned",
    scope: "project",
    status: "draft",
    reviewRequired: true,
    reviewState: "requested",
  }).skill;
  assignCompanySkillToAgent(company.id, {
    agentId: ralph.id,
    skillId: qaSkill.id,
    status: "draft",
    source: "learned",
  });

  routeCompanyReviewCandidates(company.id);

  await test("routed specialist can approve a memory candidate without human approval", () => {
    const result = submitCompanyReviewDecision(company.code, {
      targetType: "memory",
      targetId: legalMemory.id,
      decision: "approve",
      reviewerAgentId: castor.id,
      note: "Legal specialist accepts this durable constraint.",
      confidence: 0.94,
      source: "agent",
    });

    assert.strictEqual(result.memory?.status, "active");
    assert.strictEqual(result.memory?.reviewState, "approved");
    assert.strictEqual(result.memory?.reviewedByAgentId, castor.id);
    assert.strictEqual((result.memory?.metadata.reviewDecision as { reviewerAgentName?: string } | undefined)?.reviewerAgentName, castor.name);
  });

  await test("non-routed non-escalation agents cannot approve a routed candidate", () => {
    assert.throws(
      () => submitCompanyReviewDecision(company.id, {
        targetType: "skill",
        targetId: releaseSkill.id,
        decision: "approve",
        reviewerAgentId: castor.id,
        source: "agent",
      }),
      (error: unknown) => error instanceof OrchestrationApiError && error.code === "reviewer_not_authorized",
    );
  });

  await test("lead escalation reviewer can reject a routed skill candidate", () => {
    const result = submitCompanyReviewDecision(company.id, {
      targetType: "skill",
      targetId: releaseSkill.id,
      decision: "reject",
      reviewerAgentId: bruce.id,
      note: "Needs a clearer release checklist before activation.",
      confidence: 0.88,
      source: "agent",
    });

    assert.strictEqual(result.skill?.status, "archived");
    assert.strictEqual(result.skill?.reviewState, "rejected");
    assert.strictEqual(result.skill?.ownerAgentId, bruce.id);
    assert.strictEqual((result.skill?.metadata.reviewDecision as { decision?: string } | undefined)?.decision, "reject");

    const archivedSkill = listCompanySkills(company.id, { status: "all", includeArchived: true }).skills
      .find((skill) => skill.id === releaseSkill.id);
    assert.strictEqual(archivedSkill?.status, "archived");
  });

  await test("agent approval activates draft assignments for the approved skill", () => {
    const result = submitCompanyReviewDecision(company.id, {
      targetType: "skill",
      targetId: qaSkill.id,
      decision: "approve",
      reviewerAgentId: bruce.id,
      note: "QA checklist is specific enough for runtime use.",
      confidence: 0.91,
      source: "agent",
    });

    assert.strictEqual(result.skill?.status, "active");
    assert.strictEqual(result.skill?.reviewState, "approved");
    assert.strictEqual((result.skill?.metadata.reviewActivation as { activatedAssignmentCount?: number } | undefined)?.activatedAssignmentCount, 1);

    const assignments = listAgentSkillAssignments(company.id, { skillId: qaSkill.id, status: "all" }).assignments;
    assert.strictEqual(assignments.length, 1);
    assert.strictEqual(assignments[0]?.status, "active");
    assert.strictEqual(assignments[0]?.assignedByAgentId, bruce.id);

    const root = resolveCompanyAgentWorkspacePath(company.workspace.root, ralph.runtimeSlug || ralph.slug);
    assert.ok(root, "agent workspace root should resolve");
    const soul = readFileSync(path.join(root, "SOUL.md"), "utf8");
    assert.match(soul, /QA Verification Checklist/);
  });

  await test("review_candidate mc-action lets routed agents decide learned candidates", async () => {
    const learnedMemory = createCompanyMemoryRecord(company.id, {
      title: "QA correction memory",
      body: "A repeated QA correction should be retained as durable memory only after specialist approval.",
      kind: "workflow_note",
      scope: "project",
      status: "draft",
      source: "extractor",
      confidence: 0.74,
      projectId: project.id,
      agentId: ralph.id,
      taskId: task.id,
      reviewRequired: true,
      reviewState: "requested",
    }).memory;

    const routeResult = routeCompanyReviewCandidates(company.id, { target: "memory", reroute: true });
    const reviewTaskId = routeResult.assignments.find((assignment) => assignment.targetId === learnedMemory.id)?.reviewTaskId;
    assert.ok(reviewTaskId, "routing should create a review task");

    const parsed = parseActionsFromText(`\`\`\`mc-action\n${JSON.stringify({
      action: "review_candidate",
      targetType: "memory",
      targetId: learnedMemory.id,
      decision: "approve",
      note: "Specialist approved this as reusable QA memory.",
      confidence: 0.92,
    })}\n\`\`\``);
    assert.deepStrictEqual(parsed.parseErrors, []);
    assert.strictEqual(parsed.actions.length, 1);

    const outcome = await executeMcAction(
      parsed.actions[0]!,
      {
        agentId: bruce.id,
        agentName: bruce.name,
        companyId: company.id,
        taskKey: reviewTaskId,
        runId: "test-review-candidate-action",
      },
      getOrchestrationDb(),
    );

    assert.strictEqual(outcome.kind, "reviewed_candidate");
    const activeMemory = listCompanyMemoryRecords(company.id, { status: "active" }).memories
      .find((memory) => memory.id === learnedMemory.id);
    assert.ok(activeMemory, "review_candidate should activate approved memory");
    assert.strictEqual(activeMemory?.reviewState, "approved");
    assert.strictEqual((activeMemory?.metadata.reviewDecision as { source?: string } | undefined)?.source, "agent");

    const reviewTask = getOrchestrationDb()
      .prepare("SELECT status FROM tasks WHERE id = ? LIMIT 1")
      .get(reviewTaskId) as { status: string } | undefined;
    assert.strictEqual(reviewTask?.status, "done");
  });

  await test("skill effectiveness records availability, explicit use, and review outcomes", async () => {
    const db = getOrchestrationDb();
    const assignment = listAgentSkillAssignments(company.id, { skillId: qaSkill.id, status: "all" }).assignments[0];
    assert.ok(assignment, "skill assignment should exist");
    const executionRunId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO execution_runs
         (id, task_id, agent_id, provider, status, token_usage_json, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, 'codex', 'completed', ?, ?, ?, ?)`,
    ).run(
      executionRunId,
      task.id,
      ralph.id,
      JSON.stringify({
        runtimeSkills: [{
          id: qaSkill.id,
          slug: qaSkill.slug,
          name: qaSkill.name,
          version: 1,
          assignmentId: assignment.id,
        }],
      }),
      now,
      now,
      now,
    );

    assert.strictEqual(recordRuntimeSkillAvailabilityForRun(db, executionRunId), 1);
    assert.strictEqual(recordRuntimeSkillAvailabilityForRun(db, executionRunId), 0);
    assert.strictEqual(recordTaskSkillReviewOutcome(db, {
      taskId: task.id,
      outcome: "pass",
      reviewerAgentId: bruce.id,
    }), 1);
    const useOutcome = await executeMcAction(
      {
        action: "use_skill",
        skill: qaSkill.slug,
        taskKey: task.id,
        note: "Used during fixture verification.",
      },
      {
        agentId: ralph.id,
        agentName: ralph.name,
        companyId: company.id,
        taskKey: task.id,
        runId: "test-skill-effectiveness",
      },
      db,
    );
    assert.deepStrictEqual(useOutcome, { kind: "recorded_skill_use", inserted: true });
    const counts = db
      .prepare(
        `SELECT event_type, COUNT(*) AS count
         FROM skill_effectiveness_events
         WHERE execution_run_id = ?
         GROUP BY event_type
         ORDER BY event_type`,
      )
      .all(executionRunId) as Array<{ event_type: string; count: number }>;
    assert.deepStrictEqual(counts, [
      { event_type: "available", count: 1 },
      { event_type: "explicit_use", count: 1 },
      { event_type: "review_outcome", count: 1 },
    ]);
    const summary = listCompanySkillEffectiveness(company.id).summary.find((row) => row.skillId === qaSkill.id);
    assert.strictEqual(summary?.availableCount, 1);
    assert.strictEqual(summary?.explicitUseCount, 1);
    assert.strictEqual(summary?.passCount, 1);
  });

  await test("approved memory is durable in the active memory list", () => {
    const activeMemory = listCompanyMemoryRecords(company.id, { status: "active" }).memories
      .find((memory) => memory.id === legalMemory.id);
    assert.ok(activeMemory, "approved memory should be active");
    assert.strictEqual(activeMemory?.reviewedByAgentName, castor.name);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
