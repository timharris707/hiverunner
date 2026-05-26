import { NextRequest, NextResponse } from "next/server";
import { queueOrStartBuild, readBuildLog, reconcileBuildQueue, retryBuild } from "@/lib/build-queue";

export const dynamic = "force-dynamic";

function serializeTask(task: any, build?: any) {
  if (!task || typeof task !== "object") return task;
  if (task.buildState !== undefined) return task;

  const buildStatus = build?.status;
  if (buildStatus === "queued" || buildStatus === "spawning" || buildStatus === "running") {
    return { ...task, buildState: buildStatus };
  }
  if (task.status === "done") {
    return { ...task, buildState: "completed" };
  }
  if (task.status === "blocked") {
    return { ...task, buildState: "blocked" };
  }

  return { ...task, buildState: null };
}

export async function POST(req: NextRequest) {
  try {
    const { taskId, action } = await req.json();
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    try {
      await reconcileBuildQueue({ source: "tasks-build-post-preflight", force: true });
    } catch (error) {
      console.error("Preflight reconcile failed before build trigger:", error);
    }

    const result = action === "retry"
      ? await retryBuild(taskId, { source: "tasks-build-retry-route" })
      : await queueOrStartBuild(taskId, { source: "tasks-build-route" });

    if (result.kind === "missing") {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (result.kind === "not-in-progress") {
      return NextResponse.json({
        message: "Task is not in progress; build not started",
        task: serializeTask(result.task),
      });
    }

    if (result.kind === "existing") {
      return NextResponse.json({
        message: result.build.status === "queued" ? "Build already queued" : "Build already active",
        build: result.build,
        task: serializeTask(result.task, result.build),
      });
    }

    if (result.kind === "spawn-failed") {
      return NextResponse.json({
        error: result.error,
        message: "Builder process failed to start",
        build: result.build,
        task: serializeTask(result.task, result.build),
      }, { status: 500 });
    }

    if (result.kind === "done-task-skipped") {
      return NextResponse.json({
        message: "Done tasks cannot be retried",
      }, { status: 409 });
    }

    // Quota-aware scheduling verdicts
    if (result.kind === "quota-debounced") {
      return NextResponse.json({
        message: result.verdict.reason,
        quotaAction: "debounced",
        retryAfterMs: result.verdict.retryAfterMs,
        task: serializeTask(result.task),
      }, { status: 429 });
    }

    if (result.kind === "quota-deferred") {
      return NextResponse.json({
        message: result.verdict.reason,
        quotaAction: "deferred",
        deferUntil: result.verdict.deferUntil,
        task: serializeTask(result.task),
      });
    }

    if (result.kind === "quota-blocked") {
      return NextResponse.json({
        message: result.verdict.reason,
        quotaAction: "blocked",
        task: serializeTask(result.task),
      }, { status: 429 });
    }

    if (result.kind === "queued") {
      return NextResponse.json({
        message:
          action === "retry"
            ? "Build retry queued behind active builder"
            : "Build queued behind active builder",
        queued: true,
        pid: null,
        build: result.build,
        task: serializeTask(result.task, result.build),
        routing: result.build.routing,
      });
    }

    if (result.kind === "started") {
      const pid = "spawn" in result ? (result.spawn?.pid ?? null) : null;
      return NextResponse.json({
        message:
          action === "retry"
            ? `Build retry spawned -> routed to ${result.build.routing.modelName}`
            : `Build agent spawned -> routed to ${result.build.routing.modelName}`,
        queued: false,
        pid,
        build: result.build,
        task: serializeTask(result.task, result.build),
        routing: result.build.routing,
      });
    }

    return NextResponse.json({ error: "Unhandled build result" }, { status: 500 });
  } catch (error) {
    console.error("Error triggering build:", error);
    return NextResponse.json({ error: "Failed to trigger build" }, { status: 500 });
  }
}

export async function GET() {
  await reconcileBuildQueue({ source: "tasks-build-get" });
  return NextResponse.json(readBuildLog());
}
