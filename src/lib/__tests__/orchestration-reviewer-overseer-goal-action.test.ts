import assert from "node:assert";

import { GET as exportCompanyRoute } from "@/app/api/orchestration/companies/[slug]/export/route";
import { POST as postApprovalRoute } from "@/app/api/orchestration/approvals/[id]/route";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { generateAgentDossier } from "@/lib/orchestration/agent-dossier";
import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { parseActionsFromText } from "@/lib/orchestration/engine/action-dispatcher";
import { createApproval } from "@/lib/orchestration/service/approval";
import { createProject, createProjectAgent } from "@/lib/orchestration/service";

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

function approvalRequest(body: unknown): Request {
  return new Request("http://localhost/api/orchestration/approvals/fixture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function run() {
  console.log("\nReviewer Hardening + Overseer Goal Action Tests\n");

  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

  await test("generated reviewer dossiers carry skeptical AI-work review posture", () => {
    const dossier = generateAgentDossier({
      name: "Gator",
      role: "QA Reviewer",
      companyName: "Fixture Co",
      projectName: "Fixture Project",
      projectSlug: "fixture-project",
      reportsTo: "Oracle",
      personality: "Calm in tone, but permanently skeptical in review.",
    });

    assert.match(dossier.files.soulMd, /AI-authored work may include shallow changes/);
    assert.match(dossier.files.soulMd, /Apply the same skepticism to sprint plans/);
    assert.match(dossier.files.agentsMd, /Approval Scope: QA pass\/fail, regression evidence, and acceptance verification/);
    assert.match(dossier.files.agentsMd, /Required handoff: Send approved code-release needs to Ralph/);
  });

  await test("Overseer create_goal mc-action parses as a protected write action", () => {
    const parsed = parseActionsFromText([
      "```mc-action",
      JSON.stringify({
        action: "create_goal",
        name: "Tougher review gate",
        goal: "Reviewer agents catch shallow AI-authored work before execution completes.",
        status: "active",
        stopCondition: "Gator rejects missing evidence and weak sprint plans.",
      }),
      "```",
    ].join("\n"));

    assert.deepStrictEqual(parsed.parseErrors, []);
    assert.strictEqual(parsed.actions.length, 1);
    assert.strictEqual(parsed.actions[0]?.action, "create_goal");
  });

  await test("company export carries skeptical reviewer posture for downloaded teams", async () => {
    const company = createCompany({
      name: `Reviewer Export Co ${Date.now()}`,
      description: "fixture",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: "Delivery",
      description: "fixture",
      color: "#0ea5e9",
      emoji: "target",
      status: "active",
    }).project;
    createProjectAgent({
      projectId: project.id,
      name: "Gator",
      role: "QA Reviewer",
      personality: "Laid-back in tone, strict about evidence.",
      status: "idle",
      skills: [],
    });
    createProjectAgent({
      projectId: project.id,
      name: "Forge",
      role: "Backend Engineer",
      personality: "Systematic",
      status: "idle",
      skills: [],
    });

    const res = await exportCompanyRoute(
      {
        nextUrl: new URL(
          `http://localhost/api/orchestration/companies/${company.slug}/export?categories=agents`,
        ),
      } as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = (await res.json()) as {
      agents: Array<{ name: string; personality?: string }>;
    };
    const gator = payload.agents.find((agent) => agent.name === "Gator");
    const forge = payload.agents.find((agent) => agent.name === "Forge");

    assert.match(gator?.personality ?? "", /AI-authored work may be plausible-looking/);
    assert.strictEqual(forge?.personality, "Systematic");
  });

  await test("approved Overseer create_goal action creates active goal and lead planning task", async () => {
    const company = createCompany({
      name: `Overseer Goal Co ${Date.now()}`,
      description: "fixture",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: "Delivery",
      description: "fixture",
      color: "#22c55e",
      emoji: "target",
      status: "active",
    }).project;
    const oracle = createProjectAgent({
      projectId: project.id,
      name: "Oracle",
      role: "Lead / Product Orchestrator",
      personality: "fixture",
      status: "idle",
      skills: [],
    }).agent;

    const action = {
      action: "create_goal",
      projectId: project.id,
      name: "Improve autonomous review quality",
      goal: "Reviewer agents catch shallow AI-authored work and weak plans before execution completes.",
      status: "active",
      leadAgentId: oracle.id,
      stopCondition: "A lead planning task exists and routes sprint work through explicit QA.",
      defaultExecutionEngine: "hiverunner",
      defaultModelLane: "deep",
    } as const;

    const approval = createApproval({
      companyIdOrSlug: company.id,
      type: "protected_runtime_command",
      payload: {
        source: "overseer",
        summary: "Overseer requested create_goal",
        command: JSON.stringify(action),
        reason: "Overseer state-changing actions require approval before execution.",
        actionType: "create_goal",
        action,
        risks: [{ code: "overseer_state_change" }],
      },
    }).approval;

    const res = await postApprovalRoute(
      approvalRequest({ action: "approve", decidedByUserId: "operator" }) as never,
      { params: Promise.resolve({ id: approval.id }) },
    );
    assert.strictEqual(res.status, 200);
    const payload = (await res.json()) as {
      approvedGoalCreation?: { goal?: { sprint?: { id?: string; status?: string } } };
    };
    const goalId = payload.approvedGoalCreation?.goal?.sprint?.id;
    assert.ok(goalId, "approved response should include created goal id");
    assert.strictEqual(payload.approvedGoalCreation?.goal?.sprint?.status, "active");

    const db = getOrchestrationDb();
    const planningTask = db.prepare(
      `SELECT id, status, assignee_agent_id, sprint_id, execution_engine, model_lane
       FROM tasks
       WHERE sprint_id = ?
         AND title = ?
         AND archived_at IS NULL
       LIMIT 1`,
    ).get(goalId, "Plan sprint for Improve autonomous review quality") as {
      id: string;
      status: string;
      assignee_agent_id: string | null;
      sprint_id: string;
      execution_engine: string | null;
      model_lane: string | null;
    } | undefined;

    assert.ok(planningTask, "active goal with lead agent should create a sprint-planning task");
    assert.strictEqual(planningTask.assignee_agent_id, oracle.id);
    assert.strictEqual(planningTask.status, "to-do");
    assert.strictEqual(planningTask.execution_engine, "hiverunner");
    assert.strictEqual(planningTask.model_lane, "deep");
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
