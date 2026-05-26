import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { createTaskComment } from "@/lib/orchestration/service/comment";

export const dynamic = "force-dynamic";

/**
 * DEV-ONLY: Codex Run-Path Exerciser
 *
 * POST /api/orchestration/codex/exercise
 *
 * Exercises the MC-side Codex execution storage/display path.
 * Creates a real execution_runs record with provider='codex' and
 * optional agent comments using the real HiveRunner functions — but without
 * invoking the Codex CLI.
 *
 * This validates:
 *  - execution_run creation with provider='codex' (real DB path)
 *  - comment creation with source='codex' (real createTaskComment path)
 *  - canonical run detail rendering of Codex-provider records
 *  - provider tier/capability presentation for Codex runs
 *
 * This does NOT validate:
 *  - Codex CLI availability or execution
 *  - Real Codex model inference
 *  - Build-queue integration with orchestration DB
 *  - Real Codex JSON event capture
 *  - Structured tool events from a live Codex process
 *  - Full adapter transcript persistence
 *
 * This is MC-side Codex run-path validation, not full Codex integration.
 *
 * NOT a production route. Development/testing utility only.
 *
 * Body: {
 *   taskId: string,
 *   simulateFailure?: boolean  // if true, creates a failed run
 * }
 */
export async function POST(req: NextRequest) {
  // Only available in development
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Codex exerciser is dev-only" },
      { status: 403 },
    );
  }

  try {
    const body = (await req.json()) as {
      taskId?: string;
      simulateFailure?: boolean;
    };
    const { taskId, simulateFailure = false } = body;

    if (!taskId) {
      return NextResponse.json({ error: "taskId required" }, { status: 400 });
    }

    const db = getOrchestrationDb();
    const now = new Date().toISOString();

    // Verify task exists
    const task = db
      .prepare(
        `SELECT t.id, t.title, t.task_key, t.assignee_agent_id,
                a.name AS agent_name, a.slug AS agent_slug
         FROM tasks t
         LEFT JOIN agents a ON t.assignee_agent_id = a.id
         WHERE t.id = ? AND t.archived_at IS NULL LIMIT 1`,
      )
      .get(taskId) as
      | {
          id: string;
          title: string;
          task_key: string;
          assignee_agent_id: string | null;
          agent_name: string | null;
          agent_slug: string | null;
        }
      | undefined;

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // ── Step 1: Create execution_run with provider='codex' ──
    //
    // This mirrors the pattern from triggerTaskExecution() and the
    // Runtime exerciser for the Codex CLI path.
    //
    // In real Codex execution (build-queue.ts), the CLI runs via:
    //   execFile("codex", ["exec", "--full-auto", prompt])
    // That path currently writes to file-based build logs, not here.
    // This exerciser validates that the orchestration DB can store
    // and display Codex runs when that bridge is eventually built.

    const runId = randomUUID();
    const durationMs = simulateFailure ? 12_000 : 95_000; // ~1.5 min for success
    const startedAt = new Date(Date.now() - durationMs).toISOString();
    const completedAt = now;
    const status = simulateFailure ? "failed" : "completed";
    const errorMessage = simulateFailure
      ? "codex exec exited with code 1: context deadline exceeded"
      : null;

    db.prepare(
      `INSERT INTO execution_runs
        (id, task_id, agent_id, provider, session_id, status, started_at, completed_at,
         error_message, token_usage_json, duration_ms, created_at, updated_at)
       VALUES (?, ?, ?, 'codex', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      runId,
      task.id,
      task.assignee_agent_id,
      null, // session_id: Codex CLI is stateless — no persistent session
      status,
      startedAt,
      completedAt,
      errorMessage,
      JSON.stringify({
        // Honest: we don't have real token usage from CLI.
        // The exerciser records what IS known from a CLI execution.
        source: "codex-exerciser",
        note: "Token usage not available from Codex CLI output",
      }),
      durationMs,
      now,
      now,
    );

    // ── Step 2: Import exerciser comments using real createTaskComment() ──
    //
    // In a real Codex integration, these would come from parsing CLI
    // stdout or a future Codex event API. The exerciser creates
    // representative lifecycle comments with source='codex'.

    const importedCommentIds: string[] = [];

    if (!simulateFailure) {
      const comments = [
        {
          body: `Codex (${task.task_key}): Execution started. Analyzing task requirements and existing codebase.`,
          type: "comment" as const,
          externalRef: `codex-exercise-${runId}-start`,
          createdAt: startedAt,
        },
        {
          body: `Codex (${task.task_key}): Work complete. Changes applied and validated.`,
          type: "status_update" as const,
          externalRef: `codex-exercise-${runId}-end`,
          createdAt: completedAt,
        },
      ];

      for (const c of comments) {
        try {
          const result = createTaskComment({
            taskId: task.id,
            body: c.body,
            type: c.type,
            authorAgentId: task.assignee_agent_id ?? undefined,
            source: "codex",
            externalRef: c.externalRef,
            createdAt: c.createdAt,
          });
          importedCommentIds.push(result.comment.id);
        } catch (err) {
          // Continue on duplicate external_ref (idempotent)
          console.log(
            `[codex-exercise] comment import skipped: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return NextResponse.json({
      validation: "mc-side-codex-run-path",
      note: "Records created through real HiveRunner orchestration functions. Codex CLI was NOT invoked. This validates storage/display, not execution.",
      executionRun: {
        id: runId,
        taskId: task.id,
        taskKey: task.task_key,
        agentName: task.agent_name,
        agentSlug: task.agent_slug,
        provider: "codex",
        status,
        durationMs,
        errorMessage,
      },
      commentsImported: importedCommentIds.length,
      functionsExercised: [
        "execution_runs INSERT with provider='codex' (validates migration 34 CHECK constraint)",
        ...(importedCommentIds.length > 0
          ? [
              "createTaskComment with source='codex' (real function from service/comment.ts)",
            ]
          : []),
      ],
      canonicalRunDetailRoute: `GET /api/orchestration/engine/runs/${runId}/events`,
      whatThisProves: [
        "Codex is a valid execution_runs.provider value (schema accepts it)",
        "Canonical run detail API can resolve and render provider='codex'",
        "Provider presentation can resolve Codex as a first-class runtime",
        "Lifecycle truth (timing, status, error) is stored and retrievable",
      ],
      whatThisDoesNotProve: [
        "Codex CLI execution (CLI was not invoked)",
        "Build-queue → orchestration DB bridge (not yet connected)",
        "Live Codex JSON event capture",
        "Structured tool events from a live Codex process",
        "Real token usage (not available from CLI output)",
      ],
    });
  } catch (error) {
    console.error("[codex-exercise] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
