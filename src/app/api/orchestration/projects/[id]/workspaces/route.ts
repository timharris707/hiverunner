import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

import { handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export const dynamic = "force-dynamic";

const OPENCLAW_DIR = process.env.OPENCLAW_DIR || "/Users/timharris/.openclaw";

type AgentWorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  role: string;
  status: string;
};

type RunContextRow = {
  agent_id: string | null;
  agent_name: string | null;
  provider: string;
  session_id: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectIdOrSlug } = await params;
    const db = getOrchestrationDb();

    // Resolve project
    const project = db
      .prepare(
        `SELECT p.id, p.name, p.slug, p.company_id
         FROM projects p
         WHERE (p.id = ? OR p.slug = ?)
           AND p.archived_at IS NULL
         LIMIT 1`
      )
      .get(projectIdOrSlug, projectIdOrSlug) as
      | { id: string; name: string; slug: string; company_id: string }
      | undefined;

    if (!project) {
      return NextResponse.json({ error: "project_not_found" }, { status: 404 });
    }

    // Get company workspace root
    const company = db
      .prepare(
        `SELECT id, slug, name, workspace_root
         FROM companies
         WHERE id = ? AND archived_at IS NULL
         LIMIT 1`
      )
      .get(project.company_id) as
      | { id: string; slug: string; name: string; workspace_root: string | null }
      | undefined;

    const companyWorkspaceRoot = company?.workspace_root?.trim() || null;
    const companyRootExists = companyWorkspaceRoot
      ? fs.existsSync(companyWorkspaceRoot)
      : false;

    // Check if the project has a subdirectory in the workspace.
    // There is no persisted project workspace path in the projects table,
    // so the path is inferred from naming convention and then filesystem-checked.
    let projectDir: string | null = null;
    let projectDirExists = false;
    if (companyWorkspaceRoot && companyRootExists) {
      const candidatePaths = [
        path.join(companyWorkspaceRoot, "projects", project.slug),
        path.join(companyWorkspaceRoot, "projects", project.name.toLowerCase().replace(/\s+/g, "-")),
      ];
      for (const candidate of candidatePaths) {
        if (fs.existsSync(candidate)) {
          projectDir = candidate;
          projectDirExists = true;
          break;
        }
      }
      if (!projectDir) {
        projectDir = candidatePaths[0];
      }
    }

    // Get agents assigned to this project
    const agents = db
      .prepare(
        `SELECT id, name, slug, role, status
         FROM agents
         WHERE project_id = ?
           AND archived_at IS NULL
         ORDER BY name ASC`
      )
      .all(project.id) as AgentWorkspaceRow[];

    // Build agent workspace info.
    // Agent workspace paths are convention-derived (~/.openclaw/workspace-{slug}),
    // not persisted. The agents table has no workspace_path column, and
    // adapter_config_json does not currently store workspace paths.
    const agentWorkspaces = agents.map((agent) => {
      const agentWorkspaceDir = path.join(OPENCLAW_DIR, `workspace-${agent.slug}`);
      const exists = fs.existsSync(agentWorkspaceDir);

      let hasIdentity = false;
      if (exists) {
        hasIdentity = fs.existsSync(path.join(agentWorkspaceDir, "IDENTITY.md"));
      }

      return {
        agentId: agent.id,
        agentName: agent.name,
        agentSlug: agent.slug,
        agentRole: agent.role,
        agentStatus: agent.status,
        workspacePath: agentWorkspaceDir,
        exists,
        hasIdentity,
        source: "convention" as const,
        verified: exists,
      };
    });

    // Get recent execution runs for this project (last 10)
    const recentRuns = db
      .prepare(
        `SELECT
           er.agent_id,
           a.name AS agent_name,
           er.provider,
           er.session_id,
           er.status,
           er.started_at,
           er.completed_at,
           er.duration_ms
         FROM execution_runs er
         LEFT JOIN agents a ON er.agent_id = a.id
         LEFT JOIN tasks t ON er.task_id = t.id
         WHERE t.project_id = ?
           AND er.started_at IS NOT NULL
         ORDER BY er.started_at DESC
         LIMIT 10`
      )
      .all(project.id) as RunContextRow[];

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
      },
      company: {
        id: company?.id ?? null,
        slug: company?.slug ?? null,
        name: company?.name ?? null,
        workspaceRoot: companyWorkspaceRoot,
        workspaceRootExists: companyRootExists,
        source: "persisted" as const,
      },
      projectDirectory: {
        path: projectDir,
        exists: projectDirExists,
        source: "convention" as const,
        verified: projectDirExists,
      },
      agentWorkspaces,
      recentExecutionContext: recentRuns.map((run) => ({
        agentId: run.agent_id,
        agentName: run.agent_name,
        provider: run.provider,
        sessionId: run.session_id,
        status: run.status,
        startedAt: run.started_at,
        completedAt: run.completed_at,
        durationMs: run.duration_ms,
      })),
    });
  } catch (error) {
    return handleRouteError(error, "project-workspaces:get");
  }
}
