import path from "path";
import type Database from "better-sqlite3";

import { generateAgentDossier, writeAgentDossierFiles } from "@/lib/orchestration/agent-dossier";
import { resolveCompanyAgentWorkspacePath } from "@/lib/workspaces/company-paths";

type AgentCoreFileRow = {
  id: string;
  name: string;
  slug: string | null;
  runtime_slug: string | null;
  role: string | null;
  personality: string | null;
  emoji: string | null;
  model: string | null;
  runtime_config_json: string | null;
  permissions_json: string | null;
  skills_json: string | null;
  reporting_to_name: string | null;
  avatar_style_id: string | null;
  avatar_gender: string | null;
  avatar_age: number | null;
  avatar_hair_color: string | null;
  avatar_hair_length: string | null;
  avatar_eye_color: string | null;
  avatar_vibe: string | null;
  voice_id: string | null;
  company_name: string;
  company_workspace_root: string | null;
  project_name: string | null;
  project_slug: string | null;
  runtime_workspace_root: string | null;
};

function parseSkills(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item).trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function parseRuntimeConfig(raw: string | null): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function listActiveCompanySkillNames(db: Database.Database, agentId: string): string[] {
  const rows = db
    .prepare(
      `SELECT cs.name
       FROM agent_skill_assignments asa
       JOIN company_skills cs ON cs.id = asa.skill_id
       WHERE asa.agent_id = ?
         AND asa.status = 'active'
         AND asa.archived_at IS NULL
         AND cs.status = 'active'
         AND cs.archived_at IS NULL
         AND (cs.review_required = 0 OR cs.review_state = 'approved')
       ORDER BY cs.name ASC`,
    )
    .all(agentId) as Array<{ name: string }>;

  return rows.map((row) => row.name.trim()).filter(Boolean);
}

function runtimeString(config: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function resolveAgentCoreRoot(row: AgentCoreFileRow): string | null {
  const runtimeRoot = row.runtime_workspace_root?.trim()
    ? path.resolve(row.runtime_workspace_root)
    : null;
  const companyRoot = row.company_workspace_root?.trim()
    ? path.resolve(row.company_workspace_root)
    : null;
  const runtimeLooksLikeSharedOpenClawRoot = runtimeRoot && path.basename(runtimeRoot) === "workspace";
  if (runtimeRoot && (!companyRoot || runtimeRoot !== companyRoot) && !runtimeLooksLikeSharedOpenClawRoot) {
    return runtimeRoot;
  }

  const agentSlug = row.runtime_slug?.trim() || row.slug?.trim() || row.name || row.id;
  const fallbackRoot = resolveCompanyAgentWorkspacePath(row.company_workspace_root, agentSlug);
  return fallbackRoot ? path.resolve(fallbackRoot) : null;
}

export function syncAgentCoreFiles(db: Database.Database, agentIdOrSlug: string): { synced: boolean; root: string | null } {
  const row = db
    .prepare(
      `SELECT
         a.id,
         a.name,
         a.slug,
         a.runtime_slug,
         a.role,
         a.personality,
         a.emoji,
        a.model,
        a.runtime_config_json,
        a.permissions_json,
        a.skills_json,
         mgr.name AS reporting_to_name,
         a.avatar_style_id,
         a.avatar_gender,
         a.avatar_age,
         a.avatar_hair_color,
         a.avatar_hair_length,
         a.avatar_eye_color,
         a.avatar_vibe,
         a.voice_id,
         c.name AS company_name,
         c.workspace_root AS company_workspace_root,
         p.name AS project_name,
         p.slug AS project_slug,
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
       LEFT JOIN projects p ON p.id = a.project_id
       LEFT JOIN agents mgr ON mgr.id = a.reporting_to AND mgr.company_id = a.company_id
       WHERE a.archived_at IS NULL
         AND (a.id = @agentId OR a.slug = @agentId OR lower(a.name) = lower(@agentId) OR a.openclaw_agent_id = @agentId)
       LIMIT 1`,
    )
    .get({ agentId: agentIdOrSlug }) as AgentCoreFileRow | undefined;

  if (!row) return { synced: false, root: null };

  const root = resolveAgentCoreRoot(row);
  if (!root) return { synced: false, root: null };

  const runtimeConfig = parseRuntimeConfig(row.runtime_config_json);
  const permissions = parseRuntimeConfig(row.permissions_json);
  const capabilities = Array.from(new Set([
    ...parseSkills(row.skills_json),
    ...listActiveCompanySkillNames(db, row.id),
  ]));

  const dossier = generateAgentDossier({
    name: row.name,
    role: row.role || "Agent",
    companyName: row.company_name,
    projectName: row.project_name || "All company projects",
    projectSlug: row.project_slug || "all-company-projects",
    reportsTo: row.reporting_to_name || "Unassigned",
    emoji: row.emoji,
    personality: row.personality,
    capabilities,
    model: row.model,
    reasoningEffort: runtimeString(runtimeConfig, ["reasoningEffort", "modelReasoningEffort", "thinkingLevel"]) || "high",
    speedPreference: runtimeString(runtimeConfig, ["speedPreference", "speed", "thinkingSpeed"]) || "fast_1_5x",
    authority: {
      canCreateTasks: permissions.canCreateTasks === true,
      canAssignTasks: permissions.canAssignTasks === true,
      approvalScope: runtimeString(permissions, ["approvalScope"]) ?? undefined,
      canRelease: permissions.canRelease === true,
      canCommitPush: permissions.canCommitPush === true,
      handoff: runtimeString(permissions, ["handoff"]) ?? undefined,
    },
    avatarStyleId: row.avatar_style_id,
    avatarGender: row.avatar_gender,
    avatarAge: row.avatar_age,
    avatarHairColor: row.avatar_hair_color,
    avatarHairLength: row.avatar_hair_length,
    avatarEyeColor: row.avatar_eye_color,
    avatarVibe: row.avatar_vibe,
    voiceId: row.voice_id,
  });

  writeAgentDossierFiles({ agentWorkspacePath: root, dossier });
  return { synced: true, root };
}
