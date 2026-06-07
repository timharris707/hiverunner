import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { NextRequest } from "next/server";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import {
  createFixtureAgent,
  createFixtureProject,
} from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  tmpdir(),
  `orchestration-improve-api-${process.pid}-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]", errorStackLines: 3 });

function getRequest(url: string): NextRequest {
  return new NextRequest(url);
}

function patchRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function routeBody<T>(response: Response): Promise<{ status: number; body: T }> {
  return {
    status: response.status,
    body: await response.json() as T,
  };
}

async function run() {
  console.log("\nOrchestration Improve Recommendations API Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-improve-api-",
  });

  try {
    const { GET: listRoute } = await import("@/app/api/orchestration/companies/[slug]/improve/recommendations/route");
    const {
      GET: detailRoute,
      PATCH: patchRoute,
    } = await import("@/app/api/orchestration/companies/[slug]/improve/recommendations/[recommendationId]/route");
    const { createCompany } = await import("@/lib/orchestration/company-service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
    const {
      createImproveRecommendation,
    } = await import("@/lib/orchestration/improvement-recommendations");
    const {
      acceptCompanyImproveRecommendationForApproval,
      createCompanyImprovementSuppression,
      deactivateCompanyImprovementSuppression,
      dismissCompanyImproveRecommendation,
      editCompanyImproveRecommendation,
      listCompanyImproveRecommendations,
      setCompanyImprovementPaused,
      setCompanyImprovementTriggerEnabled,
      suppressCompanyImproveRecommendation,
      transitionCompanyImproveRecommendationStatus,
    } = await import("@/lib/orchestration/client");

    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);

    const stamp = Date.now();
    const company = createCompany({
      name: `Improve API ${stamp}`,
      description: "Improve queue API fixture.",
      status: "active",
    }).company;
    db.prepare("UPDATE companies SET company_code = ? WHERE id = ?").run("INS", company.id);

    const project = createFixtureProject(createProject, {
      companyId: company.id,
      namePrefix: "Improve API Project",
      label: "api",
      description: "Improve API route fixture.",
      color: "#22c55e",
      emoji: "I",
    });
    const agent = createFixtureAgent(createProjectAgent, {
      projectId: project.id,
      namePrefix: "ImproveRunner",
      openclawPrefix: "improve-runner",
      emoji: "R",
      role: "Implementation Engineer",
      skills: ["backend"],
    });
    const task = createTask({
      projectId: project.id,
      title: "Returned task with evidence",
      description: "Fixture source task.",
      priority: "P1",
      type: "feature",
      status: "review",
      labels: ["improve"],
      assignee: agent.id,
      createdBy: agent.id,
    }).task;
    const taskKey = task.key ?? task.id;

    const evidenceBacked = createImproveRecommendation({
      companyId: company.id,
      triggerKey: "missing_skill",
      scopeType: "agent",
      scopeKey: agent.id,
      title: "Add regression-testing skill",
      rationale: "Repeated returned work shows this agent needs explicit TDD guidance.",
      proposedChange: "Attach the Red-Green TDD skill to the agent profile.",
      severity: "high",
      confidence: "high",
      currentRecommendation: {
        category: "add_missing_skill",
        groupKey: "agent-capability",
        groupLabel: "Agent capability",
        summary: "Agent needs a missing testing skill.",
        riskNotes: "Low-risk profile metadata change.",
        rollbackNotes: "Remove the skill assignment if it creates noisy behavior.",
        tags: ["skills", "regression"],
      },
      evidence: [{
        id: "evidence-run-1",
        sourceType: "trace",
        sourceId: "run-improve-1",
        runId: "run-improve-1",
        taskId: task.id,
        taskKey,
        evalCaseId: "eval-improve-1",
        title: "Returned run trace",
        summary: "Reviewer returned the task for missing regression coverage. Secret sk-proj-1234567890abcdefghijklmnop should never leak.",
        occurredAt: "2026-06-06T20:00:00.000Z",
      }, {
        id: "evidence-template-1",
        sourceType: "template",
        sourceId: "template-improve-1",
        templateVersionId: "template-improve-1",
        title: "Template drift",
        summary: "The starter template missed the regression coverage expectation.",
      }, {
        id: "evidence-team-1",
        sourceType: "team",
        sourceId: agent.id,
        agentId: agent.id,
        title: "Team capability gap",
        summary: "The assigned agent lacks a regression-testing skill.",
      }, {
        id: "evidence-task-1",
        sourceType: "task",
        sourceId: task.id,
        taskId: task.id,
        taskKey,
        title: "Returned task",
        summary: "The source task was returned for missing test coverage.",
      }, {
        id: "evidence-sprint-1",
        sourceType: "sprint",
        sourceId: "sprint-improve-1",
        sprintKey: "sprint-improve-1",
        title: "Sprint review",
        summary: "The sprint review identified repeated testing gaps.",
      }, {
        id: "evidence-goal-1",
        sourceType: "goal",
        sourceId: "goal-improve-1",
        goalKey: "goal-improve-1",
        title: "Goal review",
        summary: "The goal review called out regression coverage as a repeated issue.",
      }],
      idempotencyKey: "improve-api-evidence-backed",
      createdByAgentId: agent.id,
    }, db);

    const missingEvidence = createImproveRecommendation({
      companyId: company.id,
      triggerKey: "reviewer_notes",
      scopeType: "project",
      scopeKey: project.id,
      title: "Clarify reviewer note policy",
      rationale: "A reviewer asked for a policy update but did not cite enough evidence.",
      proposedChange: "Add a reviewer-note capture checklist.",
      severity: "medium",
      confidence: "low",
      status: "needs-more-evidence",
      currentRecommendation: {
        category: "add_reviewer_notes",
        groupKey: "project-review",
        groupLabel: "Project review",
      },
      evidence: [{
        id: "missing-evidence",
        sourceType: "eval",
        sourceId: "eval-missing-1",
        title: "Missing eval evidence",
        summary: "",
        missingReason: "The source eval case has no redacted evidence summary yet.",
      }],
      idempotencyKey: "improve-api-missing-evidence",
    }, db);

    const suppressed = createImproveRecommendation({
      companyId: company.id,
      triggerKey: "bench_or_exclude_agent",
      scopeType: "agent",
      scopeKey: agent.id,
      title: "Bench agent from release work",
      rationale: "Release returns are not enough to act yet.",
      proposedChange: "Exclude the agent from release tasks.",
      severity: "low",
      confidence: "medium",
      evidence: [{
        id: "evidence-suppressed",
        sourceType: "task",
        sourceId: task.id,
        taskId: task.id,
        taskKey,
        title: "Task review",
        summary: "A release review referenced this task.",
      }],
      idempotencyKey: "improve-api-suppressed",
    }, db);
    await patchRoute(
      patchRequest(`http://localhost/api/orchestration/companies/${company.slug}/improve/recommendations/${suppressed.id}`, {
        action: "suppress",
        reason: "duplicate",
        notes: "Covered by another recommendation.",
        scopeType: "agent",
        scopeKey: agent.id,
      }),
      { params: Promise.resolve({ slug: company.slug, recommendationId: suppressed.id }) },
    );

    async function list(query = "") {
      return routeBody<{
        recommendations?: Array<{
          id: string;
          status: string;
          severity: string;
          confidence: string;
          title: string;
          category: string | null;
          evidence: { state: string; summaries: Array<{ summary: string; missingReason: string | null; links: Array<{ type: string; href: string }> }> };
        }>;
        total?: number;
        groups?: Array<{ key: string; label: string; count: number; recommendationIds: string[] }>;
        filters?: Record<string, unknown>;
      }>(
        await listRoute(getRequest(`http://localhost/api/orchestration/companies/${company.slug}/improve/recommendations${query}`), {
          params: Promise.resolve({ slug: company.slug }),
        }),
      );
    }

    async function detail(id: string) {
      return routeBody<{
        recommendation?: {
          id: string;
          status: string;
          title: string;
          proposedChange: string;
          evidence: { state: string; summaries: Array<{ summary: string; links: Array<{ type: string; href: string }> }> };
        };
        error?: { code: string };
      }>(
        await detailRoute(getRequest(`http://localhost/api/orchestration/companies/${company.slug}/improve/recommendations/${id}`), {
          params: Promise.resolve({ slug: company.slug, recommendationId: id }),
        }),
      );
    }

    await test("lists recommendations with filters, grouping, stable links, and redacted evidence", async () => {
      const response = await list("?status=suggested&severity=high&sourceType=trace&groupBy=category");

      assert.equal(response.status, 200);
      assert.equal(response.body.total, 1);
      assert.equal(response.body.recommendations?.[0]?.id, evidenceBacked.id);
      assert.equal(response.body.recommendations?.[0]?.category, "add_missing_skill");
      assert.equal(response.body.groups?.[0]?.key, "add_missing_skill");
      assert.deepEqual(response.body.groups?.[0]?.recommendationIds, [evidenceBacked.id]);

      const serialized = JSON.stringify(response.body);
      assert.doesNotMatch(serialized, /sk-proj-/);
      assert.match(serialized, /\[redacted\]/);

      const evidence = response.body.recommendations?.[0]?.evidence.summaries[0];
      assert.equal(evidence?.links.some((link) => link.type === "trace" && link.href === `/INS/tasks/${taskKey}/runs/run-improve-1`), true);
      assert.equal(evidence?.links.some((link) => link.type === "eval" && link.href === "/INS/evals/eval-improve-1"), true);

      const links = response.body.recommendations?.[0]?.evidence.summaries.flatMap((summary) => summary.links) ?? [];
      assert.equal(links.some((link) => link.type === "template" && link.href === "/INS/evals?template=template-improve-1"), true);
      assert.equal(links.some((link) => link.type === "team" && link.href === `/INS/team?agent=${agent.id}`), true);
      assert.equal(links.some((link) => link.type === "task" && link.href === `/INS/tasks/${taskKey}`), true);
      assert.equal(links.some((link) => link.type === "sprint" && link.href === "/INS/goals?sprint=sprint-improve-1"), true);
      assert.equal(links.some((link) => link.type === "goal" && link.href === "/INS/goals/goal-improve-1"), true);
    });

    await test("hides suppressed recommendations by default and can include them explicitly", async () => {
      const defaultList = await list();
      assert.equal(defaultList.body.recommendations?.some((recommendation) => recommendation.id === suppressed.id), false);

      const withSuppressed = await list("?includeSuppressed=true&status=dismissed");
      assert.equal(withSuppressed.body.recommendations?.some((recommendation) => recommendation.id === suppressed.id), true);
    });

    await test("detail reports missing evidence without inventing source summaries", async () => {
      const response = await detail(missingEvidence.id);

      assert.equal(response.status, 200);
      assert.equal(response.body.recommendation?.evidence.state, "missing");
      assert.equal(response.body.recommendation?.evidence.summaries[0]?.summary, "");
      assert.equal(response.body.recommendation?.evidence.summaries[0]?.links.some((link) => link.href === "/INS/evals/eval-missing-1"), true);
    });

    await test("edits recommendation copy and accepts only evidence-backed recommendations for approval", async () => {
      const edit = await routeBody<{ recommendation?: { title: string; proposedChange: string } }>(
        await patchRoute(
          patchRequest(`http://localhost/api/orchestration/companies/${company.slug}/improve/recommendations/${evidenceBacked.id}`, {
            action: "edit",
            title: "Add backend regression-testing skill",
            proposedChange: "Attach the Red-Green TDD skill and require one focused test for risky backend changes.",
            tags: ["skills", "backend", "regression"],
          }),
          { params: Promise.resolve({ slug: company.slug, recommendationId: evidenceBacked.id }) },
        ),
      );
      assert.equal(edit.status, 200);
      assert.equal(edit.body.recommendation?.title, "Add backend regression-testing skill");
      assert.match(edit.body.recommendation?.proposedChange ?? "", /focused test/);

      type AcceptedApprovalPackage = {
        schema?: string;
        recommendationIds?: string[];
        rollbackNotes?: string;
        evidence?: unknown[];
        improveBackLinks?: Array<{ href?: string }>;
      };

      const accepted = await routeBody<{
        recommendation?: { status: string; latestApprovalId: string | null; latestApprovalStatus: string | null };
        approval?: {
          id: string;
          type: string;
          status: string;
          payload: {
            source?: string;
            title?: string;
            improvementRecommendationId?: string | null;
            improvementRecommendationIds?: string[];
            improveBackLinks?: Array<{ href?: string }>;
            approvalPackage?: unknown;
          };
        };
        links?: Array<{ status: string; rollbackNotes: string }>;
      }>(
        await patchRoute(
          patchRequest(`http://localhost/api/orchestration/companies/${company.slug}/improve/recommendations/${evidenceBacked.id}`, {
            action: "accept_for_approval",
            note: "Ready for governed approval packaging.",
          }),
          { params: Promise.resolve({ slug: company.slug, recommendationId: evidenceBacked.id }) },
        ),
      );
      assert.equal(accepted.status, 200);
      assert.equal(accepted.body.recommendation?.status, "accepted-for-approval");
      assert.equal(accepted.body.recommendation?.latestApprovalId, accepted.body.approval?.id);
      assert.equal(accepted.body.recommendation?.latestApprovalStatus, "pending");
      assert.equal(accepted.body.approval?.type, "approve_ceo_strategy");
      assert.equal(accepted.body.approval?.status, "pending");
      assert.equal(accepted.body.approval?.payload.source, "improve");
      assert.equal(accepted.body.approval?.payload.title, "Add backend regression-testing skill");
      assert.equal(accepted.body.approval?.payload.improvementRecommendationId, evidenceBacked.id);
      assert.deepEqual(accepted.body.approval?.payload.improvementRecommendationIds, [evidenceBacked.id]);
      const approvalPackage = accepted.body.approval?.payload.approvalPackage as AcceptedApprovalPackage | undefined;
      assert.equal(approvalPackage?.schema, "hiverunner.improvement_approval_package.v1");
      assert.equal(approvalPackage?.recommendationIds?.[0], evidenceBacked.id);
      assert.equal(approvalPackage?.rollbackNotes, "Remove the skill assignment if it creates noisy behavior.");
      assert.equal(approvalPackage?.evidence?.length, 6);
      assert.equal(approvalPackage?.improveBackLinks?.[0]?.href, `/INS/improve?recommendation=${evidenceBacked.id}`);
      assert.equal(accepted.body.approval?.payload.improveBackLinks?.[0]?.href, `/INS/improve?recommendation=${evidenceBacked.id}`);
      assert.doesNotMatch(JSON.stringify(accepted.body.approval?.payload), /sk-proj-/);
      assert.equal(accepted.body.links?.[0]?.status, "submitted");
      assert.equal(accepted.body.links?.[0]?.rollbackNotes, "Remove the skill assignment if it creates noisy behavior.");
    });

    await test("rejects invalid mutations and invalid status transitions", async () => {
      const badEdit = await routeBody<{ error?: { code: string } }>(
        await patchRoute(
          patchRequest(`http://localhost/api/orchestration/companies/${company.slug}/improve/recommendations/${missingEvidence.id}`, {
            action: "edit",
            severity: "urgent",
          }),
          { params: Promise.resolve({ slug: company.slug, recommendationId: missingEvidence.id }) },
        ),
      );
      assert.equal(badEdit.status, 400);
      assert.equal(badEdit.body.error?.code, "validation_error");

      const missingAccept = await routeBody<{ error?: { code: string } }>(
        await patchRoute(
          patchRequest(`http://localhost/api/orchestration/companies/${company.slug}/improve/recommendations/${missingEvidence.id}`, {
            action: "accept_for_approval",
          }),
          { params: Promise.resolve({ slug: company.slug, recommendationId: missingEvidence.id }) },
        ),
      );
      assert.equal(missingAccept.status, 400);
      assert.equal(missingAccept.body.error?.code, "evidence_required");

      const invalidTransition = await routeBody<{ error?: { code: string } }>(
        await patchRoute(
          patchRequest(`http://localhost/api/orchestration/companies/${company.slug}/improve/recommendations/${suppressed.id}`, {
            action: "transition",
            status: "applied",
          }),
          { params: Promise.resolve({ slug: company.slug, recommendationId: suppressed.id }) },
        ),
      );
      assert.equal(invalidTransition.status, 400);
      assert.equal(invalidTransition.body.error?.code, "invalid_improvement_status_transition");
    });

    await test("client helpers encode Improve filters, grouping, and mutation actions", async () => {
      const originalFetch = globalThis.fetch;
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const clientRecommendation = {
        id: "client-rec-1",
        companyId: company.id,
        triggerKey: "missing_skill",
        scope: { type: "agent", key: agent.id },
        scopeType: "agent",
        scopeKey: agent.id,
        title: "Client contract recommendation",
        rationale: "Client helper fixture.",
        proposedChange: "Use the public Improve client helpers.",
        severity: "high",
        confidence: "medium",
        status: "suggested",
        evidence: { state: "present", summaries: [] },
        originalRecommendation: {},
        currentRecommendation: { category: "client_contract" },
        dismissalReason: null,
        dismissalNotes: null,
        dismissedAt: null,
        suppressionId: null,
        supersededByRecommendationId: null,
        approvalId: null,
        idempotencyKey: null,
        createdByAgentId: null,
        createdByUserId: null,
        createdAt: "2026-06-06T21:00:00.000Z",
        updatedAt: "2026-06-06T21:00:00.000Z",
      };

      globalThis.fetch = (async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        const method = init?.method ?? "GET";
        const body = method === "PATCH" && url.includes("/improve/recommendations/")
          ? { recommendation: clientRecommendation }
          : method === "PATCH"
            ? {
                companyControl: {
                  companyId: company.id,
                  automationPaused: false,
                  pausedReason: null,
                  pausedAt: null,
                  updatedAt: "2026-06-06T21:00:00.000Z",
                },
                triggers: [],
                recommendations: [],
                firings: [],
                suppressions: [],
              }
          : {
              recommendations: [clientRecommendation],
              total: 1,
              filters: {},
              groups: [{ key: "client_contract", label: "Client contract", count: 1, recommendationIds: ["client-rec-1"] }],
            };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      try {
        const listed = await listCompanyImproveRecommendations("INS", {
          status: ["suggested", "needs-more-evidence"],
          severity: ["high"],
          confidence: ["medium"],
          sourceType: ["trace", "task"],
          triggerKey: "missing_skill",
          category: "client_contract",
          scopeType: "agent",
          scopeKey: agent.id,
          projectId: project.id,
          agentId: agent.id,
          search: "coverage",
          evidenceState: "present",
          includeSuppressed: true,
          groupBy: "category",
          limit: 25,
        });

        assert.equal(listed.total, 1);
        assert.equal(listed.recommendations[0]?.id, "client-rec-1");
        assert.equal(listed.groups[0]?.key, "client_contract");

        const listUrl = new URL(calls[0]?.url ?? "", "http://localhost");
        assert.equal(listUrl.pathname, "/api/orchestration/companies/INS/improve/recommendations");
        assert.deepEqual(listUrl.searchParams.getAll("status"), ["suggested", "needs-more-evidence"]);
        assert.deepEqual(listUrl.searchParams.getAll("sourceType"), ["trace", "task"]);
        assert.equal(listUrl.searchParams.get("groupBy"), "category");
        assert.equal(listUrl.searchParams.get("includeSuppressed"), "true");
        assert.equal(listUrl.searchParams.get("limit"), "25");

        await editCompanyImproveRecommendation("INS", "client-rec-1", { title: "Edited client rec" });
        await dismissCompanyImproveRecommendation("INS", "client-rec-1", { reason: "not_now", notes: "Later" });
        await suppressCompanyImproveRecommendation("INS", "client-rec-1", {
          reason: "duplicate",
          scopeType: "agent",
          scopeKey: agent.id,
        });
        await acceptCompanyImproveRecommendationForApproval("INS", "client-rec-1", {
          note: "Ready",
          title: "Approval package",
        });
        await transitionCompanyImproveRecommendationStatus("INS", "client-rec-1", {
          status: "superseded",
          supersededByRecommendationId: "client-rec-2",
        });
        await setCompanyImprovementPaused("INS", { paused: true, reason: "Testing" });
        await setCompanyImprovementTriggerEnabled("INS", { triggerKey: "missing_capability", enabled: false });
        await createCompanyImprovementSuppression("INS", {
          triggerKey: "missing_tool_runtime",
          scopeType: "agent",
          scopeKey: agent.id,
          reason: "not_now",
          notes: "No repeat",
        });
        await deactivateCompanyImprovementSuppression("INS", "suppression-client-1");

        const mutationActions = calls.slice(1).map((call) => {
          assert.equal(call.init?.method, "PATCH");
          return JSON.parse(typeof call.init?.body === "string" ? call.init.body : "{}") as Record<string, unknown>;
        });
        assert.deepEqual(
          mutationActions.map((body) => body.action),
          [
            "edit",
            "dismiss",
            "suppress",
            "accept_for_approval",
            "transition",
            "set_company_pause",
            "set_trigger_enabled",
            "create_suppression",
            "deactivate_suppression",
          ],
        );
        assert.equal(mutationActions[2]?.scopeKey, agent.id);
        assert.equal(mutationActions[4]?.supersededByRecommendationId, "client-rec-2");
        assert.equal(mutationActions[7]?.scopeKey, agent.id);
        assert.equal(mutationActions[8]?.suppressionId, "suppression-client-1");
      } finally {
        globalThis.fetch = originalFetch;
      }
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
