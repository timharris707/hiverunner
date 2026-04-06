import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

import { handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export const dynamic = "force-dynamic";

const OPENCLAW_DIR = process.env.OPENCLAW_DIR || "/Users/timharris/.openclaw";

type RunRow = {
  id: string;
  task_id: string | null;
  task_key: string | null;
  task_title: string | null;
  provider: string;
  session_id: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  token_usage_json: string;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; agentSlug: string }> }
) {
  try {
    const { id: projectIdOrSlug, agentSlug } = await params;
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

    // Resolve agent
    const agent = db
      .prepare(
        `SELECT id, name, slug, role, status, adapter_type, created_at
         FROM agents
         WHERE (slug = ? OR id = ?)
           AND project_id = ?
           AND archived_at IS NULL
         LIMIT 1`
      )
      .get(agentSlug, agentSlug, project.id) as
      | {
          id: string;
          name: string;
          slug: string;
          role: string;
          status: string;
          adapter_type: string;
          created_at: string;
        }
      | undefined;

    if (!agent) {
      return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
    }

    // Workspace directory — convention-derived, not persisted.
    // No workspace_path column exists on agents; adapter_config_json is typically empty.
    const workspaceDir = path.join(OPENCLAW_DIR, `workspace-${agent.slug}`);
    const exists = fs.existsSync(workspaceDir);

    // Filesystem contents (top-level only)
    let files: { name: string; type: "file" | "directory"; size?: number }[] = [];
    if (exists) {
      try {
        const entries = fs.readdirSync(workspaceDir, { withFileTypes: true });
        files = entries
          .filter((e) => !e.name.startsWith("."))
          .slice(0, 30)
          .map((e) => {
            const entry: { name: string; type: "file" | "directory"; size?: number } = {
              name: e.name,
              type: e.isDirectory() ? "directory" : "file",
            };
            if (!e.isDirectory()) {
              try {
                entry.size = fs.statSync(path.join(workspaceDir, e.name)).size;
              } catch {
                // best-effort
              }
            }
            return entry;
          })
          .sort((a, b) => {
            if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
      } catch {
        // best-effort
      }
    }

    // Identity file content
    let identity: string | null = null;
    const identityPath = path.join(workspaceDir, "IDENTITY.md");
    if (exists && fs.existsSync(identityPath)) {
      try {
        identity = fs.readFileSync(identityPath, "utf-8").slice(0, 2000);
      } catch {
        // best-effort
      }
    }

    // Git status
    let gitInfo: { branch?: string; hasRepo: boolean } = { hasRepo: false };
    if (exists && fs.existsSync(path.join(workspaceDir, ".git"))) {
      gitInfo.hasRepo = true;
      try {
        const headRef = fs.readFileSync(path.join(workspaceDir, ".git", "HEAD"), "utf-8").trim();
        if (headRef.startsWith("ref: refs/heads/")) {
          gitInfo.branch = headRef.replace("ref: refs/heads/", "");
        }
      } catch {
        // best-effort
      }
    }

    // Recent runs by this agent on this project (last 15)
    const recentRuns = db
      .prepare(
        `SELECT
           er.id,
           er.task_id,
           t.task_key,
           t.title AS task_title,
           er.provider,
           er.session_id,
           er.status,
           er.started_at,
           er.completed_at,
           er.duration_ms,
           er.token_usage_json
         FROM execution_runs er
         LEFT JOIN tasks t ON er.task_id = t.id
         WHERE er.agent_id = ?
           AND (t.project_id = ? OR er.task_id IS NULL)
           AND er.started_at IS NOT NULL
         ORDER BY er.started_at DESC
         LIMIT 15`
      )
      .all(agent.id, project.id) as RunRow[];

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
      },
      agent: {
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        role: agent.role,
        status: agent.status,
        provider: agent.adapter_type,
        createdAt: agent.created_at,
      },
      workspace: {
        path: workspaceDir,
        exists,
        files,
        identity,
        git: gitInfo,
        source: "convention",
        verified: exists,
      },
      recentRuns: recentRuns.map((r) => {
        let tokenUsage: Record<string, unknown> = {};
        try {
          tokenUsage = JSON.parse(r.token_usage_json || "{}");
        } catch {
          // best-effort
        }
        return {
          id: r.id,
          taskId: r.task_id,
          taskKey: r.task_key,
          taskTitle: r.task_title,
          provider: r.provider,
          sessionId: r.session_id,
          status: r.status,
          startedAt: r.started_at,
          completedAt: r.completed_at,
          durationMs: r.duration_ms,
          tokenUsage,
        };
      }),
    });
  } catch (error) {
    return handleRouteError(error, "project-workspace-detail:get");
  }
}
