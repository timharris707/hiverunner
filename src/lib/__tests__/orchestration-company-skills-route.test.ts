import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import {
  GET as listCompanySkillsRoute,
  PATCH as patchCompanySkillsRoute,
  POST as createCompanySkillsRoute,
} from "@/app/api/orchestration/companies/[slug]/skills/route";
import {
  GET as listSkillAssignmentsRoute,
  PATCH as patchSkillAssignmentsRoute,
  POST as createSkillAssignmentsRoute,
} from "@/app/api/orchestration/companies/[slug]/skills/assignments/route";
import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { createProject, createProjectAgent } from "@/lib/orchestration/service";
import { listCompanySkillEffectiveness } from "@/lib/orchestration/skill-effectiveness";
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

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function run() {
  console.log("\nOrchestration Company Skills Route Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const stamp = Date.now();
  const company = createCompany({
    name: `Skill Registry Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Skill Registry Project ${stamp}`,
    description: "fixture project",
    color: "#22d3ee",
    emoji: "icon:folder",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: `Skill Registry Agent ${stamp}`,
    emoji: "icon:bot",
    role: "Implementation Engineer",
    personality: "Precise test fixture agent.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;

  let createdId = "";
  let draftOnlySkillId = "";
  let replacementSkillId = "";
  let assignmentId = "";

  await test("GET returns an empty company skill registry", async () => {
    const req = { nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.slug}/skills`) };
    const res = await listCompanySkillsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as { skills: unknown[] };
    assert.deepStrictEqual(payload.skills, []);
  });

  await test("POST creates a draft company skill with version metadata", async () => {
    const res = await createCompanySkillsRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/skills`, {
        name: "LoanMeld repo orientation",
        description: "Orient agents to the LoanMeld codebase before implementation.",
        source: "seed",
        scope: "project",
        metadata: { project: "LoanMeld" },
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 201);
    const payload = await res.json() as {
      skill: {
        id: string;
        slug: string;
        status: string;
        version: number;
        source: string;
        scope: string;
        metadata: { project?: string };
      };
    };
    createdId = payload.skill.id;
    assert.strictEqual(payload.skill.slug, "loanmeld-repo-orientation");
    assert.strictEqual(payload.skill.status, "draft");
    assert.strictEqual(payload.skill.version, 1);
    assert.strictEqual(payload.skill.source, "seed");
    assert.strictEqual(payload.skill.scope, "project");
    assert.strictEqual(payload.skill.metadata.project, "LoanMeld");
  });

  await test("PATCH rejects activating a review-required skill before approval", async () => {
    const res = await patchCompanySkillsRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/skills`, {
        id: createdId,
        status: "active",
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 400);
    const payload = await res.json() as { error?: { code?: string } };
    assert.strictEqual(payload.error?.code, "skill_review_required");
  });

  await test("POST creates a second draft skill for runtime eligibility checks", async () => {
    const res = await createCompanySkillsRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/skills`, {
        name: "Draft-only runtime skill",
        description: "Should not be runtime assignable until approved and active.",
        source: "seed",
        scope: "project",
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 201);
    const payload = await res.json() as { skill: { id: string; status: string } };
    draftOnlySkillId = payload.skill.id;
    assert.strictEqual(payload.skill.status, "draft");
  });

  await test("POST rejects active assignment for an inactive skill", async () => {
    const res = await createSkillAssignmentsRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/skills/assignments`, {
        agentId: agent.id,
        skillId: draftOnlySkillId,
        status: "active",
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 400);
    const payload = await res.json() as { error?: { code?: string } };
    assert.strictEqual(payload.error?.code, "skill_not_active");
  });

  await test("PATCH updates status and bumps the skill version", async () => {
    const res = await patchCompanySkillsRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/skills`, {
        id: createdId,
        status: "active",
        reviewState: "approved",
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      skill: {
        status: string;
        reviewState: string;
        version: number;
        metadata: { runtimeExport?: { exported?: boolean; path?: string; version?: number } };
      };
    };
    assert.strictEqual(payload.skill.status, "active");
    assert.strictEqual(payload.skill.reviewState, "approved");
    assert.strictEqual(payload.skill.version, 2);
    assert.strictEqual(payload.skill.metadata.runtimeExport?.exported, true);
    assert.strictEqual(payload.skill.metadata.runtimeExport?.version, 2);
    assert.ok(payload.skill.metadata.runtimeExport?.path);
    assert.ok(existsSync(payload.skill.metadata.runtimeExport.path));
    assert.match(readFileSync(payload.skill.metadata.runtimeExport.path, "utf8"), /name: loanmeld-repo-orientation/);
  });

  await test("GET can filter active company skills", async () => {
    const req = {
      nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.slug}/skills?status=active`),
    };
    const res = await listCompanySkillsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as { skills: Array<{ id: string; status: string }> };
    assert.strictEqual(payload.skills.length, 1);
    assert.strictEqual(payload.skills[0].id, createdId);
    assert.strictEqual(payload.skills[0].status, "active");
  });

  await test("POST assigns a company skill to an agent as draft", async () => {
    const res = await createSkillAssignmentsRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/skills/assignments`, {
        agentId: agent.id,
        skillId: createdId,
        status: "draft",
        source: "manual",
        notes: "Fixture assignment",
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 201);
    const payload = await res.json() as {
      assignment: {
        id: string;
        agentId: string;
        agentName: string;
        skillId: string;
        status: string;
        notes: string;
      };
    };
    assignmentId = payload.assignment.id;
    assert.strictEqual(payload.assignment.agentId, agent.id);
    assert.strictEqual(payload.assignment.skillId, createdId);
    assert.strictEqual(payload.assignment.status, "draft");
    assert.strictEqual(payload.assignment.notes, "Fixture assignment");
    assert.ok(payload.assignment.agentName.includes("Skill Registry Agent"));
  });

  await test("PATCH activates an agent skill assignment", async () => {
    const res = await patchSkillAssignmentsRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/skills/assignments`, {
        id: assignmentId,
        status: "active",
        notes: "Ready for runtime export later",
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );

    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      assignment: { status: string; notes: string };
    };
    assert.strictEqual(payload.assignment.status, "active");
    assert.strictEqual(payload.assignment.notes, "Ready for runtime export later");
  });

  await test("GET lists skill assignments and company skill assignment counts", async () => {
    const assignmentReq = {
      nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.slug}/skills/assignments?status=active`),
    };
    const assignmentRes = await listSkillAssignmentsRoute(assignmentReq as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(assignmentRes.status, 200);
    const assignmentPayload = await assignmentRes.json() as { assignments: Array<{ id: string; status: string }> };
    assert.strictEqual(assignmentPayload.assignments.length, 1);
    assert.strictEqual(assignmentPayload.assignments[0].id, assignmentId);

    const skillsReq = {
      nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.slug}/skills?status=active`),
    };
    const skillsRes = await listCompanySkillsRoute(skillsReq as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(skillsRes.status, 200);
    const skillsPayload = await skillsRes.json() as { skills: Array<{ assignedAgentCount: number; assignedAgentNames: string[] }> };
    assert.strictEqual(skillsPayload.skills[0].assignedAgentCount, 1);
    assert.deepStrictEqual(skillsPayload.skills[0].assignedAgentNames, [agent.name]);
  });

  await test("runtime export lists only active approved skill assignments", async () => {
    const { listRuntimeAgentSkills } = await import("@/lib/orchestration/company-skills");
    const result = listRuntimeAgentSkills(company.slug, agent.id);

    assert.strictEqual(result.skills.length, 1);
    assert.strictEqual(result.skills[0].id, createdId);
    assert.strictEqual(result.skills[0].slug, "loanmeld-repo-orientation");
  });

  await test("active skill assignment syncs into generated agent core files", () => {
    const root = resolveCompanyAgentWorkspacePath(company.workspace.root, agent.runtimeSlug || agent.slug);
    assert.ok(root, "agent workspace root should resolve");
    const soul = readFileSync(path.join(root, "SOUL.md"), "utf8");
    assert.match(soul, /LoanMeld repo orientation/);
  });

  await test("effectiveness summary derives health signals for active assigned skills", () => {
    const result = listCompanySkillEffectiveness(company.slug);
    const row = result.summary.find((skill) => skill.skillId === createdId);
    assert.ok(row, "created skill should appear in effectiveness summary");
    assert.strictEqual(row?.healthStatus, "needs_data");
    assert.strictEqual(row?.healthSeverity, "info");
    assert.strictEqual(result.totals.attentionCount, 0);
  });

  await test("effectiveness summary flags low-performing skills", () => {
    const db = getOrchestrationDb();
    for (const outcome of ["fail", "blocked", "pass"] as const) {
      db.prepare(
        `INSERT INTO skill_effectiveness_events (
           id, company_id, skill_id, assignment_id, agent_id, task_id, execution_run_id,
           event_type, outcome, source, metadata_json, created_at
         ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'review_outcome', ?, 'system', '{}', ?)`,
      ).run(
        randomUUID(),
        company.id,
        createdId,
        assignmentId,
        agent.id,
        outcome,
        new Date().toISOString(),
      );
    }

    const result = listCompanySkillEffectiveness(company.slug);
    const row = result.summary.find((skill) => skill.skillId === createdId);
    assert.strictEqual(row?.healthStatus, "low_performing");
    assert.strictEqual(row?.needsAttention, true);
    assert.strictEqual(result.totals.attentionCount, 1);
  });

  await test("PATCH archives a skill with replacement metadata and archives runtime assignments", async () => {
    const replacementRes = await createCompanySkillsRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/skills`, {
        name: "LoanMeld repo orientation v2",
        description: "Replacement orientation skill.",
        source: "manual",
        scope: "project",
        status: "active",
        reviewState: "approved",
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );
    assert.strictEqual(replacementRes.status, 201);
    const replacementPayload = await replacementRes.json() as { skill: { id: string } };
    replacementSkillId = replacementPayload.skill.id;

    const archiveRes = await patchCompanySkillsRoute(
      jsonRequest(`http://localhost/api/orchestration/companies/${company.slug}/skills`, {
        id: createdId,
        status: "archived",
        replacementSkillId,
        deprecationReason: "Superseded by a cleaner v2 workflow.",
      }) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );
    assert.strictEqual(archiveRes.status, 200);
    const archivePayload = await archiveRes.json() as {
      skill: {
        status: string;
        metadata: { deprecation?: { replacementSkillId?: string; replacementSkillName?: string; reason?: string } };
      };
    };
    assert.strictEqual(archivePayload.skill.status, "archived");
    assert.strictEqual(archivePayload.skill.metadata.deprecation?.replacementSkillId, replacementSkillId);
    assert.strictEqual(archivePayload.skill.metadata.deprecation?.replacementSkillName, "LoanMeld repo orientation v2");
    assert.strictEqual(archivePayload.skill.metadata.deprecation?.reason, "Superseded by a cleaner v2 workflow.");
    assert.strictEqual((archivePayload.skill.metadata as { runtimeExport?: { exported?: boolean } }).runtimeExport?.exported, false);

    const { listRuntimeAgentSkills } = await import("@/lib/orchestration/company-skills");
    const runtime = listRuntimeAgentSkills(company.slug, agent.id);
    assert.deepStrictEqual(runtime.skills, [], "archived skill assignments should no longer export at runtime");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
