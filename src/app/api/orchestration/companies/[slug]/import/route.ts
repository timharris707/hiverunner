import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { handleRouteError, errorResponse } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import {
  normalizeAgentRuntimeSlug,
  normalizeCompanyRuntimeSlug,
} from "@/lib/orchestration/runtime-identifiers";

export const dynamic = "force-dynamic";

/**
 * POST /api/orchestration/companies/:slug/import
 *
 * Imports a previously exported company package into the target company.
 * Body: { package: <exported JSON>, strategy: "skip" | "overwrite" }
 *
 * - "skip": skips entities whose ID already exists
 * - "overwrite": upserts entities, replacing existing rows
 */

type ImportStrategy = "skip" | "overwrite";

interface ImportResult {
  category: string;
  imported: number;
  skipped: number;
  errors: string[];
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const db = getOrchestrationDb();

    // Resolve target company (alias-aware)
    const resolved = resolveCompanyIdBySlug(slug, db);
    if (!resolved) {
      return errorResponse(404, "not_found", `Company "${slug}" not found`);
    }
    const company = { id: resolved.id, slug: resolved.slug, company_code: resolved.company_code ?? "" };

    const body = await req.json();
    const pkg = body.package;
    const strategy: ImportStrategy = body.strategy === "overwrite" ? "overwrite" : "skip";

    if (!pkg || typeof pkg !== "object") {
      return errorResponse(400, "invalid_package", "Request body must include a valid package object");
    }

    if (
      pkg._meta?.format !== "hiverunner-company-package"
      && pkg._meta?.format !== "mission-control-company-package"
    ) {
      return errorResponse(
        400,
        "invalid_format",
        "Package does not appear to be a HiveRunner export (missing or invalid _meta.format)"
      );
    }

    const results: ImportResult[] = [];
    const now = new Date().toISOString();
    const projectIdMap = new Map<string, string>();
    const agentIdMap = new Map<string, string>();
    const sprintIdMap = new Map<string, string>();
    const taskIdMap = new Map<string, string>();

    const remapProjectId = (id: unknown) => {
      if (typeof id !== "string" || !id.trim()) return null;
      return projectIdMap.get(id) ?? id;
    };

    const remapAgentId = (id: unknown) => {
      if (typeof id !== "string" || !id.trim()) return null;
      return agentIdMap.get(id) ?? id;
    };

    const remapSprintId = (id: unknown) => {
      if (typeof id !== "string" || !id.trim()) return null;
      return sprintIdMap.get(id) ?? id;
    };

    const normalizeGoalKind = (value: unknown) => (
      value === "company" || value === "sprint" ? value : null
    );

    const remapTaskId = (id: unknown) => {
      if (typeof id !== "string" || !id.trim()) return null;
      return taskIdMap.get(id) ?? id;
    };

    const normalizeExecutionEngine = (value: unknown) =>
      value === "hiverunner" || value === "symphony" || value === "manual"
        ? value
        : null;

    // We need to track ID remapping for cross-references.
    // When importing, original IDs from the source are preserved if possible.
    // If a row already exists under a different live ID (for example matched by slug),
    // we remap the source package ID to that live ID so downstream foreign keys stay valid.

    db.transaction(() => {
      // ── Company settings ──
      if (pkg.company) {
        const result: ImportResult = { category: "company", imported: 0, skipped: 0, errors: [] };
        try {
          if (strategy === "overwrite") {
            const updates: string[] = [];
            const vals: unknown[] = [];
            const packageCompanyId =
              typeof pkg.company.id === "string" && pkg.company.id.trim()
                ? pkg.company.id.trim()
                : null;

            if (pkg.company.description != null) {
              updates.push("description = ?");
              vals.push(pkg.company.description);
            }
            if (pkg.company.theme) {
              if (pkg.company.theme.name != null) {
                updates.push("theme_name = ?");
                vals.push(pkg.company.theme.name);
              }
              if (pkg.company.theme.promptTemplate != null) {
                updates.push("theme_prompt_template = ?");
                vals.push(pkg.company.theme.promptTemplate);
              }
              if (pkg.company.theme.keywords != null) {
                updates.push("theme_keywords_json = ?");
                vals.push(JSON.stringify(pkg.company.theme.keywords));
              }
            }
              if (pkg.company.runtimeSlug != null && packageCompanyId === company.id) {
                updates.push("runtime_slug = COALESCE(runtime_slug, ?)");
                vals.push(normalizeCompanyRuntimeSlug(String(pkg.company.runtimeSlug)));
              }

              if (updates.length > 0) {
              updates.push("updated_at = ?");
              vals.push(now);
              vals.push(company.id);
              db.prepare(`UPDATE companies SET ${updates.join(", ")} WHERE id = ?`).run(
                ...vals
              );
              result.imported = 1;
            } else {
              result.skipped = 1;
            }
          } else {
            result.skipped = 1; // skip strategy: don't overwrite company metadata
          }
        } catch (e) {
          result.errors.push(String(e instanceof Error ? e.message : e));
        }
        results.push(result);
      }

      // ── Projects ──
      if (Array.isArray(pkg.projects)) {
        const result: ImportResult = { category: "projects", imported: 0, skipped: 0, errors: [] };
        for (const p of pkg.projects) {
          try {
            const existing = db
              .prepare("SELECT id FROM projects WHERE id = ? OR (company_id = ? AND slug = ?)")
              .get(p.id, company.id, p.slug) as { id: string } | undefined;

            if (existing) {
              if (p.id) projectIdMap.set(String(p.id), existing.id);
              if (strategy === "overwrite") {
                db.prepare(
                  `UPDATE projects SET name = ?, description = ?, color = ?, status = ?,
                   settings_json = ?, updated_at = ? WHERE id = ?`
                ).run(
                  p.name, p.description ?? "", p.color ?? "#0ea5e9",
                  p.status ?? "active", JSON.stringify(p.settings ?? {}),
                  now, existing.id
                );
                result.imported++;
              } else {
                result.skipped++;
              }
            } else {
              const projectId = p.id || randomUUID();
              db.prepare(
                `INSERT INTO projects (id, company_id, slug, name, description, color, status, settings_json, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                projectId, company.id, p.slug, p.name,
                p.description ?? "", p.color ?? "#0ea5e9",
                p.status ?? "active", JSON.stringify(p.settings ?? {}),
                p.createdAt ?? now, now
              );
              if (p.id) projectIdMap.set(String(p.id), projectId);
              result.imported++;
            }
          } catch (e) {
            result.errors.push(`project "${p.name}": ${e instanceof Error ? e.message : e}`);
          }
        }
        results.push(result);
      }

      // ── Agents ──
      if (Array.isArray(pkg.agents)) {
        const result: ImportResult = { category: "agents", imported: 0, skipped: 0, errors: [] };
        for (const a of pkg.agents) {
          try {
            const existing = db
              .prepare("SELECT id FROM agents WHERE id = ? OR (company_id = ? AND slug = ?)")
              .get(a.id, company.id, a.slug) as { id: string } | undefined;

            if (existing) {
              if (a.id) agentIdMap.set(String(a.id), existing.id);
              if (strategy === "overwrite") {
                db.prepare(
                  `UPDATE agents SET name = ?, emoji = ?, role = ?, personality = ?,
                   model = ?, runtime_slug = COALESCE(?, runtime_slug),
                   openclaw_agent_id = COALESCE(?, openclaw_agent_id),
                   adapter_type = ?, adapter_config_json = ?,
                   runtime_config_json = ?, permissions_json = ?,
                   capabilities = ?, instructions_mode = ?,
                   skills_json = ?, updated_at = ? WHERE id = ?`
                ).run(
                  a.name, a.emoji ?? "", a.role, a.personality ?? "",
                  a.model ?? null,
                  a.runtimeSlug ? normalizeAgentRuntimeSlug(String(a.runtimeSlug)) : null,
                  a.openclawAgentId ? String(a.openclawAgentId) : null,
                  a.adapterType ?? null,
                  JSON.stringify(a.adapterConfig ?? {}),
                  JSON.stringify(a.runtimeConfig ?? {}),
                  JSON.stringify(a.permissions ?? {}),
                  a.capabilities ?? null, a.instructionsMode ?? null,
                  JSON.stringify(a.skills ?? []), now, existing.id
                );
                result.imported++;
              } else {
                result.skipped++;
              }
            } else {
              const agentId = a.id || randomUUID();
              db.prepare(
                `INSERT INTO agents (id, company_id, project_id, slug, runtime_slug, name, emoji, role, personality,
                 status, model, openclaw_agent_id, adapter_type, adapter_config_json, runtime_config_json,
                 permissions_json, capabilities, instructions_mode, skills_json,
                 created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                agentId, company.id, remapProjectId(a.projectId),
                a.slug ?? a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
                a.runtimeSlug
                  ? normalizeAgentRuntimeSlug(String(a.runtimeSlug))
                  : normalizeAgentRuntimeSlug(String(a.slug ?? a.name ?? "agent")),
                a.name, a.emoji ?? "", a.role, a.personality ?? "",
                "idle", a.model ?? null, a.openclawAgentId ? String(a.openclawAgentId) : null, a.adapterType ?? null,
                JSON.stringify(a.adapterConfig ?? {}),
                JSON.stringify(a.runtimeConfig ?? {}),
                JSON.stringify(a.permissions ?? {}),
                a.capabilities ?? null, a.instructionsMode ?? null,
                JSON.stringify(a.skills ?? []),
                a.createdAt ?? now, now
              );
              if (a.id) agentIdMap.set(String(a.id), agentId);
              result.imported++;
            }
          } catch (e) {
            result.errors.push(`agent "${a.name}": ${e instanceof Error ? e.message : e}`);
          }
        }
        results.push(result);
      }

      // ── Sprints ──
      if (Array.isArray(pkg.sprints)) {
        const result: ImportResult = { category: "sprints", imported: 0, skipped: 0, errors: [] };
        for (const s of pkg.sprints) {
          try {
            const existing = db
              .prepare("SELECT id FROM sprints WHERE id = ?")
              .get(s.id) as { id: string } | undefined;

            if (existing) {
              if (s.id) sprintIdMap.set(String(s.id), existing.id);
              if (strategy === "overwrite") {
                db.prepare(
                  `UPDATE sprints SET name = ?, goal = ?, goal_kind = ?, owner = ?,
                   status = ?, start_date = ?, end_date = ?,
                   completed_at = ?, updated_at = ? WHERE id = ?`
                ).run(
                  s.name, s.goal ?? "", normalizeGoalKind(s.goalKind), s.owner ?? null,
                  s.status ?? "planning", s.startDate, s.endDate ?? null,
                  s.completedAt ?? null, now, existing.id
                );
                result.imported++;
              } else {
                result.skipped++;
              }
            } else {
              const sprintId = s.id || randomUUID();
              db.prepare(
                `INSERT INTO sprints (id, project_id, parent_id, name, goal, goal_kind, owner,
                 status, start_date, end_date, completed_at, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                sprintId, remapProjectId(s.projectId), remapSprintId(s.parentId),
                s.name, s.goal ?? "", normalizeGoalKind(s.goalKind), s.owner ?? null,
                s.status ?? "planning", s.startDate,
                s.endDate ?? null, s.completedAt ?? null,
                s.createdAt ?? now, now
              );
              if (s.id) sprintIdMap.set(String(s.id), sprintId);
              result.imported++;
            }
          } catch (e) {
            result.errors.push(`sprint "${s.name}": ${e instanceof Error ? e.message : e}`);
          }
        }
        results.push(result);
      }

      // ── Tasks ──
      if (Array.isArray(pkg.tasks)) {
        const result: ImportResult = { category: "tasks", imported: 0, skipped: 0, errors: [] };
        for (const t of pkg.tasks) {
          try {
            const existing = db
              .prepare("SELECT id FROM tasks WHERE id = ? OR (project_id = ? AND task_key = ?)")
              .get(t.id, remapProjectId(t.projectId), t.taskKey ?? null) as { id: string } | undefined;

            const remappedAssigneeId = remapAgentId(t.assigneeAgentId);
            const remappedDependsOn = Array.isArray(t.dependsOn)
              ? t.dependsOn.map((dep: unknown) => remapTaskId(dep)).filter(Boolean)
              : [];
            const executionEngine = normalizeExecutionEngine(t.executionEngine);

            if (existing) {
              if (t.id) taskIdMap.set(String(t.id), existing.id);
              if (strategy === "overwrite") {
                db.prepare(
                  `UPDATE tasks SET project_id = ?, sprint_id = ?, parent_task_id = ?,
                   task_number = ?, task_key = ?, title = ?, description = ?, priority = ?, type = ?,
                   status = ?, column_order = ?, assignee_agent_id = ?, created_by = ?,
                   labels_json = ?, depends_on_json = ?, execution_engine = ?, execution_mode = ?,
                   updated_at = ? WHERE id = ?`
                ).run(
                  remapProjectId(t.projectId), remapSprintId(t.sprintId), remapTaskId(t.parentTaskId),
                  t.taskNumber ?? null, t.taskKey ?? null, t.title, t.description ?? "", t.priority ?? "medium",
                  t.type ?? "feature", t.status ?? "backlog",
                  t.columnOrder ?? 0, remappedAssigneeId,
                  t.createdBy ?? "import",
                  JSON.stringify(t.labels ?? []),
                  JSON.stringify(remappedDependsOn),
                  executionEngine,
                  t.executionMode ?? "manual", now, existing.id
                );
                result.imported++;
              } else {
                result.skipped++;
              }
            } else {
              const taskId = t.id || randomUUID();
              const createdAt = t.createdAt ?? now;
              db.prepare(
                `INSERT INTO tasks (id, project_id, sprint_id, parent_task_id,
                 task_number, task_key, title, description, priority, type,
                 status, column_order, assignee_agent_id, created_by,
                 labels_json, depends_on_json, execution_engine, execution_mode,
                 created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                taskId, remapProjectId(t.projectId), remapSprintId(t.sprintId),
                remapTaskId(t.parentTaskId), t.taskNumber ?? null,
                t.taskKey ?? null, t.title, t.description ?? "",
                t.priority ?? "medium", t.type ?? "feature",
                t.status ?? "backlog", t.columnOrder ?? 0,
                remappedAssigneeId,
                t.createdBy ?? "import",
                JSON.stringify(t.labels ?? []),
                JSON.stringify(remappedDependsOn),
                executionEngine,
                t.executionMode ?? "manual",
                createdAt, now
              );
              db.prepare(
                `INSERT OR IGNORE INTO task_events
                  (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                randomUUID(),
                remapProjectId(t.projectId),
                taskId,
                remappedAssigneeId,
                t.createdBy ?? "import",
                "task.created",
                null,
                t.status ?? "backlog",
                JSON.stringify({ imported: true, labels: t.labels ?? [] }),
                createdAt,
              );
              if (t.id) taskIdMap.set(String(t.id), taskId);
              result.imported++;
            }
          } catch (e) {
            result.errors.push(`task "${t.title}": ${e instanceof Error ? e.message : e}`);
          }
        }
        results.push(result);
      }

      // ── Comments ──
      if (Array.isArray(pkg.comments)) {
        const result: ImportResult = { category: "comments", imported: 0, skipped: 0, errors: [] };
        for (const c of pkg.comments) {
          try {
            const existing = db
              .prepare("SELECT id FROM comments WHERE id = ?")
              .get(c.id) as { id: string } | undefined;

            if (existing) {
              if (strategy === "overwrite") {
                db.prepare(
                  `UPDATE comments SET task_id = ?, author_agent_id = ?, author_user_id = ?,
                   body = ?, type = ?, source = ?, updated_at = ? WHERE id = ?`
                ).run(
                  remapTaskId(c.taskId), remapAgentId(c.authorAgentId), c.authorUserId ?? null,
                  c.body, c.type ?? "comment", c.source ?? "mission_control", now, existing.id
                );
                result.imported++;
              } else {
                result.skipped++;
              }
            } else {
              db.prepare(
                `INSERT INTO comments (id, task_id, author_agent_id, author_user_id,
                 body, type, source, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                c.id || randomUUID(), remapTaskId(c.taskId),
                remapAgentId(c.authorAgentId), c.authorUserId ?? null,
                c.body, c.type ?? "comment", c.source ?? "mission_control",
                c.createdAt ?? now, now
              );
              result.imported++;
            }
          } catch (e) {
            result.errors.push(`comment: ${e instanceof Error ? e.message : e}`);
          }
        }
        results.push(result);
      }

      // ── Routines ──
      if (Array.isArray(pkg.routines)) {
        const result: ImportResult = { category: "routines", imported: 0, skipped: 0, errors: [] };
        for (const r of pkg.routines) {
          try {
            const existing = db
              .prepare("SELECT id FROM routines WHERE id = ?")
              .get(r.id) as { id: string } | undefined;

            if (existing) {
              if (strategy === "overwrite") {
                db.prepare(
                  `UPDATE routines SET title = ?, description = ?, priority = ?,
                   status = ?, concurrency_policy = ?, catch_up_policy = ?,
                   updated_at = ? WHERE id = ?`
                ).run(
                  r.title, r.description ?? null, r.priority ?? "medium",
                  r.status ?? "active", r.concurrencyPolicy ?? "skip_if_active",
                  r.catchUpPolicy ?? "skip_missed", now, existing.id
                );
                result.imported++;
              } else {
                result.skipped++;
              }
            } else {
              db.prepare(
                `INSERT INTO routines (id, company_id, project_id, assignee_agent_id,
                 title, description, priority, status,
                 concurrency_policy, catch_up_policy, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                r.id || randomUUID(), company.id,
                r.projectId ?? null, r.assigneeAgentId ?? null,
                r.title, r.description ?? null, r.priority ?? "medium",
                r.status ?? "active",
                r.concurrencyPolicy ?? "skip_if_active",
                r.catchUpPolicy ?? "skip_missed",
                r.createdAt ?? now, now
              );
              result.imported++;
            }
          } catch (e) {
            result.errors.push(`routine "${r.title}": ${e instanceof Error ? e.message : e}`);
          }
        }
        results.push(result);
      }

      // ── Approvals ──
      if (Array.isArray(pkg.approvals)) {
        const result: ImportResult = { category: "approvals", imported: 0, skipped: 0, errors: [] };
        for (const a of pkg.approvals) {
          try {
            const existing = db
              .prepare("SELECT id FROM approvals WHERE id = ?")
              .get(a.id) as { id: string } | undefined;

            if (existing) {
              if (strategy === "overwrite") {
                db.prepare(
                  `UPDATE approvals SET status = ?, payload_json = ?,
                   decision_note = ?, decided_at = ?, updated_at = ? WHERE id = ?`
                ).run(
                  a.status, JSON.stringify(a.payload ?? {}),
                  a.decisionNote ?? null, a.decidedAt ?? null,
                  now, existing.id
                );
                result.imported++;
              } else {
                result.skipped++;
              }
            } else {
              db.prepare(
                `INSERT INTO approvals (id, company_id, type, status,
                 requested_by_agent_id, approver_agent_id, approval_route_reason,
                 payload_json, decision_note,
                 decided_by_user_id, decided_at, linked_task_id,
                 created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                a.id || randomUUID(), company.id, a.type, a.status,
                a.requestedByAgentId ?? null,
                a.approverAgentId ?? null,
                a.approvalRouteReason ?? null,
                JSON.stringify(a.payload ?? {}),
                a.decisionNote ?? null, a.decidedByUserId ?? null,
                a.decidedAt ?? null, a.linkedTaskId ?? null,
                a.createdAt ?? now, now
              );
              result.imported++;
            }
          } catch (e) {
            result.errors.push(`approval: ${e instanceof Error ? e.message : e}`);
          }
        }
        results.push(result);
      }
    })();

    const totalImported = results.reduce((s, r) => s + r.imported, 0);
    const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
    const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);

    return NextResponse.json({
      success: totalErrors === 0,
      strategy,
      targetCompany: slug,
      summary: { imported: totalImported, skipped: totalSkipped, errors: totalErrors },
      results,
    });
  } catch (error) {
    return handleRouteError(error, "company:import");
  }
}
