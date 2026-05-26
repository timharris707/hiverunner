import { after, NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { createTaskSchema, listTasksQuerySchema } from "@/lib/orchestration/contracts";
import { createTask, listTasks } from "@/lib/orchestration/service";
import { triggerTaskExecution } from "@/lib/orchestration/execution";
import { OrchestrationApiError } from "@/lib/orchestration/api";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { executeHeartbeatRun } from "@/lib/orchestration/engine/engine";
import { canAutonomouslyExecuteCompany } from "@/lib/orchestration/service/dev-execution-test-mode";
import { resolveRequestCompanyOwnerUserId } from "@/lib/orchestration/request-auth";

export const dynamic = "force-dynamic";

function resolveTaskCompanyId(taskId: string): string | null {
  const db = getOrchestrationDb();
  const row = db
    .prepare(
      `SELECT COALESCE(t.company_id, p.company_id) AS company_id
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.id = ?
       LIMIT 1`
    )
    .get(taskId) as { company_id: string | null } | undefined;
  return row?.company_id ?? null;
}

function triggerImmediateRunIfAllowed(taskId: string, runId: string | undefined): void {
  if (!runId) return;
  const companyId = resolveTaskCompanyId(taskId);
  if (!companyId || !canAutonomouslyExecuteCompany(companyId)) return;
  after(async () => {
    try {
      await executeHeartbeatRun(runId);
    } catch (error) {
      console.warn("[tasks:post] immediate heartbeat execution failed:", error);
    }
  });
}

function resolveDefaultTaskCreator(input: { projectId?: string; company?: string }): string | undefined {
  const db = getOrchestrationDb();
  if (!input.projectId && input.company) {
    const row = db.prepare(
      `SELECT owner_user_id
       FROM companies
       WHERE (id = ? OR slug = ? OR company_code = ?)
         AND archived_at IS NULL
       LIMIT 1`
    ).get(input.company, input.company, input.company.toUpperCase()) as { owner_user_id: string | null } | undefined;
    return row?.owner_user_id ?? undefined;
  }
  if (!input.projectId) return undefined;
  const row = db.prepare(
    `SELECT c.owner_user_id
     FROM projects p
     INNER JOIN companies c ON c.id = p.company_id
     WHERE (p.id = ? OR p.slug = ?)
       AND p.archived_at IS NULL
       AND c.archived_at IS NULL
     LIMIT 1`
  ).get(input.projectId, input.projectId) as { owner_user_id: string | null } | undefined;
  return row?.owner_user_id ?? undefined;
}

export async function GET(req: NextRequest) {
  try {
    const includeNonProductionRaw = req.nextUrl.searchParams.get("includeNonProduction");
    const query = listTasksQuerySchema.parse({
      company: req.nextUrl.searchParams.get("company") ?? undefined,
      projectId: req.nextUrl.searchParams.get("projectId") ?? undefined,
      assignee: req.nextUrl.searchParams.get("assignee") ?? undefined,
      status: req.nextUrl.searchParams.get("status") ?? undefined,
      priority: req.nextUrl.searchParams.get("priority") ?? undefined,
      type: req.nextUrl.searchParams.get("type") ?? undefined,
      search: req.nextUrl.searchParams.get("search") ?? undefined,
      sort: req.nextUrl.searchParams.get("sort") ?? undefined,
      sourceReviewId: req.nextUrl.searchParams.get("sourceReviewId") ?? undefined,
      sourceTakeawayId: req.nextUrl.searchParams.get("sourceTakeawayId") ?? undefined,
      includeArchived: req.nextUrl.searchParams.get("includeArchived") ?? undefined,
      includeNonProduction: includeNonProductionRaw ?? undefined,
      limit: req.nextUrl.searchParams.get("limit") ?? undefined,
    });

    const includeNonProduction =
      includeNonProductionRaw === null && query.projectId ? true : query.includeNonProduction;

    const ownerUserId = await resolveRequestCompanyOwnerUserId(req);
    return NextResponse.json(
      listTasks({
        companyIdOrSlug: query.company,
        projectId: query.projectId,
        assignee: query.assignee,
        status: query.status,
        priority: query.priority,
        type: query.type,
        search: query.search,
        sort: query.sort,
        sourceReviewId: query.sourceReviewId,
        sourceTakeawayId: query.sourceTakeawayId,
        includeArchived: query.includeArchived,
        includeNonProduction,
        limit: query.limit,
        ownerUserId,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid task list query", error.flatten());
    }
    return handleRouteError(error, "tasks:get");
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createTaskSchema.parse(body);
    const explicitCreator = body && typeof body === "object" && "createdBy" in body;
    const result = createTask({
      ...parsed,
      companyIdOrSlug: parsed.company,
      createdBy: explicitCreator ? parsed.createdBy : resolveDefaultTaskCreator(parsed) ?? parsed.createdBy,
    });

    let heartbeat;
    if (result.task.assignee) {
      if (result.task.status !== "in-progress") {
        heartbeat = { attempted: false, queued: false, status: "skipped", reason: "task_not_in_progress" };
      } else {
        try {
          const execution = await triggerTaskExecution({
              taskId: result.task.id,
              idempotencyKey: `mc-task-create:${result.task.id}:${result.task.updated}`,
              reason: "task_created_in_progress",
            });
          heartbeat = {
            attempted: true,
            queued: execution.queued,
            status: execution.status,
            mode: execution.mode,
            runId: execution.runId,
            sessionId: execution.sessionId,
            reason: execution.reason,
          };
          triggerImmediateRunIfAllowed(result.task.id, execution.runId);
        } catch (error) {
          if (error instanceof OrchestrationApiError) {
            heartbeat = { attempted: true, queued: false, status: "skipped", reason: "execution_trigger_failed", error: { code: error.code, message: error.message } };
          } else {
            heartbeat = { attempted: true, queued: false, status: "skipped", reason: "execution_trigger_failed" };
          }
        }
      }
    } else {
      heartbeat = { attempted: false, queued: false, status: "skipped", reason: "task_unassigned" };
    }

    return NextResponse.json({ ...result, heartbeat }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid create task payload", error.flatten());
    }
    return handleRouteError(error, "tasks:post");
  }
}
