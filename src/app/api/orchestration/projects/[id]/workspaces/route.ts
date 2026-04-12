import { NextRequest, NextResponse } from "next/server";
import fs from "fs";

import { handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  resolveAgentWorkspacePathWithLegacyFallback,
  resolveCompanyProjectWorkspacePath,
} from "@/lib/workspaces/company-paths";

export const dynamic = "force-dynamic";

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
    const projectDirectory = resolveCompanyProjectWorkspacePath(companyWorkspaceRoot, {
      slug: project.slug,
      name: project.name,
    });

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

    // Build agent workspace info. Company-scoped agents live under the
    // company's workspace root. Legacy global workspaces are only a fallback.
    const agentWorkspaces = agents.map((agent) => {
      const agentWorkspace = resolveAgentWorkspacePathWithLegacyFallback(
        companyWorkspaceRoot,
        agent.slug,
      );

      let hasIdentity = false;
      if (agentWorkspace.exists) {
        hasIdentity = fs.existsSync(`${agentWorkspace.path}/IDENTITY.md`);
      }

      return {
        agentId: agent.id,
        agentName: agent.name,
        agentSlug: agent.slug,
        agentRole: agent.role,
        agentStatus: agent.status,
        workspacePath: agentWorkspace.path,
        exists: agentWorkspace.exists,
        hasIdentity,
        source: agentWorkspace.source,
        verified: agentWorkspace.exists,
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
        path: projectDirectory.path,
        exists: projectDirectory.exists,
        source: "convention" as const,
        verified: projectDirectory.exists,
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
