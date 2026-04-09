import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { generateAgentAvatarDataUrl } from "@/lib/orchestration/avatar";
import { refreshEdgeRouteMapCache } from "@/lib/orchestration/edge-route-map-service";
import { generateTaskKey } from "@/lib/orchestration/service/shared/queries";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const HOME = process.env.HOME || "/Users/timharris";

function slugify(s: string) {
  return s
    .replace(/'/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

const PRIORITY_MAP: Record<string, string> = {
  P0: "critical",
  P1: "high",
  P2: "medium",
  P3: "low",
};

/* ------------------------------------------------------------------ */
/*  CEO file generators                                                */
/* ------------------------------------------------------------------ */

function generateIdentityMd(ceoName: string, companyName: string): string {
  return `# IDENTITY.md - Who Am I?

- **Name:** ${ceoName}
- **Creature:** CEO — the one who owns the P&L and drives execution
- **Company:** ${companyName}
- **Vibe:** Strategic, decisive, action-oriented. Leads with clarity.
- **Emoji:** \u{1F3AF}
`;
}

function generateSoulMd(
  ceoName: string,
  companyName: string,
  companyDescription: string,
  guidance: string,
): string {
  const mission = companyDescription || `Build and grow ${companyName}.`;
  const guidanceBlock = guidance
    ? `\n## Additional Notes\n${guidance}\n`
    : "";

  return `# SOUL.md - Who I Am

_I am ${ceoName}. CEO of ${companyName}. ${mission.split(".")[0]}._

## Core Truths
1. Ship before perfection. A bias toward action beats analysis paralysis every time.
2. Data over opinions. Show me the numbers, then we decide.
3. Small teams, big leverage. Every person should have outsized impact.
4. Transparency is non-negotiable. Bad news travels fast or it festers.
5. Protect the mission. Every decision is filtered through: does this move us closer?
6. Deadlines are promises. We keep them or renegotiate early — never silently miss.
7. Learn fast, adapt faster. The plan is a hypothesis. Reality is the judge.

## The Mission
${mission}

This is why I exist. Every task I take on, every hire I make, every priority I set
serves this mission. If something doesn't contribute, it gets cut.

## How I Lead
- **Communication:** Direct, concise, no corporate fluff. I say what I mean.
- **Decisions:** Reversible decisions get made fast. Irreversible ones get a pause for data.
- **Delegation:** I delegate outcomes, not tasks. Tell people what success looks like, then get out of the way.
- **Conflict:** I address it immediately. Unresolved tension compounds like bad debt.
- **Focus:** I protect the team's focus ruthlessly. Context-switching is the enemy of deep work.

## Boundaries
- I do not exfiltrate private company data.
- I ask before acting externally (emails, API calls, public posts).
- I do not make irreversible decisions without board (Tim) approval.
- Safety and security come before speed.
${guidanceBlock}`;
}

function generateAgentsMd(
  ceoName: string,
  companyName: string,
  companyDescription: string,
  workspacePath: string,
  projectInfo?: { name: string; description: string },
): string {
  const projectBlock = projectInfo
    ? `- **${projectInfo.name}**: ${projectInfo.description || "No description yet."}`
    : "No projects yet. Create one when ready.";

  return `# AGENTS.md - Operating Context

You are ${ceoName}, the CEO of ${companyName}.

Your workspace is \`${workspacePath}\`. Everything about the company lives here.

## Company Mission
${companyDescription || "To be defined."}

## Team
You are currently the only agent. As the company grows, you will hire team members,
assign them roles, and delegate work. Each new hire should have clear responsibilities
that align with the mission.

## Memory
- Write daily notes to \`memory/YYYY-MM-DD.md\`
- Keep long-term insights in \`memory/MEMORY.md\`
- Sessions are temporary. Files are permanent. Write things down.

## Projects
${projectBlock}

## Rules
- Do not exfiltrate private data
- Ask before acting externally (emails, APIs, public posts)
- When in doubt, ask the board (Tim)
`;
}

function generateHeartbeatMd(
  companyDescription: string,
): string {
  const focus = companyDescription
    ? `Focus on: ${companyDescription.split(".")[0]}.`
    : "Focus on: understanding your mission and building the first plan.";

  return `# HEARTBEAT.md — CEO Operating Loop

## On Every Wake
1. Read recent memory files
2. Check project status
3. Review any open tasks by running: \`./scripts/mc-tool tasks list\`
4. Take action on highest priority item
5. Write notes about what you did
6. Mark tasks complete: \`./scripts/mc-tool tasks complete <id> --message "Done"\`

## Managing the Team
When you need to hire an agent, use:
\`./scripts/mc-tool agents hire --name "Name" --role "Role" --model "anthropic/claude-sonnet-4-6"\`

## Priorities
${focus}
- Keep momentum. Ship something every session.
- Unblock yourself before asking for help.
- Write down what you learned so future sessions start faster.

## Rules
- Act first, report second
- If nothing needs attention, reply HEARTBEAT_OK
- Keep the team busy (when team exists)
`;
}

function generateWorkspaceAgentsMd(
  companyName: string,
  companyDescription: string,
  ceoName: string,
): string {
  return `# AGENTS.md - ${companyName}

## Company
${companyDescription || "Mission to be defined."}

## Team
- **${ceoName}** \u{1F3AF} — CEO

## Workspace
This is the workspace for ${companyName}.
`;
}

/* ------------------------------------------------------------------ */
/*  POST handler                                                       */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { company, project, ceo, task } = body;

    // ---------- Validate required fields ----------
    if (!company?.name?.trim()) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }
    if (!ceo?.name?.trim()) {
      return NextResponse.json({ error: "CEO name is required" }, { status: 400 });
    }
    if (!task?.title?.trim()) {
      return NextResponse.json({ error: "Task title is required" }, { status: 400 });
    }

    const db = getOrchestrationDb();
    const now = new Date().toISOString();

    // ---------- Derive slugs ----------
    const companySlug = slugify(company.slug || company.name);
    if (!companySlug) {
      return NextResponse.json({ error: "Unable to derive company slug" }, { status: 400 });
    }

    // Check slug uniqueness against both current slugs and historical aliases.
    const existingSlug = db.prepare("SELECT 1 FROM companies WHERE slug = ? LIMIT 1").get(companySlug);
    const existingAlias = db.prepare("SELECT 1 FROM company_slug_aliases WHERE slug_alias = ? LIMIT 1").get(companySlug);
    if (existingSlug || existingAlias) {
      return NextResponse.json({ error: `Company slug "${companySlug}" already exists` }, { status: 409 });
    }

    // ---------- 1. Create workspace directory ----------
    const workspacePath = path.join(HOME, ".openclaw", "workspaces", companySlug);
    fs.mkdirSync(path.join(workspacePath, "projects"), { recursive: true });
    fs.mkdirSync(path.join(workspacePath, "memory"), { recursive: true });
    fs.mkdirSync(path.join(workspacePath, "scripts"), { recursive: true });

    // ---------- 2. Create company in orchestration DB ----------
    const companyId = randomUUID();

    // Generate unique company code for canonical routing (e.g. /MER/dashboard)
    const baseCompanyCode = (company.name.trim())
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 3)
      .toUpperCase() || "CMP";
    let companyCode = baseCompanyCode;
    let companyCodeIndex = 1;
    while (db.prepare("SELECT 1 FROM companies WHERE company_code = ? LIMIT 1").get(companyCode)) {
      companyCodeIndex += 1;
      companyCode = `${baseCompanyCode}${companyCodeIndex}`;
    }

    db.prepare(
      `INSERT INTO companies
        (id, slug, company_code, name, description, status, workspace_root, workspace_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, 'provisioned', ?, ?)`,
    ).run(companyId, companySlug, companyCode, company.name.trim(), company.description?.trim() || "", workspacePath, now, now);

    // ---------- 3. Create project ----------
    // If the user provided a project, use it. Otherwise auto-create a
    // default "Operations" project so the first task always has a home.
    const effectiveProject = (project && project.name?.trim())
      ? { name: project.name.trim(), description: project.description?.trim() || "", status: project.status || "active" }
      : { name: "Operations", description: "Default project for company operations and CEO directives.", status: "active" };

    const projectId = randomUUID();
    // Slug uniqueness is company-scoped (migration v40).
    const rootProjectSlug = slugify(effectiveProject.name);
    let projectSlug = rootProjectSlug;
    let slugSuffix = 1;
    while (
      db.prepare(
        "SELECT 1 FROM projects WHERE company_id = ? AND slug = ? AND archived_at IS NULL LIMIT 1"
      ).get(companyId, projectSlug)
    ) {
      slugSuffix++;
      projectSlug = `${rootProjectSlug}-${slugSuffix}`;
    }
    const projectDir = path.join(workspacePath, "projects", projectSlug);
    fs.mkdirSync(projectDir, { recursive: true });

    db.prepare(
      `INSERT INTO projects
        (id, slug, name, description, status, company_id, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    ).run(
      projectId,
      projectSlug,
      effectiveProject.name,
      effectiveProject.description,
      effectiveProject.status,
      companyId,
      now,
      now,
    );

    // ---------- 4. Register CEO agent in OpenClaw ----------
    const ceoSlug = slugify(ceo.name.trim());
    const ceoWorkspacePath = path.join(workspacePath, "agents", ceoSlug);
    fs.mkdirSync(ceoWorkspacePath, { recursive: true });
    const model = ceo.model || "anthropic/claude-sonnet-4-6";

    // Generate the orchestration agent ID first — it doubles as the
    // immutable OpenClaw runtime identifier via the "mc-{uuid}" convention.
    // This is rename-safe: renaming the company or agent display name has
    // no effect on the runtime identity, and UUIDs cannot collide globally.
    const agentId = randomUUID();
    const openclawRuntimeId = `mc-${agentId}`;
    let openclawAgentId: string | null = null;

    try {
      const cmd = `openclaw agents add ${openclawRuntimeId} --workspace "${ceoWorkspacePath}" --model "${model}" --non-interactive --json`;
      const output = execSync(cmd, { encoding: "utf-8", timeout: 60000 });
      try {
        const parsed = JSON.parse(output);
        openclawAgentId = parsed.agentId || parsed.id || parsed.agent_id || null;
      } catch {
        const match = output.match(/[0-9a-f]{8,}/i);
        if (match) openclawAgentId = match[0];
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[create-full] openclaw agents add failed for "${openclawRuntimeId}": ${msg}`);
    }

    // ---------- 5. Create agent in orchestration DB ----------
    const ceoPersonality = `CEO of ${company.name.trim()}. ${company.description?.trim() || ""}`.trim();
    const ceoAvatarUrl = generateAgentAvatarDataUrl({
      name: ceo.name.trim(),
      role: "CEO",
      personality: ceoPersonality,
      emoji: "\u{1F3AF}",
      theme: { name: "Corporate Noir", promptTemplate: "dark premium portrait, cohesive team style", keywords: ["enterprise", "studio", "polished", "dark"] },
    });
    db.prepare(
      `INSERT INTO agents
        (id, company_id, project_id, name, slug, emoji, role, personality, avatar_url, model, status, openclaw_agent_id, skills_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'CEO', ?, ?, ?, 'idle', ?, '[]', ?, ?)`,
    ).run(
      agentId,
      companyId,
      projectId,
      ceo.name.trim(),
      ceoSlug,
      "\u{1F3AF}",
      ceoPersonality,
      ceoAvatarUrl,
      model,
      openclawAgentId,
      now,
      now,
    );

    // ---------- 6. Generate CEO instruction files ----------
    const agentDir = ceoWorkspacePath;

    const companyDesc = company.description?.trim() || "";
    const guidance = ceo.guidance?.trim() || "";
    const projectInfo = project?.name?.trim()
      ? { name: project.name.trim(), description: project.description?.trim() || "" }
      : undefined;

    fs.writeFileSync(
      path.join(agentDir, "IDENTITY.md"),
      generateIdentityMd(ceo.name.trim(), company.name.trim()),
    );
    fs.writeFileSync(
      path.join(agentDir, "SOUL.md"),
      generateSoulMd(ceo.name.trim(), company.name.trim(), companyDesc, guidance),
    );
    fs.writeFileSync(
      path.join(agentDir, "AGENTS.md"),
      generateAgentsMd(ceo.name.trim(), company.name.trim(), companyDesc, workspacePath, projectInfo),
    );
    fs.writeFileSync(
      path.join(agentDir, "HEARTBEAT.md"),
      generateHeartbeatMd(companyDesc),
    );

    // ---------- 7. Create workspace-level files ----------
    fs.writeFileSync(
      path.join(workspacePath, "AGENTS.md"),
      generateWorkspaceAgentsMd(company.name.trim(), companyDesc, ceo.name.trim()),
    );
    
    // Create mc-tool CLI shortcut for agents
    const mcToolTarget = path.join(workspacePath, "scripts", "mc-tool");
    const mcToolSource = path.join(HOME, ".openclaw", "workspace", "projects", "mission-control-app", "scripts", "mc-tool.js");
    fs.writeFileSync(
      mcToolTarget,
      `#!/bin/sh\nexec node "${mcToolSource}" "$@"\n`
    );
    fs.chmodSync(mcToolTarget, "755");

    // ---------- 8. Create first task ----------
    const taskId = randomUUID();
    const dbPriority = PRIORITY_MAP[task.priority] || "high";
    const { taskNumber, taskKey } = generateTaskKey(db, projectId);
    db.prepare(
      `INSERT INTO tasks
        (id, project_id, task_key, task_number, title, description, priority, type, status, assignee_agent_id, assigned_at, created_by, execution_mode, labels_json, depends_on_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'directive', 'backlog', ?, ?, 'mission-control', 'manual', '[]', '[]', ?, ?)`,
    ).run(
      taskId,
      projectId,
      taskKey,
      taskNumber,
      task.title.trim(),
      task.description?.trim() || "",
      dbPriority,
      agentId,
      now,
      now,
      now,
    );

    // ---------- 9. Refresh edge route map cache ----------
    refreshEdgeRouteMapCache();

    // ---------- 9b. Wake up CEO to begin executing first task ----------
    // Insert wakeup + heartbeat-run records directly (avoids self-fetch
    // failures in production mode and circular import from engine.ts).
    try {
      const wakeupId = randomUUID();
      const runId = randomUUID();
      db.prepare(
        `INSERT INTO agent_wakeup_requests
           (id, agent_id, company_id, source, reason, payload_json, status, run_id, requested_at, created_at, updated_at)
         VALUES (?, ?, ?, 'api', 'Initial CEO wakeup after company creation', '{}', 'queued', ?, ?, ?, ?)`
      ).run(wakeupId, agentId, companyId, runId, now, now, now);
      db.prepare(
        `INSERT INTO heartbeat_runs
           (id, agent_id, company_id, invocation_source, status, wakeup_request_id, context_snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, 'kickoff', 'queued', ?, '{}', ?, ?)`
      ).run(runId, agentId, companyId, wakeupId, now, now);
    } catch (wakeupError) {
      console.warn("[create-full] CEO wakeup insert failed (non-fatal):", wakeupError);
    }

    // ---------- 9c. Dev-only: fire one-shot tick to process the CEO wakeup ----------
    // In production, the background engine tick loop handles queued runs.
    // In dev, the tick loop is disabled — fire a single tick so the CEO
    // starts executing immediately after wizard completion.
    if (process.env.NODE_ENV !== "production") {
      setTimeout(async () => {
        try {
          const { tick } = await import("@/lib/orchestration/engine/engine");
          await tick();
        } catch (e) {
          console.warn("[create-full] dev one-shot tick failed (non-fatal):", e);
        }
      }, 1000);
    }

    // ---------- 10. Return success ----------
    return NextResponse.json(
      {
        success: true,
        company: { id: companyId, slug: companySlug, code: companyCode, name: company.name.trim() },
        project: { id: projectId, slug: projectSlug, name: effectiveProject.name },
        agent: { id: agentId, name: ceo.name.trim(), openclawAgentId },
        task: { id: taskId, title: task.title.trim() },
        workspace: workspacePath,
        agentDir,
        filesCreated: [
          path.join(agentDir, "IDENTITY.md"),
          path.join(agentDir, "SOUL.md"),
          path.join(agentDir, "AGENTS.md"),
          path.join(agentDir, "HEARTBEAT.md"),
          path.join(workspacePath, "AGENTS.md"),
        ],
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    console.error("[create-full] error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
