import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { handleRouteError, OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { isPathContained } from "@/lib/workspaces/delete-safety";
import { resolveCompanyAgentWorkspacePath } from "@/lib/workspaces/company-paths";

export const dynamic = "force-dynamic";

const CORE_FILE_NAMES = ["IDENTITY.md", "SOUL.md", "AGENTS.md", "HEARTBEAT.md", "TOOLS.md"] as const;
const MAX_EDITABLE_FILE_BYTES = 220_000;

type AgentFileGroup = "core" | "memory";

type AgentFileWire = {
  relativePath: string;
  name: string;
  group: AgentFileGroup;
  exists: boolean;
  editable: boolean;
  size: number;
  updatedAt: string | null;
  content: string;
};

type AgentWorkspaceRow = {
  id: string;
  name: string;
  slug: string | null;
  runtime_slug: string | null;
  company_id: string;
  company_workspace_root: string | null;
  runtime_workspace_root: string | null;
};

function resolveAgentWorkspace(agentIdOrSlug: string): { agent: AgentWorkspaceRow; root: string | null } {
  const db = getOrchestrationDb();
  const agent = db
    .prepare(
      `SELECT
         a.id,
         a.name,
         a.slug,
         a.runtime_slug,
         a.company_id,
         c.workspace_root AS company_workspace_root,
         (
           SELECT ar.workspace_root
           FROM agent_runtimes ar
           WHERE ar.agent_id = a.id
             AND ar.scope = 'agent'
             AND ar.workspace_root IS NOT NULL
             AND TRIM(ar.workspace_root) != ''
           ORDER BY ar.updated_at DESC
           LIMIT 1
         ) AS runtime_workspace_root
       FROM agents a
       JOIN companies c ON c.id = a.company_id
       WHERE a.archived_at IS NULL
         AND (a.id = ? OR a.slug = ? OR lower(a.name) = lower(?) OR a.openclaw_agent_id = ?)
       LIMIT 1`,
    )
    .get(agentIdOrSlug, agentIdOrSlug, agentIdOrSlug, agentIdOrSlug) as AgentWorkspaceRow | undefined;

  if (!agent) {
    throw new OrchestrationApiError(404, "agent_not_found", `Agent "${agentIdOrSlug}" not found.`);
  }

  const runtimeRoot = agent.runtime_workspace_root?.trim()
    ? path.resolve(agent.runtime_workspace_root)
    : null;
  const companyRoot = agent.company_workspace_root?.trim()
    ? path.resolve(agent.company_workspace_root)
    : null;
  const runtimeLooksLikeSharedOpenClawRoot = runtimeRoot && path.basename(runtimeRoot) === "workspace";
  if (runtimeRoot && (!companyRoot || runtimeRoot !== companyRoot) && !runtimeLooksLikeSharedOpenClawRoot) {
    return { agent, root: runtimeRoot };
  }

  const agentSlug = agent.runtime_slug?.trim() || agent.slug?.trim() || agent.name || agent.id;
  const fallbackRoot = resolveCompanyAgentWorkspacePath(agent.company_workspace_root, agentSlug);
  return { agent, root: fallbackRoot ? path.resolve(fallbackRoot) : null };
}

function fileStats(filePath: string): { exists: boolean; size: number; updatedAt: string | null; content: string } {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return { exists: false, size: 0, updatedAt: null, content: "" };
    }
    const size = stat.size;
    const content = size <= MAX_EDITABLE_FILE_BYTES ? fs.readFileSync(filePath, "utf8") : "";
    return {
      exists: true,
      size,
      updatedAt: stat.mtime.toISOString(),
      content,
    };
  } catch {
    return { exists: false, size: 0, updatedAt: null, content: "" };
  }
}

function readAgentFiles(root: string): AgentFileWire[] {
  const files: AgentFileWire[] = CORE_FILE_NAMES.map((name) => {
    const stats = fileStats(path.join(root, name));
    return {
      relativePath: name,
      name,
      group: "core",
      exists: stats.exists,
      editable: stats.size <= MAX_EDITABLE_FILE_BYTES,
      size: stats.size,
      updatedAt: stats.updatedAt,
      content: stats.content,
    };
  });

  const memoryRoot = path.join(root, "memory");
  try {
    const memoryFiles = fs
      .readdirSync(memoryRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(md|txt)$/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 30);

    for (const entry of memoryFiles) {
      const relativePath = path.join("memory", entry.name);
      const stats = fileStats(path.join(memoryRoot, entry.name));
      files.push({
        relativePath,
        name: entry.name,
        group: "memory",
        exists: stats.exists,
        editable: stats.size <= MAX_EDITABLE_FILE_BYTES,
        size: stats.size,
        updatedAt: stats.updatedAt,
        content: stats.content,
      });
    }
  } catch {
    // Missing memory folders are valid for older agents; the UI will show only core files.
  }

  return files;
}

function resolveEditableFile(root: string, relativePath: string): { path: string; relativePath: string } {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const isCoreFile = CORE_FILE_NAMES.includes(normalized as typeof CORE_FILE_NAMES[number]);
  const isMemoryFile = /^memory\/[^/]+\.(md|txt)$/i.test(normalized);
  if (!isCoreFile && !isMemoryFile) {
    throw new OrchestrationApiError(
      400,
      "unsupported_agent_file",
      "Only core identity files and top-level memory .md/.txt files are editable here.",
    );
  }

  const targetPath = path.resolve(root, normalized);
  if (!isPathContained(root, targetPath)) {
    throw new OrchestrationApiError(400, "unsafe_agent_file_path", "Refusing to edit a file outside this agent workspace.");
  }

  try {
    const existing = fs.lstatSync(targetPath);
    if (existing.isSymbolicLink()) {
      throw new OrchestrationApiError(400, "agent_file_symlink", "Refusing to edit symbolic links from the agent file editor.");
    }
  } catch (error) {
    if (error instanceof OrchestrationApiError) throw error;
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : null;
    if (code !== "ENOENT") {
      throw new OrchestrationApiError(500, "agent_file_stat_failed", `Could not inspect ${normalized}.`);
    }
  }

  return { path: targetPath, relativePath: normalized };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { agent, root } = resolveAgentWorkspace(id);
    if (!root) {
      return NextResponse.json({
        agentId: agent.id,
        workspaceRoot: null,
        files: [],
        error: "workspace_unresolved",
      });
    }

    return NextResponse.json({
      agentId: agent.id,
      workspaceRoot: root,
      files: readAgentFiles(root),
    });
  } catch (error) {
    return handleRouteError(error, "agents.files.get");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null) as { relativePath?: unknown; content?: unknown } | null;
    const relativePath = typeof body?.relativePath === "string" ? body.relativePath.trim() : "";
    const content = typeof body?.content === "string" ? body.content : null;

    if (!relativePath || content == null) {
      throw new OrchestrationApiError(400, "invalid_agent_file_patch", "relativePath and content are required.");
    }
    if (Buffer.byteLength(content, "utf8") > MAX_EDITABLE_FILE_BYTES) {
      throw new OrchestrationApiError(400, "agent_file_too_large", "Agent file content is too large for this editor.");
    }

    const { root } = resolveAgentWorkspace(id);
    if (!root) {
      throw new OrchestrationApiError(400, "workspace_unresolved", "Agent workspace could not be resolved.");
    }

    const target = resolveEditableFile(root, relativePath);
    fs.mkdirSync(path.dirname(target.path), { recursive: true });
    fs.writeFileSync(target.path, content.endsWith("\n") ? content : `${content}\n`, "utf8");

    return NextResponse.json({
      ok: true,
      relativePath: target.relativePath,
      file: readAgentFiles(root).find((file) => file.relativePath === target.relativePath) ?? null,
    });
  } catch (error) {
    return handleRouteError(error, "agents.files.patch");
  }
}
