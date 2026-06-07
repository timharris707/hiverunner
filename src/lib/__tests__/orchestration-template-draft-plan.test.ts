import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";

import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  tmpdir(),
  `orchestration-template-draft-plan-${process.pid}-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]", errorStackLines: 3 });

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/orchestration/companies/test/goals/goal/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function run() {
  console.log("\nOrchestration Template Draft Plan Tests\n");
  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

  const {
    createCompany,
    createCompanyGoal,
    approveSprintPlanDraft,
    generateTemplateDraftPlan,
  } = await import("@/lib/orchestration/company-service");
  const { getOrchestrationDb } = await import("@/lib/orchestration/db");
  const { createProject, createProjectAgent, listActivityFeed } = await import("@/lib/orchestration/service");
  const { updateCompanyHiringGovernanceSettings } = await import("@/lib/orchestration/service/hiring-governance");
  const { materializeTemplateCrewRecommendationGaps } = await import("@/lib/orchestration/template-crew-materialization");
  const { POST: postDraftsRoute } = await import("@/app/api/orchestration/companies/[slug]/goals/[goalId]/drafts/route");

  const db = getOrchestrationDb();
  const suffix = Date.now();
  const company = createCompany({
    name: `Template Draft Plan ${suffix}`,
    description: "Template draft plan fixture company.",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Template Draft Plan Project ${suffix}`,
    description: "Template draft plan fixture project.",
    color: "#14b8a6",
    emoji: "icon:layers",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: `Template Planner ${suffix}`,
    emoji: "icon:bot",
    role: "Planner",
    personality: "Deterministic test planner.",
    skills: [],
    status: "idle",
  }).agent;
  const activeProductAgent = createProjectAgent({
    projectId: project.id,
    name: `Template Product Analyst ${suffix}`,
    emoji: "icon:user-check",
    role: "Product Analyst",
    personality: "Shapes product acceptance criteria.",
    skills: [],
    status: "idle",
  }).agent;
  const activeFrontendAgent = createProjectAgent({
    projectId: project.id,
    name: `Template Front End Engineer ${suffix}`,
    emoji: "icon:monitor",
    role: "Front End Engineer",
    personality: "Handles responsive interface details.",
    skills: [],
    status: "idle",
  }).agent;
  const benchQaAgent = createProjectAgent({
    projectId: project.id,
    name: `Template QA Reviewer ${suffix}`,
    emoji: "icon:shield-check",
    role: "QA Reviewer",
    personality: "Verifies acceptance paths.",
    skills: [],
    status: "offline",
  }).agent;
  const benchReleaseAgent = createProjectAgent({
    projectId: project.id,
    name: `Template Release Coordinator ${suffix}`,
    emoji: "icon:send",
    role: "Release Coordinator",
    personality: "Prepares release handoffs.",
    skills: [],
    status: "error",
  }).agent;
  const companyGoal = createCompanyGoal({
    companyIdOrSlug: company.id,
    projectId: project.id,
    name: "Template draft generation goal",
    goal: "Generate starter sprint drafts without creating board tasks.",
    goalKind: "company",
    status: "active",
  }).goal;
  const routeGoal = createCompanyGoal({
    companyIdOrSlug: company.id,
    projectId: project.id,
    name: "Template draft route goal",
    goal: "Generate starter sprint drafts through the route.",
    goalKind: "company",
    status: "active",
  }).goal;
  function createGapFixture(label: string) {
    const gapSuffix = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const gapCompany = createCompany({
      name: `Template Gap ${gapSuffix}`,
      description: "Template crew materialization fixture company.",
      status: "active",
    }).company;
    const gapProject = createProject({
      companyId: gapCompany.id,
      name: `Template Gap Project ${gapSuffix}`,
      description: "Template crew materialization fixture project.",
      color: "#6366f1",
      emoji: "icon:users",
      status: "active",
    }).project;
    const requester = createProjectAgent({
      projectId: gapProject.id,
      name: `Template Gap Planner ${gapSuffix}`,
      emoji: "icon:bot",
      role: "Planner",
      personality: "Requests template crew materialization.",
      skills: [],
      status: "idle",
    }).agent;
    const gapGoal = createCompanyGoal({
      companyIdOrSlug: gapCompany.id,
      projectId: gapProject.id,
      name: `Template gap goal ${gapSuffix}`,
      goal: "Generate a starter sprint draft with crew gaps.",
      goalKind: "company",
      status: "active",
    }).goal;
    return { company: gapCompany, project: gapProject, requester, goal: gapGoal };
  }

  await test("service creates a repeatable template draft without board tasks", () => {
    const taskCountBefore = db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
    const first = generateTemplateDraftPlan({
      companyIdOrSlug: company.slug,
      companyGoalId: companyGoal.sprint.id,
      templateId: "build-something",
      submittedByAgentId: agent.id,
      answers: {
        buildType: "dashboard-widget",
        vibeOrConstraint: "quiet operator KPI board",
        ambitionLevel: "single-screen",
      },
    });

    assert.equal(first.created, true);
    assert.equal(first.createsBoardTasksImmediately, false);
    assert.equal(first.template.id, "build-something");
    assert.equal(first.template.templateVersionId, "build-something@1.0.0");
    assert.equal(first.intakeAnswer.normalizedAnswers.buildType, "dashboard-widget");
    assert.equal(first.intakeAnswer.normalizedAnswers.vibeOrConstraint, "quiet operator KPI board");
    assert.match(first.draftGoal.title, /Dashboard or widget/);
    assert.equal(first.draft.planningTaskId, null);
    assert.equal(first.draft.sourceTemplateVersionId, "build-something@1.0.0");
    assert.equal(first.draft.intakeAnswerId, first.intakeAnswer.id);
    assert.equal(first.draft.sprint.defaultExecutionEngine, "symphony");
    assert.equal(first.draft.sprint.defaultModelLane, "default");
    assert.ok(first.draft.tasks.length >= 3);
    assert.ok(first.draft.tasks.some((task) => task.dependsOn?.includes("shape-brief")));
    assert.ok(first.draft.tasks.every((task) => task.executionEngine === "symphony"));
    assert.ok(first.validationChecklist.length >= 3);
    assert.ok(first.reviewCriteria.evidence.length >= 2);
    assert.ok(first.crewRecommendation.required.length >= 3);
    assert.equal(first.crewRecommendation.autoApproveNewHires, false);
    const builderSlot = first.crewRecommendation.required.find((slot) => slot.id === "builder");
    const productSlot = first.crewRecommendation.required.find((slot) => slot.id === "product-shaping");
    const verificationSlot = first.crewRecommendation.required.find((slot) => slot.id === "verification");
    const frontendSlot = first.crewRecommendation.useful.find((slot) => slot.id === "frontend-specialist");
    const releaseSlot = first.crewRecommendation.later.find((slot) => slot.id === "release-notes");
    assert.equal(builderSlot?.lane, "required");
    assert.equal(builderSlot?.coverageStatus, "proposed_new_agent");
    assert.equal(builderSlot?.proposedAgent?.role, "Implementation Engineer");
    assert.equal(productSlot?.coverageStatus, "covered_by_active");
    assert.equal(productSlot?.matchedAgent?.id, activeProductAgent.id);
    assert.equal(productSlot?.matchedAgent?.rosterState, "active");
    assert.equal(verificationSlot?.coverageStatus, "covered_by_bench");
    assert.equal(verificationSlot?.matchedAgent?.id, benchQaAgent.id);
    assert.equal(verificationSlot?.matchedAgent?.rosterState, "bench");
    assert.equal(frontendSlot?.lane, "useful");
    assert.equal(frontendSlot?.coverageStatus, "covered_by_active");
    assert.equal(frontendSlot?.matchedAgent?.id, activeFrontendAgent.id);
    assert.equal(frontendSlot?.matchedAgent?.rosterState, "active");
    assert.equal(releaseSlot?.lane, "later");
    assert.equal(releaseSlot?.coverageStatus, "covered_by_bench");
    assert.equal(releaseSlot?.matchedAgent?.id, benchReleaseAgent.id);
    assert.deepEqual(first.draft.generationProvenance?.draftGoal, first.draftGoal);
    assert.deepEqual(first.draft.generationProvenance?.validationChecklist, first.validationChecklist);

    const storedDraft = db
      .prepare(
        `SELECT planning_task_id, source_template_version_id, intake_answer_id, generation_provenance_json
         FROM goal_sprint_plan_drafts
         WHERE id = ?`,
      )
      .get(first.draft.id) as {
        planning_task_id: string | null;
        source_template_version_id: string;
        intake_answer_id: string;
        generation_provenance_json: string;
      };
    assert.equal(storedDraft.planning_task_id, null);
    assert.equal(storedDraft.source_template_version_id, "build-something@1.0.0");
    assert.equal(storedDraft.intake_answer_id, first.intakeAnswer.id);
    assert.equal(JSON.parse(storedDraft.generation_provenance_json).source, "template_draft_plan_service");

    const generated = db
      .prepare(
        `SELECT generated_type, source_draft_id, generated_id
         FROM template_generated_work
         WHERE template_version_id = ? AND intake_answer_id = ?`,
      )
      .all("build-something@1.0.0", first.intakeAnswer.id) as Array<{
        generated_type: string;
        source_draft_id: string | null;
        generated_id: string;
      }>;
    assert.deepEqual(generated.map((row) => row.generated_type), ["sprint_plan_draft"]);
    assert.equal(generated[0]?.source_draft_id, first.draft.id);
    assert.equal(generated[0]?.generated_id, first.draft.id);

    const replay = generateTemplateDraftPlan({
      companyIdOrSlug: company.slug,
      companyGoalId: companyGoal.sprint.id,
      templateVersionId: "build-something@1.0.0",
      submittedByAgentId: agent.id,
      answers: {
        buildType: "dashboard-widget",
        vibeOrConstraint: "quiet operator KPI board",
        ambitionLevel: "single-screen",
      },
    });
    assert.equal(replay.created, false);
    assert.equal(replay.draft.id, first.draft.id);
    assert.equal(replay.intakeAnswer.id, first.intakeAnswer.id);

    const taskCountAfter = db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
    assert.equal(taskCountAfter.count, taskCountBefore.count);
  });

  await test("route creates and replays template drafts with explicit overrides", async () => {
    const taskCountBefore = db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
    const body = {
      templateId: "bug-triage",
      idempotencyKey: "route-bug-triage-draft",
      defaultExecutionEngine: "hiverunner",
      defaultModelLane: "fast",
      answers: {
        symptom: "The local template picker does not show a draft review.",
        expectedBehavior: "A reviewable draft appears before board tasks exist.",
        urgency: "soon",
        knownContext: "localhost:3010 goal detail",
      },
    };

    const firstResponse = await postDraftsRoute(jsonRequest(body) as never, {
      params: Promise.resolve({ slug: company.slug, goalId: routeGoal.sprint.id }),
    });
    assert.equal(firstResponse.status, 201);
    const first = await firstResponse.json() as Awaited<ReturnType<typeof generateTemplateDraftPlan>>;
    assert.equal(first.created, true);
    assert.equal(first.draft.sprint.defaultExecutionEngine, "hiverunner");
    assert.equal(first.draft.sprint.defaultModelLane, "fast");
    assert.ok(first.draft.tasks.every((task) => task.executionEngine === "hiverunner"));
    assert.equal(first.draft.sourceTemplateVersionId, "bug-triage@1.0.0");
    assert.equal(first.draft.intakeAnswerId, first.intakeAnswer.id);
    assert.match(first.reviewCriteria.description, /Template picker/i);

    const replayResponse = await postDraftsRoute(jsonRequest(body) as never, {
      params: Promise.resolve({ slug: company.slug, goalId: routeGoal.sprint.id }),
    });
    assert.equal(replayResponse.status, 200);
    const replay = await replayResponse.json() as Awaited<ReturnType<typeof generateTemplateDraftPlan>>;
    assert.equal(replay.created, false);
    assert.equal(replay.draft.id, first.draft.id);
    assert.equal(replay.intakeAnswer.id, first.intakeAnswer.id);

    const taskCountAfter = db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
    assert.equal(taskCountAfter.count, taskCountBefore.count);
  });

  await test("route materializes required crew gaps as paused approval-required hires", async () => {
    const fixture = createGapFixture("approval-required");
    const response = await postDraftsRoute(jsonRequest({
      templateId: "build-something",
      idempotencyKey: "crew-approval-required",
      materializeCrewRecommendations: true,
      materializeCrewRecommendationLanes: ["required"],
      submittedByAgentId: fixture.requester.id,
      answers: {
        buildType: "interactive-tool",
        vibeOrConstraint: "governed crew request",
        ambitionLevel: "tiny-proof",
      },
    }) as never, {
      params: Promise.resolve({ slug: fixture.company.slug, goalId: fixture.goal.sprint.id }),
    });
    assert.equal(response.status, 201);
    const payload = await response.json() as Awaited<ReturnType<typeof generateTemplateDraftPlan>>;
    assert.equal(payload.crewRecommendation.autoApproveNewHires, false);
    assert.equal(payload.crewRecommendation.materializedNewAgentCount, 0);
    assert.equal(payload.crewRecommendation.approvalRequiredNewAgentCount, payload.crewRecommendation.required.length);
    assert.ok(payload.crewRecommendation.required.length >= 3);
    assert.ok(payload.crewRecommendation.required.every((slot) => slot.coverageStatus === "pending_approval"));
    assert.ok(payload.crewRecommendation.required.every((slot) => slot.proposedAgent?.materialized === true));
    assert.ok(payload.crewRecommendation.required.every((slot) => slot.proposedAgent?.approvalRequired === true));
    assert.ok(payload.crewRecommendation.required.every((slot) => slot.proposedAgent?.approvalId));
    assert.ok(payload.crewRecommendation.required.every((slot) => slot.proposedAgent?.status === "paused"));
    assert.ok(payload.crewRecommendation.required.every((slot) => !slot.matchedAgent));

    const proposedAgentIds = payload.crewRecommendation.required
      .map((slot) => slot.proposedAgent?.agentId)
      .filter((value): value is string => Boolean(value));
    assert.equal(proposedAgentIds.length, payload.crewRecommendation.required.length);
    const statusRows = db.prepare(
      `SELECT id, status
       FROM agents
       WHERE id IN (${proposedAgentIds.map(() => "?").join(",")})`,
    ).all(...proposedAgentIds) as Array<{ id: string; status: string }>;
    assert.equal(statusRows.length, proposedAgentIds.length);
    assert.ok(statusRows.every((row) => row.status === "paused"), "Approval-required recommended hires must not become runnable before approval");
    const approvalRows = db.prepare(
      `SELECT id, status
       FROM approvals
       WHERE company_id = ?
         AND type = 'hire_agent'
         AND status = 'pending'`,
    ).all(fixture.company.id) as Array<{ id: string; status: string }>;
    assert.equal(approvalRows.length, payload.crewRecommendation.required.length);
  });

  await test("route materializes required crew gaps immediately when new hires are auto-approved", async () => {
    const fixture = createGapFixture("auto-approved");
    updateCompanyHiringGovernanceSettings({
      companyIdOrSlug: fixture.company.id,
      autoApproveNewHires: true,
      db,
    });
    const response = await postDraftsRoute(jsonRequest({
      templateId: "build-something",
      idempotencyKey: "crew-auto-approved",
      materializeCrewRecommendations: true,
      materializeCrewRecommendationLanes: ["required"],
      submittedByAgentId: fixture.requester.id,
      answers: {
        buildType: "dashboard-widget",
        vibeOrConstraint: "auto-approved crew request",
        ambitionLevel: "tiny-proof",
      },
    }) as never, {
      params: Promise.resolve({ slug: fixture.company.slug, goalId: fixture.goal.sprint.id }),
    });
    assert.equal(response.status, 201);
    const payload = await response.json() as Awaited<ReturnType<typeof generateTemplateDraftPlan>>;
    assert.equal(payload.crewRecommendation.autoApproveNewHires, true);
    assert.equal(payload.crewRecommendation.materializedNewAgentCount, payload.crewRecommendation.required.length);
    assert.equal(payload.crewRecommendation.approvalRequiredNewAgentCount, 0);
    assert.ok(payload.crewRecommendation.required.every((slot) => slot.coverageStatus === "auto_approved_new_agent"));
    assert.ok(payload.crewRecommendation.required.every((slot) => slot.matchedAgent?.rosterState === "active"));
    assert.ok(payload.crewRecommendation.required.every((slot) => slot.proposedAgent?.approvalRequired === false));

    const materializedAgentIds = payload.crewRecommendation.required
      .map((slot) => slot.matchedAgent?.id)
      .filter((value): value is string => Boolean(value));
    assert.equal(materializedAgentIds.length, payload.crewRecommendation.required.length);
    const statusRows = db.prepare(
      `SELECT id, status
       FROM agents
       WHERE id IN (${materializedAgentIds.map(() => "?").join(",")})`,
    ).all(...materializedAgentIds) as Array<{ id: string; status: string }>;
    assert.equal(statusRows.length, materializedAgentIds.length);
    assert.ok(statusRows.every((row) => row.status === "idle"));
    const approvalCount = db.prepare(
      `SELECT COUNT(*) AS count
       FROM approvals
       WHERE company_id = ?
         AND type = 'hire_agent'`,
    ).get(fixture.company.id) as { count: number };
    assert.equal(approvalCount.count, 0);
  });

  await test("materialization rechecks current hiring governance instead of trusting the draft snapshot", () => {
    const fixture = createGapFixture("governance-recheck");
    const draft = generateTemplateDraftPlan({
      companyIdOrSlug: fixture.company.slug,
      companyGoalId: fixture.goal.sprint.id,
      templateId: "build-something",
      submittedByAgentId: fixture.requester.id,
      answers: {
        buildType: "interactive-tool",
        vibeOrConstraint: "governance changed after draft generation",
        ambitionLevel: "tiny-proof",
      },
    });
    assert.equal(draft.crewRecommendation.autoApproveNewHires, false);

    updateCompanyHiringGovernanceSettings({
      companyIdOrSlug: fixture.company.id,
      autoApproveNewHires: true,
      db,
    });
    const materialized = materializeTemplateCrewRecommendationGaps({
      db,
      companyId: fixture.company.id,
      requestedByAgentId: fixture.requester.id,
      draftPlan: draft,
      lanes: ["required"],
    });

    assert.equal(materialized.crewRecommendation.autoApproveNewHires, true);
    assert.equal(materialized.crewRecommendation.materializedNewAgentCount, materialized.crewRecommendation.required.length);
    assert.equal(materialized.crewRecommendation.approvalRequiredNewAgentCount, 0);
    assert.ok(materialized.crewRecommendation.required.every((slot) => slot.coverageStatus === "auto_approved_new_agent"));
    assert.ok(materialized.crewRecommendation.required.every((slot) => slot.proposedAgent?.approvalRequired === false));
  });

  await test("Activity feed records compact template draft, crew, and board provenance", () => {
    const activityGoal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      name: "Template Activity provenance goal",
      goal: "Generate and approve a template draft for Activity provenance.",
      goalKind: "company",
      status: "active",
    }).goal;
    const draftPlan = generateTemplateDraftPlan({
      companyIdOrSlug: company.slug,
      companyGoalId: activityGoal.sprint.id,
      templateId: "build-something",
      submittedByAgentId: agent.id,
      idempotencyKey: "activity-template-provenance",
      answers: {
        buildType: "dashboard-widget",
        vibeOrConstraint: "compact activity metadata",
        ambitionLevel: "tiny-proof",
      },
    });

    const feedBeforeApproval = listActivityFeed({ limit: 40 });
    const draftEvent = feedBeforeApproval.activity.find((event) =>
      event.eventType === "template.draft_created" &&
      event.metadata?.draftId === draftPlan.draft.id
    );
    const crewEvent = feedBeforeApproval.activity.find((event) =>
      event.eventType === "template.crew_recommended" &&
      event.metadata?.draftId === draftPlan.draft.id
    );
    assert.ok(draftEvent, "expected template draft creation Activity event");
    assert.ok(crewEvent, "expected template crew recommendation Activity event");
    assert.equal(draftEvent?.metadata?.sourceTemplateVersionId, "build-something@1.0.0");
    assert.equal(draftEvent?.metadata?.taskCount, draftPlan.draft.tasks.length);
    assert.equal((draftEvent?.metadata?.sourceLinks as Record<string, unknown>).goal, `/${company.code}/goals/${encodeURIComponent(activityGoal.sprint.id)}`);
    assert.match(String((draftEvent?.metadata?.sourceLinks as Record<string, unknown>).draft), new RegExp(encodeURIComponent(draftPlan.draft.id)));
    const crew = crewEvent?.metadata?.crewRecommendation as Record<string, unknown>;
    assert.equal(crew.requiredCount, draftPlan.crewRecommendation.required.length);
    assert.equal(crew.usefulCount, draftPlan.crewRecommendation.useful.length);
    assert.equal(crew.laterCount, draftPlan.crewRecommendation.later.length);
    const serializedDraftActivity = JSON.stringify([draftEvent?.metadata, crewEvent?.metadata]);
    assert.doesNotMatch(serializedDraftActivity, /proposedAgent/);
    assert.doesNotMatch(serializedDraftActivity, /matchedAgent/);
    assert.doesNotMatch(serializedDraftActivity, /draftGoal/);
    assert.doesNotMatch(serializedDraftActivity, /validationChecklist/);

    const approval = approveSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId: activityGoal.sprint.id,
      draftId: draftPlan.draft.id,
      actorUserId: "operator",
    });
    const feedAfterApproval = listActivityFeed({ limit: 60 });
    const boardEvent = feedAfterApproval.activity.find((event) =>
      event.eventType === "template.board_created" &&
      event.metadata?.draftId === draftPlan.draft.id
    );
    assert.ok(boardEvent, "expected template board creation Activity event");
    assert.equal(boardEvent?.metadata?.sprintId, approval.sprint.sprint.id);
    assert.equal(boardEvent?.metadata?.taskCount, approval.taskIds.length);
    assert.equal((boardEvent?.metadata?.sourceLinks as Record<string, unknown>).sprint, `/${company.code}/goals/${encodeURIComponent(approval.sprint.sprint.id)}`);
    assert.doesNotMatch(JSON.stringify(boardEvent?.metadata), /tasks_json|taskPlan|reviewCriteria/);
  });

  await test("route rejects invalid intake before draft creation", async () => {
    const response = await postDraftsRoute(jsonRequest({
      templateId: "build-something",
      answers: {
        buildType: "dashboard-widget",
        ambitionLevel: "single-screen",
      },
    }) as never, {
      params: Promise.resolve({ slug: company.slug, goalId: routeGoal.sprint.id }),
    });
    assert.equal(response.status, 400);
    const payload = await response.json() as { error: { code: string; message: string } };
    assert.equal(payload.error.code, "missing_template_intake_answer");
  });

  finish();
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
