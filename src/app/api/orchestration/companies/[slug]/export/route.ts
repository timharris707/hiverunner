import { NextRequest, NextResponse } from "next/server";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { handleRouteError, errorResponse } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/orchestration/companies/:slug/export?categories=agents,projects,...
 *
 * Exports company data as a structured JSON package.
 * If no categories query param, exports all supported categories.
 */

const SUPPORTED_CATEGORIES = [
  "company",
  "projects",
  "agents",
  "tasks",
  "sprints",
  "comments",
  "routines",
  "approvals",
] as const;

type Category = (typeof SUPPORTED_CATEGORIES)[number];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const db = getOrchestrationDb();

    // Resolve company (alias-aware)
    const resolved = resolveCompanyIdBySlug(slug, db);
    if (!resolved) {
      return errorResponse(404, "not_found", `Company "${slug}" not found`);
    }
    const companyId = resolved.id;

    const company = db
      .prepare(
          `SELECT id, slug, company_code, name, description, status,
                  workspace_root, workspace_source, workspace_slug, runtime_slug,
                  theme_name, theme_prompt_template, theme_keywords_json, theme_sample_url,
                  created_at, updated_at
         FROM companies WHERE id = ?`
      )
      .get(companyId) as Record<string, unknown> | undefined;

    if (!company) {
      return errorResponse(404, "not_found", `Company "${slug}" not found`);
    }

    // Parse requested categories
    const catParam = req.nextUrl.searchParams.get("categories");
    const requested: Set<Category> = catParam
      ? new Set(
          catParam
            .split(",")
            .map((c) => c.trim().toLowerCase())
            .filter((c): c is Category =>
              SUPPORTED_CATEGORIES.includes(c as Category)
            )
        )
      : new Set(SUPPORTED_CATEGORIES);

    const pkg: Record<string, unknown> = {
      _meta: {
        format: "hiverunner-company-package",
        version: 1,
        exportedAt: new Date().toISOString(),
        sourceCompanySlug: slug,
        sourceCompanyName: company.name,
        categories: Array.from(requested),
      },
    };

    if (requested.has("company")) {
          pkg.company = {
            id: company.id,
            name: company.name,
            slug: company.slug,
            workspaceSlug: company.workspace_slug,
            runtimeSlug: company.runtime_slug,
            companyCode: company.company_code,
        description: company.description,
        status: company.status,
        workspaceSource: company.workspace_source,
        theme: {
          name: company.theme_name,
          promptTemplate: company.theme_prompt_template,
          keywords: safeJsonParse(company.theme_keywords_json as string, []),
          sampleUrl: company.theme_sample_url,
        },
        settings: {},
      };
    }

    if (requested.has("projects")) {
      const rows = db
        .prepare(
          `SELECT id, slug, name, description, color, status,
                  settings_json, created_at
           FROM projects
           WHERE company_id = ? AND (archived_at IS NULL OR archived_at = '')
           ORDER BY created_at`
        )
        .all(companyId) as Record<string, unknown>[];
      pkg.projects = rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        color: r.color,
        status: r.status,
        settings: safeJsonParse(r.settings_json as string, {}),
        createdAt: r.created_at,
      }));
    }

    if (requested.has("agents")) {
      const rows = db
        .prepare(
          `SELECT id, slug, name, emoji, role, personality,
                  status, model, adapter_type, runtime_slug, openclaw_agent_id,
                  adapter_config_json, runtime_config_json,
                  permissions_json, capabilities, instructions_mode,
                  reporting_to, skills_json, project_id, created_at
           FROM agents
           WHERE company_id = ? AND (archived_at IS NULL OR archived_at = '')
           ORDER BY created_at`
        )
        .all(companyId) as Record<string, unknown>[];
      pkg.agents = rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        emoji: r.emoji,
        role: r.role,
        personality: r.personality,
        status: r.status,
        model: r.model,
        adapterType: r.adapter_type,
        runtimeSlug: r.runtime_slug,
        openclawAgentId: r.openclaw_agent_id,
        adapterConfig: safeJsonParse(r.adapter_config_json as string, {}),
        runtimeConfig: safeJsonParse(r.runtime_config_json as string, {}),
        permissions: safeJsonParse(r.permissions_json as string, {}),
        capabilities: r.capabilities,
        instructionsMode: r.instructions_mode,
        reportingTo: r.reporting_to,
        skills: safeJsonParse(r.skills_json as string, []),
        projectId: r.project_id,
        createdAt: r.created_at,
      }));
    }

    if (requested.has("tasks")) {
      // Get all project IDs for this company
      const projectIds = (
        db
          .prepare("SELECT id FROM projects WHERE company_id = ?")
          .all(companyId) as { id: string }[]
      ).map((r) => r.id);

      if (projectIds.length > 0) {
        const placeholders = projectIds.map(() => "?").join(",");
        const rows = db
          .prepare(
            `SELECT id, project_id, sprint_id, parent_task_id,
                    task_number, task_key, title, description,
                    priority, type, status, column_order,
                    assignee_agent_id, labels_json, depends_on_json,
                    execution_engine, execution_mode, created_at
             FROM tasks
             WHERE project_id IN (${placeholders})
               AND (archived_at IS NULL OR archived_at = '')
             ORDER BY created_at`
          )
          .all(...projectIds) as Record<string, unknown>[];
        pkg.tasks = rows.map((r) => ({
          id: r.id,
          projectId: r.project_id,
          sprintId: r.sprint_id,
          parentTaskId: r.parent_task_id,
          taskNumber: r.task_number,
          taskKey: r.task_key,
          title: r.title,
          description: r.description,
          priority: r.priority,
          type: r.type,
          status: r.status,
          columnOrder: r.column_order,
          assigneeAgentId: r.assignee_agent_id,
          labels: safeJsonParse(r.labels_json as string, []),
          dependsOn: safeJsonParse(r.depends_on_json as string, []),
          executionEngine: r.execution_engine,
          executionMode: r.execution_mode,
          createdAt: r.created_at,
        }));
      } else {
        pkg.tasks = [];
      }
    }

    if (requested.has("sprints")) {
      const projectIds = (
        db
          .prepare("SELECT id FROM projects WHERE company_id = ?")
          .all(companyId) as { id: string }[]
      ).map((r) => r.id);

      if (projectIds.length > 0) {
        const placeholders = projectIds.map(() => "?").join(",");
        const rows = db
          .prepare(
            `SELECT id, project_id, parent_id, name, goal, goal_kind, owner,
                    status, start_date, end_date, completed_at, created_at
             FROM sprints
             WHERE project_id IN (${placeholders})
             ORDER BY created_at`
          )
          .all(...projectIds) as Record<string, unknown>[];
        pkg.sprints = rows.map((r) => ({
          id: r.id,
          projectId: r.project_id,
          parentId: r.parent_id,
          name: r.name,
          goal: r.goal,
          goalKind: r.goal_kind,
          owner: r.owner,
          status: r.status,
          startDate: r.start_date,
          endDate: r.end_date,
          completedAt: r.completed_at,
          createdAt: r.created_at,
        }));
      } else {
        pkg.sprints = [];
      }
    }

    if (requested.has("comments")) {
      const taskIds = (
        db
          .prepare(
            `SELECT t.id FROM tasks t
             JOIN projects p ON t.project_id = p.id
             WHERE p.company_id = ?
               AND (t.archived_at IS NULL OR t.archived_at = '')`
          )
          .all(companyId) as { id: string }[]
      ).map((r) => r.id);

      if (taskIds.length > 0) {
        const placeholders = taskIds.map(() => "?").join(",");
        const rows = db
          .prepare(
            `SELECT id, task_id, author_agent_id, author_user_id,
                    body, type, source, created_at
             FROM comments
             WHERE task_id IN (${placeholders})
             ORDER BY created_at`
          )
          .all(...taskIds) as Record<string, unknown>[];
        pkg.comments = rows.map((r) => ({
          id: r.id,
          taskId: r.task_id,
          authorAgentId: r.author_agent_id,
          authorUserId: r.author_user_id,
          body: r.body,
          type: r.type,
          source: r.source,
          createdAt: r.created_at,
        }));
      } else {
        pkg.comments = [];
      }
    }

    if (requested.has("routines")) {
      const rows = db
        .prepare(
          `SELECT id, project_id, assignee_agent_id, title, description,
                  priority, status, concurrency_policy, catch_up_policy,
                  created_at
           FROM routines
           WHERE company_id = ?
           ORDER BY created_at`
        )
        .all(companyId) as Record<string, unknown>[];
      pkg.routines = rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        assigneeAgentId: r.assignee_agent_id,
        title: r.title,
        description: r.description,
        priority: r.priority,
        status: r.status,
        concurrencyPolicy: r.concurrency_policy,
        catchUpPolicy: r.catch_up_policy,
        createdAt: r.created_at,
      }));
    }

    if (requested.has("approvals")) {
      const rows = db
        .prepare(
          `SELECT id, type, status, requested_by_agent_id, approver_agent_id,
                  approval_route_reason,
                  payload_json, decision_note, decided_by_user_id,
                  decided_at, linked_task_id, created_at
           FROM approvals
           WHERE company_id = ?
           ORDER BY created_at`
        )
        .all(companyId) as Record<string, unknown>[];
      pkg.approvals = rows.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        requestedByAgentId: r.requested_by_agent_id,
        approverAgentId: r.approver_agent_id,
        approvalRouteReason: r.approval_route_reason,
        payload: safeJsonParse(r.payload_json as string, {}),
        decisionNote: r.decision_note,
        decidedByUserId: r.decided_by_user_id,
        decidedAt: r.decided_at,
        linkedTaskId: r.linked_task_id,
        createdAt: r.created_at,
      }));
    }

    // Add counts summary
    pkg._counts = Object.fromEntries(
      Object.entries(pkg)
        .filter(([k]) => !k.startsWith("_") && k !== "company")
        .map(([k, v]) => [k, Array.isArray(v) ? v.length : 1])
    );
    if (requested.has("company")) {
      (pkg._counts as Record<string, number>).company = 1;
    }

    return NextResponse.json(pkg);
  } catch (error) {
    return handleRouteError(error, "company:export");
  }
}

function safeJsonParse(raw: string | null | undefined, fallback: unknown): unknown {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
