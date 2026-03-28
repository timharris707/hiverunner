import { NextRequest, NextResponse } from "next/server";
import { queueOrStartBuild, readBuildLog, reconcileBuildQueue, retryBuild } from "@/lib/build-queue";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { taskId, action } = await req.json();
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
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
        task: result.task,
      });
    }

    if (result.kind === "existing") {
      return NextResponse.json({
        message: result.build.status === "queued" ? "Build already queued" : "Build already active",
        build: result.build,
        task: result.task,
      });
    }

    // Quota-aware scheduling verdicts
    if (result.kind === "quota-debounced") {
      return NextResponse.json({
        message: result.verdict.reason,
        quotaAction: "debounced",
        retryAfterMs: (result.verdict as any).retryAfterMs,
        task: result.task,
      }, { status: 429 });
    }

    if (result.kind === "quota-deferred") {
      return NextResponse.json({
        message: result.verdict.reason,
        quotaAction: "deferred",
        deferUntil: (result.verdict as any).deferUntil,
        task: result.task,
      });
    }

    if (result.kind === "quota-blocked") {
      return NextResponse.json({
        message: result.verdict.reason,
        quotaAction: "blocked",
        task: result.task,
      }, { status: 429 });
    }

    return NextResponse.json({
      message:
        result.kind === "queued"
          ? action === "retry"
            ? "Build retry queued behind active builder"
            : "Build queued behind active builder"
          : action === "retry"
            ? `Build retry spawned → routed to ${result.build.routing.modelName}`
            : `Build agent spawned → routed to ${result.build.routing.modelName}`,
      queued: result.kind === "queued",
      build: result.build,
      task: result.task,
      routing: result.build.routing,
    });
  } catch (error) {
    console.error("Error triggering build:", error);
    return NextResponse.json({ error: "Failed to trigger build" }, { status: 500 });
  }
}

export async function GET() {
  await reconcileBuildQueue({ source: "tasks-build-get" });
  return NextResponse.json(readBuildLog());
}
