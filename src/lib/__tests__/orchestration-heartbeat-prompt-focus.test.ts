/**
 * Contract test for heartbeat prompt task focus.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-heartbeat-prompt-focus.db \
 *   node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-heartbeat-prompt-focus.test.ts
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${name}`);
      console.error(`    ${message}`);
    });
}

console.log("\nOrchestration Heartbeat Prompt Focus Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask, createTaskComment } = await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { buildHeartbeatPrompt, getOrCreateTaskSession } = await import("@/lib/orchestration/engine/engine");

    await test("task-focused wakes center the current task and trim unrelated task detail", async () => {
      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Prompt Focus ${Date.now()}`,
        description: "Prompt focus fixture",
        color: "#0ea5e9",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Prompt Focus Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🔧",
        role: "Backend Engineer",
        personality: "Focused",
        openclawAgentId: `prompt-focus-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;

      const focused = createTask({
        projectId: project.id,
        title: "Fix task-session contamination",
        description: "Focused task description with root cause details.",
        priority: "P1",
        type: "bug",
        status: "in-progress",
        assignee: agent.id,
        labels: ["focus"],
        createdBy: "test-suite",
      }).task;

      createTask({
        projectId: project.id,
        title: "Unrelated secondary task",
        description: "This unrelated description should not be expanded in a task-focused prompt.",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: agent.id,
        labels: ["secondary"],
        createdBy: "test-suite",
      });

      const db = getOrchestrationDb();
      const session = getOrCreateTaskSession({
        agentId: agent.id,
        companyId: project.companyId!,
        taskKey: focused.id,
      }, db);

      const prompt = buildHeartbeatPrompt(
        db.prepare(
          `SELECT id, name, role, personality, company_id, openclaw_agent_id, adapter_type,
                  adapter_config_json, runtime_config_json, capabilities,
                  NULL AS runtime_workspace_root
           FROM agents WHERE id = ? LIMIT 1`
        ).get(agent.id) as never,
        { wakeSource: "issue_assigned", wakeReason: "user_comment_on_assigned_task" },
        session,
        db,
      );

      assert.match(prompt, /## Current Task Focus/);
      assert.match(prompt, /Fix task-session contamination/);
      assert.match(prompt, /Stay centered on this task/);
      assert.match(prompt, /other company agents may create or edit sibling project artifacts/);
      assert.match(prompt, /do not block solely because files appeared or changed/);
      assert.doesNotMatch(prompt, /## All Open Tasks in Company/);
      assert.doesNotMatch(prompt, /Description: This unrelated description should not be expanded/);
      assert.match(prompt, /Unrelated secondary task/);
    });

    await test("prompt includes only active approved runtime skills", async () => {
      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Prompt Skills ${Date.now()}`,
        description: "Prompt skill fixture",
        color: "#8b5cf6",
        emoji: "S",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Prompt Skill Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "S",
        role: "Implementation Engineer",
        personality: "Uses approved skills.",
        openclawAgentId: `prompt-skill-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: [],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "Use runtime skill context",
        description: "The approved skill should appear in the heartbeat prompt.",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: agent.id,
        labels: [],
        createdBy: "test-suite",
      }).task;

      const {
        assignCompanySkillToAgent,
        createCompanySkill,
        updateCompanySkill,
      } = await import("@/lib/orchestration/company-skills");
      const approved = createCompanySkill(project.companyId!, {
        name: "Approved Runtime Skill",
        description: "Reusable approved workflow for implementation agents.",
        source: "seed",
        scope: "project",
      }).skill;
      updateCompanySkill(project.companyId!, approved.id, {
        status: "active",
        reviewState: "approved",
      });
      assignCompanySkillToAgent(project.companyId!, {
        agentId: agent.id,
        skillId: approved.id,
        status: "active",
        source: "seed",
      });
      const draft = createCompanySkill(project.companyId!, {
        name: "Draft Runtime Skill",
        description: "This draft skill must not be exported into the prompt.",
        source: "seed",
        scope: "project",
      }).skill;
      assignCompanySkillToAgent(project.companyId!, {
        agentId: agent.id,
        skillId: draft.id,
        status: "draft",
        source: "seed",
      });

      const db = getOrchestrationDb();
      const session = getOrCreateTaskSession({
        agentId: agent.id,
        companyId: project.companyId!,
        taskKey: task.id,
      }, db);

      const prompt = buildHeartbeatPrompt(
        db.prepare(
          `SELECT id, name, role, personality, company_id, openclaw_agent_id, adapter_type,
                  adapter_config_json, runtime_config_json, capabilities,
                  NULL AS runtime_workspace_root
           FROM agents WHERE id = ? LIMIT 1`
        ).get(agent.id) as never,
        { wakeSource: "issue_assigned", wakeReason: "skill_prompt_context" },
        session,
        db,
      );

      assert.match(prompt, /## Active Runtime Skills/);
      assert.match(prompt, /Approved Runtime Skill/);
      assert.match(prompt, /Reusable approved workflow/);
      assert.doesNotMatch(prompt, /Draft Runtime Skill/);
    });

    await test("human comment wakes include the follow-up body and anti-repeat instruction", async () => {
      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Prompt Followup ${Date.now()}`,
        description: "Prompt follow-up fixture",
        color: "#14b8a6",
        emoji: "💬",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Prompt Followup Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🔧",
        role: "Researcher",
        personality: "Focused",
        openclawAgentId: `prompt-followup-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["research"],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "Analyze a repo",
        description: "Original repo assessment request.",
        priority: "P1",
        type: "research",
        status: "review",
        assignee: agent.id,
        labels: ["followup"],
        createdBy: "test-suite",
      }).task;

      createTaskComment({
        taskId: task.id,
        body: "## Full repo assessment\n\nThis was the original long answer.",
        type: "comment",
        authorAgentId: agent.id,
      });
      const followupResult = createTaskComment({
        taskId: task.id,
        body: "Could we use our Claude Code subscription rather than the API to operate it?",
        type: "comment",
        authorUserId: "tim",
      });
      const followup = followupResult.comment;
      assert.equal(followupResult.wakeup?.reason, "user_comment_on_assigned_task");
      assert.ok(followupResult.wakeup?.heartbeatRunId, "human follow-up should create a heartbeat run");

      const db = getOrchestrationDb();
      const session = getOrCreateTaskSession({
        agentId: agent.id,
        companyId: project.companyId!,
        taskKey: task.id,
      }, db);

      const prompt = buildHeartbeatPrompt(
        db.prepare(
          `SELECT id, name, role, personality, company_id, openclaw_agent_id, adapter_type,
                  adapter_config_json, runtime_config_json, capabilities,
                  NULL AS runtime_workspace_root
           FROM agents WHERE id = ? LIMIT 1`
        ).get(agent.id) as never,
        {
          wakeSource: "api",
          wakeReason: "user_comment_on_assigned_task",
          taskId: task.id,
          commentId: followup.id,
        },
        session,
        db,
      );

      assert.match(prompt, /## Latest Human Follow-up/);
      assert.match(prompt, /Claude Code subscription rather than the API/);
      assert.match(prompt, /Answer this follow-up directly/);
      assert.match(prompt, /Do not repeat the full prior task answer/);
      assert.match(prompt, /## Recent Task Discussion/);
    });

    await test("parent-focused wakes call out blocked child tasks as remediation work", async () => {
      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Prompt Blocked Child ${Date.now()}`,
        description: "Prompt blocked-child fixture",
        color: "#f97316",
        emoji: "B",
        status: "active",
      }).project;

      const ceo = createProjectAgent({
        projectId: project.id,
        name: `Prompt CEO ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "C",
        role: "CEO",
        personality: "Delegates remediation.",
        openclawAgentId: `prompt-ceo-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["management"],
      }).agent;

      const qa = createProjectAgent({
        projectId: project.id,
        name: `Prompt QA ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "Q",
        role: "QA Agent",
        personality: "Finds blockers.",
        openclawAgentId: `prompt-qa-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["qa"],
      }).agent;

      const parent = createTask({
        projectId: project.id,
        title: "Ship launch board",
        description: "Parent delivery directive.",
        priority: "P1",
        type: "feature",
        status: "blocked",
        assignee: ceo.id,
        labels: ["parent"],
        createdBy: "test-suite",
      }).task;

      const child = createTask({
        projectId: project.id,
        parentTaskId: parent.id,
        title: "Validate launch board artifacts",
        description: "QA child task.",
        priority: "P1",
        type: "maintenance",
        status: "blocked",
        assignee: qa.id,
        blockedReason: "Missing README and file-mode load fails.",
        labels: ["qa"],
        createdBy: "test-suite",
      }).task;

      createTaskComment({
        taskId: child.id,
        body: "QA failed: create README.md and make index.html load data without localhost-only fetch.",
        type: "blocker",
        authorAgentId: qa.id,
      });

      const db = getOrchestrationDb();
      const session = getOrCreateTaskSession({
        agentId: ceo.id,
        companyId: project.companyId!,
        taskKey: parent.id,
      }, db);

      const prompt = buildHeartbeatPrompt(
        db.prepare(
          `SELECT id, name, role, personality, company_id, openclaw_agent_id, adapter_type,
                  adapter_config_json, runtime_config_json, capabilities,
                  NULL AS runtime_workspace_root
           FROM agents WHERE id = ? LIMIT 1`,
        ).get(ceo.id) as never,
        { wakeSource: "api", wakeReason: "child_task_blocked", taskId: parent.id },
        session,
        db,
      );

      assert.match(prompt, /## Blocked Child Tasks Need CEO Triage/);
      assert.match(prompt, /not passive dependency gating/);
      assert.match(prompt, /create concrete fix tasks/);
      assert.match(prompt, /Validate launch board artifacts/);
      assert.match(prompt, /Missing README and file-mode load fails/);
    });

    await test("vault-backed memory injection persists exact run evidence in execution metadata", async () => {
      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Prompt Memory Evidence ${Date.now()}`,
        description: "Prompt memory fixture",
        color: "#22c55e",
        emoji: "M",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Prompt Memory Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "M",
        role: "Implementation Engineer",
        personality: "Uses memory evidence.",
        openclawAgentId: `prompt-memory-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: [],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "Use vault memory",
        description: "The prompt should include indexed vault memory.",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: agent.id,
        labels: [],
        createdBy: "test-suite",
      }).task;

      const db = getOrchestrationDb();
      const recordId = `vault-memory-${Math.random().toString(36).slice(2, 10)}`;
      const sourcePath = `/tmp/mc-memory/${recordId}.md`;
      const fixtureRecordId = `ins36-fixture-${Math.random().toString(36).slice(2, 10)}`;
      const fixtureSourcePath = `/tmp/ins36-${Date.now()}-abcdef12/company/orphan.md`;
      db.prepare(`
        INSERT INTO memory_source_index
          (record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts, frontmatter_json, tags_json, status, pinned)
        VALUES (?, ?, 'company-vault', ?, 'project', 'Runtime Retrieval Note', 'Use the retrieval evidence contract when injecting memory.', 'Use the retrieval evidence contract when injecting memory.', ?, ?, 'active', 1)
      `).run(
        recordId,
        project.companyId!,
        sourcePath,
        JSON.stringify({ project_id: project.id, title: "Runtime Retrieval Note" }),
        JSON.stringify(["hiverunner/memory", "role:implementation"]),
      );
      db.prepare(`
        INSERT INTO memory_source_index
          (record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts, frontmatter_json, tags_json, status, pinned)
        VALUES (?, ?, 'company-vault', ?, 'company', 'INS-36 orphan note prompt fixture', 'Representative graph explorer fixture for INS-36 orphan note.', 'Representative graph explorer fixture for INS-36 orphan note.', '{}', ?, 'active', 1)
      `).run(
        fixtureRecordId,
        project.companyId!,
        fixtureSourcePath,
        JSON.stringify(["hiverunner/memory", "role:implementation"]),
      );

      const now = new Date().toISOString();
      const executionRunId = `exec-memory-evidence-${Math.random().toString(36).slice(2, 10)}`;
      db.prepare(`
        INSERT INTO execution_runs
          (id, task_id, agent_id, provider, status, started_at, created_at, updated_at, metadata_json)
        VALUES (?, ?, ?, 'openclaw', 'running', ?, ?, ?, ?)
      `).run(
        executionRunId,
        task.id,
        agent.id,
        now,
        now,
        now,
        JSON.stringify({ existingKey: "preserved" }),
      );

      const session = getOrCreateTaskSession({
        agentId: agent.id,
        companyId: project.companyId!,
        taskKey: task.id,
      }, db);

      const prompt = buildHeartbeatPrompt(
        db.prepare(
          `SELECT id, name, role, personality, company_id, openclaw_agent_id, adapter_type,
                  adapter_config_json, runtime_config_json, capabilities,
                  NULL AS runtime_workspace_root
           FROM agents WHERE id = ? LIMIT 1`,
        ).get(agent.id) as never,
        { wakeSource: "issue_assigned", wakeReason: "memory_evidence" },
        session,
        db,
        executionRunId,
      );

      assert.match(prompt, /## Injected Company Memory/);
      assert.match(prompt, /Runtime Retrieval Note/);
      assert.match(prompt, /Source: \/tmp\/mc-memory\//);
      assert.doesNotMatch(prompt, /INS-36 orphan note prompt fixture/);

      const row = db.prepare("SELECT metadata_json FROM execution_runs WHERE id = ?").get(executionRunId) as {
        metadata_json: string;
      };
      const metadata = JSON.parse(row.metadata_json) as {
        existingKey?: string;
        injected_memory_sha256?: string;
        injectedMemoryEvidence?: {
          source?: string;
          recordCount?: number;
          records?: Array<{
            recordId: string;
            sourcePath: string;
            title: string;
            layer: string;
            inclusionReasons: string[];
            evidenceEnvelope: {
              version: number;
              envelopeId: string;
              retrievalRank: number;
              sourceType: string;
              companyId: string;
              recordId: string;
              contentSha256: string;
              matched: {
                agentId: string;
                agentRole: string | null;
                projectId: string | null;
                roleTags: string[];
              };
            };
          }>;
        };
      };

      assert.strictEqual(metadata.existingKey, "preserved");
      assert.match(metadata.injected_memory_sha256 ?? "", /^[a-f0-9]{64}$/);
      assert.strictEqual(metadata.injectedMemoryEvidence?.source, "memory_source_index");
      assert.strictEqual(metadata.injectedMemoryEvidence?.recordCount, 1);
      const evidenceRecord = metadata.injectedMemoryEvidence?.records?.[0];
      assert.ok(evidenceRecord);
      assert.deepStrictEqual({
        recordId: evidenceRecord.recordId,
        sourcePath: evidenceRecord.sourcePath,
        title: evidenceRecord.title,
        layer: evidenceRecord.layer,
        inclusionReasons: evidenceRecord.inclusionReasons,
      }, {
        recordId,
        sourcePath,
        title: "Runtime Retrieval Note",
        layer: "project",
        inclusionReasons: [
          "memory_source_index.status is active",
          `company_id matched requested company '${project.companyId!}'`,
          "layer 'project' is eligible for this run",
          `frontmatter project_id '${project.id}' matched task project '${project.id}'`,
          "role tag gate passed for agent role 'Implementation Engineer' via 'implementation'",
        ],
      });
      assert.strictEqual(evidenceRecord.evidenceEnvelope.version, 1);
      assert.match(evidenceRecord.evidenceEnvelope.envelopeId, /^[a-f0-9]{64}$/);
      assert.strictEqual(evidenceRecord.evidenceEnvelope.retrievalRank, 1);
      assert.strictEqual(evidenceRecord.evidenceEnvelope.sourceType, "memory_source_index");
      assert.strictEqual(evidenceRecord.evidenceEnvelope.companyId, project.companyId!);
      assert.strictEqual(evidenceRecord.evidenceEnvelope.recordId, recordId);
      assert.match(evidenceRecord.evidenceEnvelope.contentSha256, /^[a-f0-9]{64}$/);
      assert.deepStrictEqual(evidenceRecord.evidenceEnvelope.matched, {
        agentId: agent.id,
        agentRole: "Implementation Engineer",
        projectId: project.id,
        roleTags: ["implementation"],
      });

      const graphTask = createTask({
        projectId: project.id,
        title: "Memory graph fixture test for INS-36",
        description: "Verify graph explorer fixture access for memory tests.",
        priority: "P2",
        type: "research",
        status: "in-progress",
        assignee: agent.id,
        labels: [],
        createdBy: "test-suite",
      }).task;
      const graphSession = getOrCreateTaskSession({
        agentId: agent.id,
        companyId: project.companyId!,
        taskKey: graphTask.id,
      }, db);

      const graphPrompt = buildHeartbeatPrompt(
        db.prepare(
          `SELECT id, name, role, personality, company_id, openclaw_agent_id, adapter_type,
                  adapter_config_json, runtime_config_json, capabilities,
                  NULL AS runtime_workspace_root
           FROM agents WHERE id = ? LIMIT 1`,
        ).get(agent.id) as never,
        { wakeSource: "issue_assigned", wakeReason: "memory_graph_fixture_test" },
        graphSession,
        db,
      );

      assert.match(graphPrompt, /INS-36 orphan note prompt fixture/);
      assert.match(graphPrompt, /matches INS-36 graph explorer fixture markers/);
    });
  } finally {
    if (dbPath) rmSync(dbPath, { force: true });
  }

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
