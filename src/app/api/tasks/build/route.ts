import { NextRequest, NextResponse } from "next/server";
import { queueOrStartBuild, readBuildLog } from "@/lib/build-queue";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { taskId } = await req.json();
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const result = await queueOrStartBuild(taskId, { source: "tasks-build-route" });

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

    return NextResponse.json({
      message: result.kind === "queued" ? "Build queued behind active builder" : `Build agent spawned → routed to ${result.build.routing.modelName}`,
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
  return NextResponse.json(readBuildLog());
}
