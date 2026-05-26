import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";

import { listRuntimeAgentSkills } from "@/lib/orchestration/company-skills";
import { buildLeadSupervisorContextSection, buildTaskGoalContextSection } from "@/lib/orchestration/goal-context";
import { buildMemoryContext } from "@/lib/orchestration/memory-context";
import { resolveReviewProducerAssigneeId } from "@/lib/orchestration/service/review-assignment";
import { readProjectSourceWorkspaceRoot } from "@/lib/orchestration/service/shared";
import { isExecutableAgentRuntime, nonExecutableRuntimeReason, runtimeProviderLabel } from "@/lib/orchestration/runtime-readiness";
import { mergeExecutionRunMetadata, parseJson } from "@/lib/orchestration/engine/persistence";
import type { TaskSession } from "@/lib/orchestration/engine/persistence";
import { resolveTaskKey } from "@/lib/orchestration/engine/heartbeat-manager";
import { resolveOpenClawDir } from "@/lib/workspaces/root";
import { PUBLIC_HUMAN_LABEL } from "@/lib/public-identity";

type AgentRow = {
  id: string;
  name: string;
  role: string;
  personality: string;
  company_id: string;
  openclaw_agent_id: string | null;
  adapter_type: string;
  model: string | null;
  adapter_config_json: string;
  runtime_config_json: string;
  capabilities: string;
  runtime_workspace_root: string | null;
};

const MODULE_DIR =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.join(process.cwd(), "src/lib/orchestration/engine");
const ONBOARDING_DIR = path.join(MODULE_DIR, "onboarding-assets");
const OPENCLAW_HOME = process.env.OPENCLAW_HOME?.trim() || resolveOpenClawDir();
const LEAD_SUPERVISOR_TICK_REASON = "goal_lead_supervisor_tick";

function approvalPromptLabel(type: string, payload: Record<string, unknown>, id: string): string {
  if (type === "hire_agent") {
    return `Hire: ${payload.name ?? payload.agentName ?? "?"} (${payload.role ?? "?"})`;
  }
  if (type === "provider_switch") {
    return `Provider switch: ${payload.agentName ?? payload.agentId ?? "agent"} to ${payload.targetProvider ?? "runtime"}`;
  }
  if (type === "protected_runtime_command") {
    return `Protected command: ${payload.command ?? id.slice(0, 8)}`;
  }
  return `${type}: ${id.slice(0, 8)}`;
}

/* ── Onboarding Asset Loading ── */

function resolveOnboardingDir(): string {
  // Try relative to this file first (works in dev), then fallback to cwd-based path
  const candidates = [
    ONBOARDING_DIR,
    path.join(process.cwd(), "src/lib/orchestration/engine/onboarding-assets"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

export function isCeoRole(role: string): boolean {
  return role.trim().split(/\s+/).some((token) => token.toLowerCase() === "ceo");
}

export function isCompanyOrchestrationLeadRole(role: string): boolean {
  if (isCeoRole(role)) return true;
  const normalized = role.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.includes("product orchestrator") || normalized.includes("orchestration lead");
}

export function loadOnboardingAssets(role: string): Record<string, string> {
  const baseDir = resolveOnboardingDir();
  const roleDir = isCeoRole(role) ? path.join(baseDir, "ceo") : path.join(baseDir, "default");
  const assets: Record<string, string> = {};

  if (!fs.existsSync(roleDir)) return assets;

  for (const file of fs.readdirSync(roleDir)) {
    if (!file.endsWith(".md")) continue;
    try {
      assets[file] = fs.readFileSync(path.join(roleDir, file), "utf8").trim();
    } catch {
      // Skip unreadable files
    }
  }
  return assets;
}

function readAgentSoulMarkdown(agent: AgentRow): string | null {
  const candidates: string[] = [];
  const workspaceRoot = agent.runtime_workspace_root?.trim();
  if (workspaceRoot) {
    candidates.push(path.join(workspaceRoot, "SOUL.md"));
  }

  const isOpenClawAgent = agent.adapter_type?.trim().toLowerCase() === "openclaw";
  const openclawAgentId = agent.openclaw_agent_id?.trim();
  if (isOpenClawAgent && openclawAgentId) {
    candidates.push(path.join(OPENCLAW_HOME, "agents", openclawAgentId, "SOUL.md"));
  }

  for (const soulPath of candidates) {
    try {
      if (!fs.existsSync(soulPath)) continue;
      const content = fs.readFileSync(soulPath, "utf8").trim();
      if (content) return content;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function truncateForPrompt(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function allowsExplicitFixtureMemoryAccess(task: { title: string; description: string; type: string; task_key: string } | undefined): boolean {
  if (!task) return false;
  const text = `${task.task_key}\n${task.title}\n${task.description}\n${task.type}`.toLowerCase();
  const namesFixtureSet = /\b(ins-36|fixture|fixtures)\b/.test(text);
  const namesGraphExplorer = /\b(memory graph|graph explorer)\b/.test(text);
  const namesFixtureTest = /\b(fixture test|fixture-test|test fixture|fixture access)\b/.test(text);
  const namesMemorySystem = /\b(memory|retrieval|prompt|graph)\b/.test(text);
  return (namesGraphExplorer && namesFixtureSet) || (namesFixtureTest && namesMemorySystem);
}

/* ── Prompt Building ── */

export function buildHeartbeatPrompt(
  agent: AgentRow,
  contextSnapshot: Record<string, unknown>,
  session: TaskSession,
  db: Database.Database,
  executionRunId?: string | null,
): string {
  const sections: string[] = [];
  const focusedTaskId = session.taskKey !== "__heartbeat__" ? session.taskKey : resolveTaskKey(contextSnapshot, agent.id, db);
  const focusedTask = focusedTaskId && focusedTaskId !== "__heartbeat__"
    ? db.prepare(
        `SELECT t.id, t.title, t.description, t.status, t.priority, t.type, t.task_key, t.sprint_id,
                t.assignee_agent_id,
                p.id AS project_id, p.name AS project_name, p.slug AS project_slug,
                p.settings_json AS project_settings_json
         FROM tasks t
         INNER JOIN projects p ON p.id = t.project_id
         WHERE t.id = ? AND t.archived_at IS NULL
         LIMIT 1`
      ).get(focusedTaskId) as {
        id: string;
        title: string;
        description: string;
        status: string;
        priority: string;
        type: string;
        task_key: string;
        sprint_id: string | null;
        assignee_agent_id: string | null;
        project_id: string;
        project_name: string;
        project_slug: string;
        project_settings_json: string | null;
      } | undefined
    : undefined;
  const focusedTaskComments = focusedTask
    ? db.prepare(
        `SELECT c.id, c.body, c.type, c.source, c.author_user_id, c.author_agent_id,
                c.created_at, a.name AS author_agent_name
           FROM comments c
           LEFT JOIN agents a ON a.id = c.author_agent_id
          WHERE c.task_id = ?
          ORDER BY c.created_at DESC
          LIMIT 8`
      ).all(focusedTask.id) as Array<{
        id: string;
        body: string;
        type: string;
        source: string | null;
        author_user_id: string | null;
        author_agent_id: string | null;
        author_agent_name: string | null;
        created_at: string;
      }>
    : [];
  const wakeCommentId = typeof contextSnapshot.commentId === "string" ? contextSnapshot.commentId : null;
  const latestWakeComment = wakeCommentId
    ? focusedTaskComments.find((comment) => comment.id === wakeCommentId)
    : undefined;

  if (contextSnapshot.wakeReason === "sweep_unassigned_to_ceo" && focusedTask) {
    return buildUnassignedTaskTriagePrompt({
      agent,
      task: focusedTask,
      comments: focusedTaskComments,
      db,
    });
  }

  // Load onboarding assets based on agent role
  const assets = loadOnboardingAssets(agent.role.toLowerCase());

  // Agent instructions
  if (assets["AGENTS.md"]) {
    sections.push(assets["AGENTS.md"]);
  }
  if (assets["HEARTBEAT.md"]) {
    sections.push(assets["HEARTBEAT.md"]);
  }
  if (assets["SOUL.md"]) {
    sections.push(assets["SOUL.md"]);
  }

  const agentSoul = readAgentSoulMarkdown(agent);
  if (agentSoul) {
    sections.push("\n---\n# Agent Identity (SOUL.md)\n");
    sections.push(agentSoul);
  }

  // Context section
  sections.push("\n---\n# Execution Context\n");
  sections.push(`Agent: ${agent.name} (${agent.role})`);
  sections.push(`Company ID: ${agent.company_id}`);

  if (agent.capabilities) {
    sections.push(`Capabilities: ${agent.capabilities}`);
  }

  const companyWorkspace = db
    .prepare(
      `SELECT workspace_root
       FROM companies
       WHERE id = ?
       LIMIT 1`,
    )
    .get(agent.company_id) as { workspace_root: string | null } | undefined;
  const runtimeWorkspaceRoot = agent.runtime_workspace_root?.trim() || null;
  const companyWorkspaceRoot = companyWorkspace?.workspace_root?.trim() || null;
  const projectSourceWorkspaceRoot = focusedTask
    ? readProjectSourceWorkspaceRoot(focusedTask.project_settings_json)
    : null;
  const sourceWorkspacePath = projectSourceWorkspaceRoot
    ? path.resolve(projectSourceWorkspaceRoot)
    : runtimeWorkspaceRoot
    ? path.join(runtimeWorkspaceRoot, "source")
    : companyWorkspaceRoot
      ? path.join(companyWorkspaceRoot, "source")
      : null;

  if (runtimeWorkspaceRoot || companyWorkspaceRoot || sourceWorkspacePath) {
    sections.push("\n## Workspace Paths");
    if (runtimeWorkspaceRoot) {
      sections.push(`- Runtime workspace / current working directory: ${runtimeWorkspaceRoot}`);
    }
    if (sourceWorkspacePath) {
      sections.push(`- Source workspace for code changes and tests: ${sourceWorkspacePath}`);
    }
    if (companyWorkspaceRoot) {
      sections.push(`- Company workspace for memory and project artifacts: ${companyWorkspaceRoot}`);
      const projectWorkspacePath = focusedTask?.project_slug
        ? path.join(companyWorkspaceRoot, "projects", focusedTask.project_slug)
        : path.join(companyWorkspaceRoot, "projects");
      sections.push(`- Project workspace path: ${projectWorkspacePath}`);
    }
    sections.push("Instruction: keep identity notes in the runtime workspace. For company project deliverables, write files under the Project workspace path. Use the Source workspace only when the task explicitly asks you to inspect or modify the HiveRunner app/repo itself.");
    sections.push("Coordination: other company agents may create or edit sibling project artifacts while you work. Treat those project-workspace changes as expected collaboration context, integrate with them, and do not block solely because files appeared or changed unless they directly conflict with your task.");
  }

  sections.push("\n## HiveRunner Coordination Boundary");
  sections.push("- Coordinate this company only through the HiveRunner context in this prompt and the `mc-action` blocks listed below.");
  sections.push("- Do not use legacy external control-plane APIs, legacy bridge endpoints, or retired workspace paths for HiveRunner work.");
  sections.push("- OpenClaw may be used only when it is the selected runtime provider for an agent. It is not the coordination system for this company.");

  const runtimeSkills = listRuntimeAgentSkills(agent.company_id, agent.id).skills;
  if (runtimeSkills.length > 0) {
    // Headroom for agents with rich skill assignments while keeping prompt overhead bounded.
    const runtimeSkillPromptLimit = 16;
    sections.push("\n## Active Runtime Skills");
    sections.push("These are approved HiveRunner skills assigned to this agent for this run. Use them when relevant, but keep the current task instructions higher priority.");
    sections.push("Skill tracking rule: if you materially apply one of these skills, emit exactly one `use_skill` mc-action for that skill and task, with a short note describing how it was used. Do not emit `use_skill` for skills you only skimmed or ignored.");
    sections.push("Runtime export contract: the skill slug in parentheses is the stable identifier to use in `use_skill`; the description is the approved operating procedure summary.");
    for (const skill of runtimeSkills.slice(0, runtimeSkillPromptLimit)) {
      sections.push(`- ${skill.name} (v${skill.version}, ${skill.slug})`);
      if (skill.description) {
        sections.push(`  ${truncateForPrompt(skill.description, 360)}`);
      }
    }
    if (runtimeSkills.length > runtimeSkillPromptLimit) {
      sections.push(`- ${runtimeSkills.length - runtimeSkillPromptLimit} additional approved skill(s) omitted from prompt for size.`);
    }
  }

  // Wake reason
  const wakeSource = contextSnapshot.wakeSource as string | undefined;
  const wakeReason = contextSnapshot.wakeReason as string | undefined;
  if (wakeSource) {
    sections.push(`\nWake source: ${wakeSource}`);
  }
  if (wakeReason) {
    sections.push(`Wake reason: ${wakeReason}`);
  }

  if (wakeReason === LEAD_SUPERVISOR_TICK_REASON) {
    const supervisorContext = buildLeadSupervisorContextSection({
      db,
      agentId: agent.id,
      goalId: typeof contextSnapshot.goalId === "string" ? contextSnapshot.goalId : null,
      planningTaskId: typeof contextSnapshot.planningTaskId === "string" ? contextSnapshot.planningTaskId : null,
    });
    if (supervisorContext) {
      sections.push(supervisorContext);
    }
  }

  // Direction (for kickoff)
  const direction = contextSnapshot.direction as string | undefined;
  if (direction) {
    sections.push(`\n## Board Direction\n${direction}`);
  }

  // Assigned tasks
  const tasks = db
    .prepare(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.type, t.task_key,
              p.name AS project_name, p.slug AS project_slug
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE t.assignee_agent_id = ? AND t.archived_at IS NULL
         AND t.status NOT IN ('done', 'cancelled')
       ORDER BY
         CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         t.created_at ASC
       LIMIT 20`
    )
    .all(agent.id) as Array<{
      id: string;
      title: string;
      description: string;
      status: string;
      priority: string;
      type: string;
      task_key: string;
      project_name: string;
      project_slug: string;
    }>;

  if (focusedTask) {
    sections.push("\n## Current Task Focus\n");
    sections.push(`- [${focusedTask.task_key}] ${focusedTask.title} (${focusedTask.status}, ${focusedTask.priority}, ${focusedTask.type})`);
    sections.push(`  Project: ${focusedTask.project_name}`);
    if (focusedTask.description) {
      sections.push(`  Description: ${focusedTask.description}`);
    }
    sections.push("  Instruction: Stay centered on this task. Do not drift into other projects unless this task explicitly requires it.");
    const goalContext = buildTaskGoalContextSection({ db, taskId: focusedTask.id, agentId: agent.id });
    if (goalContext) sections.push(goalContext);
  }

  const memoryContext = buildMemoryContext({
    db,
    companyId: agent.company_id,
    agentId: agent.id,
    agentRole: agent.role,
    projectId: focusedTask?.project_id ?? null,
    includeFixtureMemories: allowsExplicitFixtureMemoryAccess(focusedTask),
    focus: focusedTask
      ? {
          taskKey: focusedTask.task_key,
          taskTitle: focusedTask.title,
          taskDescription: focusedTask.description,
          sprintId: focusedTask.sprint_id,
        }
      : null,
  });
  if (memoryContext) {
    sections.push(memoryContext.section);
    sections.push("Memory utilization receipt: when injected memory affects your work, emit one `memory_receipt` mc-action listing records you used, ignored, or found irrelevant. Use the Record ID or Evidence envelope ID shown above. These are agent claims only; matched-use scoring is stored separately.");
    if (executionRunId) {
      const injectedHash = createHash("sha256").update(memoryContext.section).digest("hex");
      mergeExecutionRunMetadata(db, executionRunId, {
        injected_memory_sha256: injectedHash,
        injectedMemoryEvidence: {
          source: memoryContext.source,
          recordCount: memoryContext.evidence.length,
          records: memoryContext.evidence,
        },
        injectedMemoryQuality: memoryContext.quality,
      });
    }
  }

  if (focusedTask && latestWakeComment) {
    const author = latestWakeComment.author_agent_name ??
      latestWakeComment.author_user_id ??
      (latestWakeComment.source === "mission_control" ? "Human operator" : "Unknown");
    sections.push("\n## Latest Human Follow-up\n");
    sections.push(`From: ${author}`);
    sections.push(`Comment: ${truncateForPrompt(latestWakeComment.body, 1600)}`);
    sections.push("Instruction: Answer this follow-up directly. Do not repeat the full prior task answer unless the human explicitly asks for a recap.");
  }

  const reviewProducerAssigneeId = focusedTask?.status === "review"
    ? resolveReviewProducerAssigneeId(db, focusedTask.id)
    : null;
  const latestReviewCandidate = focusedTask?.status === "review"
    ? db.prepare(
        `SELECT c.id, c.body, c.type, c.source, c.author_user_id, c.author_agent_id,
                c.created_at, a.name AS author_agent_name
           FROM comments c
           LEFT JOIN agents a ON a.id = c.author_agent_id
          WHERE c.task_id = ?
            AND c.author_agent_id IS NOT NULL
            AND (? IS NULL OR c.author_agent_id = ?)
            AND c.source NOT IN ('mission_control', 'engine')
          ORDER BY c.created_at DESC
          LIMIT 1`,
      ).get(
        focusedTask.id,
        reviewProducerAssigneeId,
        reviewProducerAssigneeId,
      ) as {
        id: string;
        body: string;
        type: string;
        source: string | null;
        author_user_id: string | null;
        author_agent_id: string | null;
        author_agent_name: string | null;
        created_at: string;
      } | undefined
    : undefined;

  if (focusedTask && latestReviewCandidate) {
    const author = latestReviewCandidate.author_agent_name ??
      latestReviewCandidate.author_user_id ??
      "Assigned worker";
    sections.push("\n## Latest Review Candidate (full)\n");
    sections.push(`From: ${author}`);
    sections.push(`Posted: ${latestReviewCandidate.created_at}`);
    sections.push(truncateForPrompt(latestReviewCandidate.body, 9000));
    sections.push("Instruction: When this task is in review, use this full latest worker comment as the primary artifact to approve or reject. Do not reject only because the compact Recent Task Discussion below is truncated.");
    sections.push("Decision format: if the work passes review, emit an `add_comment` with concise review notes and then `update_task` this task to `done`. If changes are needed, emit an `add_comment` explaining the required changes and then `update_task` this task back to `in-progress` assigned to the original producer.");
  } else if (focusedTask?.status === "review") {
    sections.push("\n## Review Decision Required\n");
    sections.push("This task is in review. Inspect the task description and recent discussion. If it passes, emit `add_comment` with concise review notes and then `update_task` this task to `done`. If changes are needed, emit `add_comment` with the requested changes and then `update_task` this task back to `in-progress` assigned to the original producer when known.");
  }

  if (focusedTask && focusedTaskComments.length > 0) {
    sections.push("\n## Recent Task Discussion\n");
    for (const comment of focusedTaskComments.slice().reverse()) {
      const author = comment.author_agent_name ??
        comment.author_user_id ??
        (comment.source === "engine" ? "System" : "Human operator");
      const maxChars = comment.id === wakeCommentId ? 1200 : comment.author_agent_id ? 500 : 800;
      sections.push(`- ${comment.created_at} — ${author} (${comment.type}, ${comment.source ?? "unknown"}): ${truncateForPrompt(comment.body, maxChars)}`);
    }
    sections.push("Use the discussion to avoid duplicate answers. If the latest item is a human question, respond to that question, not the original task from scratch.");
  }

  const blockedChildTasks = focusedTask
    ? db
        .prepare(
          `SELECT t.id, t.task_key, t.title, t.blocked_reason, a.name AS assignee_name,
                  (
                    SELECT c.body
                    FROM comments c
                    WHERE c.task_id = t.id
                    ORDER BY c.created_at DESC
                    LIMIT 1
                  ) AS latest_comment
             FROM tasks t
             LEFT JOIN agents a ON a.id = t.assignee_agent_id
            WHERE t.parent_task_id = ?
              AND t.status = 'blocked'
              AND t.archived_at IS NULL
            ORDER BY t.updated_at DESC
            LIMIT 6`,
        )
        .all(focusedTask.id) as Array<{
          id: string;
          task_key: string;
          title: string;
          blocked_reason: string | null;
          assignee_name: string | null;
          latest_comment: string | null;
        }>
    : [];

  if (blockedChildTasks.length > 0) {
    sections.push("\n## Blocked Child Tasks Need CEO Triage\n");
    sections.push("A blocked child task is not passive dependency gating. Treat it as remediation work: create concrete fix tasks, reassign work, adjust dependencies, or explicitly unblock/rework the blocked child. Do not only acknowledge the block or leave the parent stuck.");
    for (const child of blockedChildTasks) {
      sections.push(`- [${child.task_key}] ${child.title} (assigned: ${child.assignee_name ?? "unassigned"})`);
      if (child.blocked_reason) {
        sections.push(`  Blocker: ${truncateForPrompt(child.blocked_reason, 500)}`);
      }
      if (child.latest_comment) {
        sections.push(`  Latest note: ${truncateForPrompt(child.latest_comment, 700)}`);
      }
    }
  }

  const otherTasks = focusedTask ? tasks.filter((task) => task.id !== focusedTask.id) : tasks;

  if (otherTasks.length > 0) {
    sections.push("\n## Your Assigned Tasks\n");
    for (const task of otherTasks.slice(0, focusedTask ? 8 : 20)) {
      sections.push(`- [${task.task_key}] ${task.title} (${task.status}, ${task.priority}, ${task.type})`);
      if (!focusedTask) {
        sections.push(`  Project: ${task.project_name}`);
        if (task.description) {
          const desc = task.description.length > 200 ? task.description.slice(0, 200) + "..." : task.description;
          sections.push(`  Description: ${desc}`);
        }
      }
    }
  } else if (!focusedTask) {
    sections.push("\n## Your Assigned Tasks\nNo tasks currently assigned. Check the company backlog or create new tasks based on direction.");
  }

  // ── Existing work context (anti-repeat) ──
  // Show the CEO what already exists so it does not recreate completed work.

  // All recent tasks in the company (not just assigned to this agent)
  const companyTasks = db
    .prepare(
      `SELECT t.task_key, t.title, t.status, t.priority, a.name AS assignee_name
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       WHERE p.company_id = ? AND t.archived_at IS NULL
         AND t.status NOT IN ('done', 'cancelled')
       ORDER BY t.created_at DESC
       LIMIT 30`
    )
    .all(agent.company_id) as Array<{
      task_key: string; title: string; status: string; priority: string; assignee_name: string | null;
    }>;

  if (companyTasks.length > 0 && !focusedTask) {
    sections.push("\n## All Open Tasks in Company (DO NOT recreate these)\n");
    for (const t of companyTasks) {
      sections.push(`- [${t.task_key}] ${t.title} (${t.status}, ${t.priority}, assigned: ${t.assignee_name ?? "unassigned"})`);
    }
  } else if (companyTasks.length > 0 && focusedTask) {
    const relatedCompanyTasks = companyTasks.filter((task) => task.task_key !== focusedTask.task_key).slice(0, 8);
    if (relatedCompanyTasks.length > 0) {
      sections.push("\n## Nearby Open Tasks (context only, do not switch unless needed)\n");
      for (const t of relatedCompanyTasks) {
        sections.push(`- [${t.task_key}] ${t.title} (${t.status}, ${t.priority}, assigned: ${t.assignee_name ?? "unassigned"})`);
      }
    }
  }

  const runtimeRoster = db
    .prepare(
      `SELECT
         a.name,
         a.role,
         a.status,
         a.adapter_type,
         ar.runtime_kind,
         ar.status AS runtime_status,
         ar.command,
         ar.workspace_root
       FROM agents a
       LEFT JOIN agent_runtimes ar
         ON ar.id = (
           SELECT ar2.id
           FROM agent_runtimes ar2
           WHERE ar2.agent_id = a.id
             AND ar2.company_id = a.company_id
           ORDER BY ar2.updated_at DESC
           LIMIT 1
         )
       WHERE a.company_id = ?
         AND a.archived_at IS NULL
       ORDER BY
         CASE WHEN LOWER(a.role) LIKE '%ceo%' THEN 0 ELSE 1 END,
         a.name ASC
       LIMIT 30`,
    )
    .all(agent.company_id) as Array<{
      name: string;
      role: string;
      status: string;
      adapter_type: string | null;
      runtime_kind: string | null;
      runtime_status: string | null;
      command: string | null;
      workspace_root: string | null;
    }>;

  if (runtimeRoster.length > 0) {
    sections.push("\n## Agent Runtime Readiness");
    sections.push("Use this roster before delegating. Only agents marked runnable should receive autonomous `create_task` or `update_task` assignments. Manual/unconfigured agents are profiles only until a runtime is attached.");
    for (const row of runtimeRoster) {
      const runnable = isExecutableAgentRuntime(row.adapter_type);
      const reason = nonExecutableRuntimeReason(row.adapter_type);
      const runtimeKind = row.runtime_kind ? `/${row.runtime_kind}` : "";
      const runtimeStatus = row.runtime_status ? `, runtime ${row.runtime_status}` : "";
      const workspace = row.workspace_root ? ", workspace ready" : "";
      sections.push(
        `- ${row.name} (${row.role}): ${runnable ? "RUNNABLE" : "NOT RUNNABLE"} — ${runtimeProviderLabel(row.adapter_type)}${runtimeKind}, agent ${row.status}${runtimeStatus}${workspace}${reason ? `; ${reason}` : ""}`,
      );
    }
    sections.push("Instruction: if work needs an unavailable provider, first use `hire_agent` with explicit top-level `runtimeProvider` and `model`, or ask the operator to attach a runtime. Do not assign execution tasks to NOT RUNNABLE agents.");
  }

  // Pending approvals
  const pendingApprovals = db
    .prepare(
      `SELECT a.id, a.type, a.status, a.payload_json
       FROM approvals a
       WHERE a.company_id = ? AND a.status IN ('pending', 'revision_requested')
       ORDER BY a.created_at DESC
       LIMIT 10`
    )
    .all(agent.company_id) as Array<{
      id: string; type: string; status: string; payload_json: string;
    }>;

  if (pendingApprovals.length > 0) {
    sections.push("\n## Pending Approvals (DO NOT recreate these)\n");
    for (const a of pendingApprovals) {
      const payload = parseJson(a.payload_json);
      const label = approvalPromptLabel(a.type, payload, a.id);
      sections.push(`- [${a.status}] ${label}`);
    }
  }

  // Recent completed approvals (so the agent knows what was already decided)
  const decidedApprovals = db
    .prepare(
      `SELECT a.id, a.type, a.status, a.payload_json, a.decision_note
       FROM approvals a
       WHERE a.company_id = ? AND a.status IN ('approved', 'rejected')
       ORDER BY a.decided_at DESC
       LIMIT 5`
    )
    .all(agent.company_id) as Array<{
      id: string; type: string; status: string; payload_json: string; decision_note: string | null;
    }>;

  if (decidedApprovals.length > 0) {
    sections.push("\n## Recently Decided Approvals\n");
    for (const a of decidedApprovals) {
      const payload = parseJson(a.payload_json);
      const label = approvalPromptLabel(a.type, payload, a.id);
      sections.push(`- [${a.status}] ${label}${a.decision_note ? ` — ${a.decision_note.slice(0, 100)}` : ""}`);
    }
  }

  // Recent actions from prior runs (so the agent sees its own history)
  const recentRuns = db
    .prepare(
      `SELECT result_json FROM heartbeat_runs
       WHERE agent_id = ? AND status = 'succeeded' AND result_json != '{}'
       ORDER BY finished_at DESC
       LIMIT 3`
    )
    .all(agent.id) as Array<{ result_json: string }>;

  const priorActions: string[] = [];
  for (const r of recentRuns) {
    const result = parseJson(r.result_json);
    const tc = (result.tasksCreated as string[] | undefined) ?? [];
    const ac = (result.approvalsCreated as string[] | undefined) ?? [];
    if (tc.length > 0) priorActions.push(`Created ${tc.length} task(s)`);
    if (ac.length > 0) priorActions.push(`Created ${ac.length} approval(s)`);
  }
  if (priorActions.length > 0) {
    sections.push(`\n## Your Recent Actions (prior runs)\n${priorActions.join("; ")}`);
    sections.push("Do NOT repeat actions you already took. Only create new work that does not exist yet.");
  }

  // Session continuity info
  if (session.sessionParams.sessionId) {
    sections.push(`\n## Session\nResuming session: ${session.sessionDisplayId ?? session.sessionParams.sessionId}`);
  }

  sections.push("\n## Operator-Facing Output Quality");
  sections.push(`- Task comments are for ${PUBLIC_HUMAN_LABEL}, not for runtime logs. Do not include command lines, stderr/stdout, JSON telemetry, or internal execution notes in comments.`);
  sections.push("- If the task asks for news, articles, sources, or external references, verify the information and include clickable Markdown links in the task comment, e.g. `[Article title](https://example.com/story)`.");
  sections.push("- Do not invent URLs or claim a link is verified unless you actually opened it. HiveRunner checks external links before publishing comments; broken or unavailable links are withheld from the operator-facing reply.");
  sections.push("- Write concise but useful summaries. Use Markdown headings, bold labels, lists, and source links when they make the answer easier to scan.");
  sections.push("- For final deliverables, post one polished `add_comment` for the operator, then move the task to `review` with `update_task` and no status comment.");
  sections.push("- Do not post 'Starting', 'Now I will', stdout/stderr, provider warnings, or JSON traces as comments. Execution history stores those details.");
  sections.push("- If you cannot verify current external information with available tools, say so in a clean task comment instead of inventing sources or stale facts.");

  // Final response-format reminder — placed last so it is the most recent
  // instruction the model reads before generating. The earlier onboarding
  // assets describe mc-action blocks, but by the time the model has read the
  // full context it tends to default to narrative prose. This short reminder
  // makes the structured-output requirement unmissable.
  sections.push("\n---");
  sections.push("## REQUIRED Response Format");
  sections.push(
    "Your response MUST include at least one ```mc-action``` fenced block for every directive, assignment, status update, or status report. Prose-only output is logged as a passive report, and on a task-bound heartbeat it fails the run."
  );
  sections.push("Quick reference (each block wraps a single JSON object):");
  sections.push("- Comment on a task: `add_comment` with `{ \"taskKey\": \"WEA-XXX\", \"body\": \"...\" }`. Lead supervisor ticks must also include `\"source\": \"lead-supervisor\"`.");
  sections.push("- Register a deliverable: `register_artifact` with `{ \"taskKey\", \"uri\", \"kind\", \"sha256\" }`. Use this when your task produces a concrete artifact (HTML report, file, PDF, URL). Include the sha256 of the file content (`shasum -a 256 path`) so no-op resubmissions are caught.");
  sections.push("- Memory utilization receipt: `memory_receipt` with `{ \"taskKey\", \"used\": [{ \"recordId\", \"evidenceEnvelopeId\", \"reason\" }], \"ignored\": [], \"irrelevant\": [] }`. This records agent claims only; output/source matching remains a separate scoring path.");
  sections.push("- Create new work: `create_task` with `{ \"title\", \"assignee\", \"priority\", \"type\" }`. You may also include `\"status\"` (`backlog`, `to-do`, `in-progress`, `review`, `done`, `blocked`), `\"executionEngine\"` (`hiverunner`, `symphony`, `manual`), and `\"modelLane\"` (`default`, `fast`, `mini`, `deep`). Use `hiverunner` or `symphony` for autonomous work; use `manual` only when the operator explicitly asks for operator-controlled work. Child tasks inherit non-manual parent execution engines and model lanes unless you explicitly override them. For chained decomposition (spec → build → validate), set `\"dependsOn\": [\"<task_key>\", ...]` on the downstream piece — the dependent task waits until every listed task is `done` before it starts.");
  sections.push("- Propose goal work for operator review: `propose_sprint_plan` should use Plan Mode when you are lead for a company goal: `{ \"companyGoalId\", \"planMode\": true, \"sprints\": [{ \"sequenceNumber\", \"name\", \"objective\", \"successCriteria\", \"validationChecks\", \"outOfScope\", \"defaultExecutionEngine\", \"defaultModelLane\", \"tasks\": [{ \"title\", \"description\", \"assignee\", \"priority\", \"type\", \"executionEngine\", \"modelLane\", \"dependsOn\", \"validation\" }] }] }`. This creates drafts only; do not create execution tasks directly when planning a goal. The old single-sprint `{ \"sprint\", \"tasks\" }` shape still works only for explicitly one-sprint work.");
  sections.push("- If you are the lead reviewing a completed sprint and the goal is now complete, emit `mark_goal_complete` with `{ \"companyGoalId\", \"reason\" }`. This asks the operator to approve completion; it does not mark the goal done by itself.");
  sections.push("- If the task asks you to create follow-up tasks, you MUST emit one `create_task` block per task in this response. Do not claim tasks were created unless the matching `create_task` blocks are present in this response. If you intentionally skip creation because an active duplicate exists, name the existing task keys.");
  sections.push("- QC/validation work should include `dependsOn` pointing at the task(s) it validates and should name exact artifact paths or acceptance criteria in the description.");
  sections.push("- If you hire agents for a directive, create their scoped worker tasks in the same response before moving the directive to review/done. Hire-only delegation is incomplete.");
  sections.push("- Only assign tasks to agents marked RUNNABLE in Agent Runtime Readiness. Manual/unconfigured agents cannot execute autonomous work.");
  sections.push("- Move status: `update_task` with `{ \"taskKey\", \"status\" }`. Avoid `comment` on status updates unless the note is truly needed; use `add_comment` for operator-facing content.");
  sections.push("- Record goal-contract evidence: `record_validation_evidence` or `record_success_evidence` with `{ \"itemId\", \"status\": \"proposed\" | \"failed\", \"resultText\", \"commandExitCode\", \"artifactUri\" }`. Agents may propose or flag evidence, but only the operator can confirm evidence as passed.");
  sections.push("- Review decisions: if you are reviewing a task and it passes, use `add_comment` for QA notes and then `update_task` with `{ \"taskKey\", \"status\": \"done\" }`. Do not leave accepted work sitting in `review`.");
  sections.push("- Explicit skill use: when you materially apply one of your Active Runtime Skills, emit exactly one `use_skill` with `{ \"skill\", \"taskKey\", \"note\" }`. Prefer the skill slug. The note should name the concrete procedure or checklist you applied.");
  sections.push("- Learning reviews: if you are reviewing a skill or memory candidate, use `add_comment` for rationale and then `review_candidate` with `{ \"targetType\": \"skill\" | \"memory\", \"targetId\", \"decision\": \"approve\" | \"reject\", \"note\", \"confidence\" }`.");
  sections.push("- Hire an agent: `hire_agent` with `{ \"name\", \"role\", \"capabilities\", \"reason\" }`");
  sections.push("- Report only (no action needed): `report` with `{ \"summary\" }`");
  sections.push("Even if your only output is a status report, wrap it in an `mc-action` `report` block. Narrative paragraphs outside blocks do NOT count.");
  sections.push("Final-answer example:\n```mc-action\n{\"action\":\"add_comment\",\"taskKey\":\"WEA-XXX\",\"body\":\"**Summary**\\n\\nCompleted the research and included the three strongest sources with links.\"}\n```\n```mc-action\n{\"action\":\"update_task\",\"taskKey\":\"WEA-XXX\",\"status\":\"review\"}\n```");

  return sections.join("\n").trim();
}

export function buildUnassignedTaskTriagePrompt(input: {
  agent: AgentRow;
  task: {
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    type: string;
    task_key: string;
    project_name: string;
  };
  comments: Array<{
    body: string;
    type: string;
    source: string | null;
    author_agent_name: string | null;
    created_at: string;
  }>;
  db: Database.Database;
}): string {
  const sections: string[] = [];
  sections.push("# Fast Triage Wake");
  sections.push(`Agent: ${input.agent.name} (${input.agent.role})`);
  sections.push("Wake reason: sweep_unassigned_to_ceo");
  sections.push("");
  sections.push("Your only job is to route this unassigned task. Do not solve it. Do not inspect files. Do not create a plan unless the task must be split.");
  sections.push("Choose exactly one outcome: assign to a runnable non-CEO agent, hire a missing specialist, or move back to backlog if it is not actionable.");
  sections.push("");
  sections.push("## Task");
  sections.push(`- [${input.task.task_key}] ${input.task.title}`);
  sections.push(`- Status: ${input.task.status}; priority: ${input.task.priority}; type: ${input.task.type}; project: ${input.task.project_name}`);
  if (input.task.description.trim()) {
    sections.push(`- Description: ${truncateForPrompt(input.task.description.trim(), 900)}`);
  }

  const comments = input.comments.slice(0, 3);
  if (comments.length > 0) {
    sections.push("");
    sections.push("## Recent Context");
    for (const comment of comments.slice().reverse()) {
      const author = comment.author_agent_name ?? (comment.source === "engine" ? "System" : "Human/operator");
      sections.push(`- ${comment.created_at} ${author}: ${truncateForPrompt(comment.body, 260)}`);
    }
  }

  const roster = input.db
    .prepare(
      `SELECT
         a.name,
         a.role,
         a.status,
         a.adapter_type,
         a.capabilities,
         ar.status AS runtime_status
       FROM agents a
       LEFT JOIN agent_runtimes ar
         ON ar.id = (
           SELECT ar2.id
           FROM agent_runtimes ar2
           WHERE ar2.agent_id = a.id
             AND ar2.company_id = a.company_id
           ORDER BY ar2.updated_at DESC
           LIMIT 1
         )
       WHERE a.company_id = ?
         AND a.archived_at IS NULL
       ORDER BY
         CASE
           WHEN LOWER(a.name) = 'oracle' THEN 0
           WHEN LOWER(a.role) LIKE '%qa%' OR LOWER(a.role) LIKE '%verification%' THEN 1
           WHEN LOWER(a.role) LIKE '%engineer%' THEN 2
           WHEN LOWER(a.role) LIKE '%designer%' THEN 3
           ELSE 4
         END,
         a.name ASC
         LIMIT 16`,
    )
    .all(input.agent.company_id) as Array<{
      name: string;
      role: string;
      status: string;
      adapter_type: string | null;
      capabilities: string | null;
      runtime_status: string | null;
    }>;

  sections.push("");
  sections.push("## Runnable Roster");
  for (const row of roster) {
    const runnable = row.name !== input.agent.name && isExecutableAgentRuntime(row.adapter_type);
    const runtimeStatus = row.runtime_status ? `, runtime ${row.runtime_status}` : "";
    const capabilities = row.capabilities?.trim() ? ` — ${truncateForPrompt(row.capabilities.trim(), 180)}` : "";
    sections.push(
      `- ${row.name} (${row.role}): ${runnable ? "RUNNABLE" : "DO NOT ASSIGN"}; ${runtimeProviderLabel(row.adapter_type)}; agent ${row.status}${runtimeStatus}${capabilities}`,
    );
  }

  sections.push("");
  sections.push("## Required Output");
  sections.push("Emit one or two mc-action blocks only.");
  sections.push("Hard rule: only `update_task` and `hire_agent` are allowed.");
  sections.push("Preferred assignment:");
  sections.push("```mc-action");
  sections.push(`{"action":"update_task","taskKey":"${input.task.task_key}","assignee":"<RunnableAgentName>","comment":"Routing to <RunnableAgentName> because <short reason>."}`);
  sections.push("```");
  sections.push("If a new specialist is needed:");
  sections.push("```mc-action");
  sections.push(`{"action":"hire_agent","name":"<Name>","role":"<Specialist Role>","reason":"<Why this specialist is needed>"}`);
  sections.push("```");
  sections.push("If no agent fits and no specialist is clear:");
  sections.push("```mc-action");
  sections.push(`{"action":"update_task","taskKey":"${input.task.task_key}","status":"backlog","comment":"No clear triage route yet; returning to backlog for later routing."}`);
  sections.push("```");
  sections.push("Hard stop: do not add narrative outside mc-action blocks.");

  return sections.join("\n").trim();
}
