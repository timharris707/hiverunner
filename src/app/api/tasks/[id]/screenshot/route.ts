/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { readTasks, writeTasks } from "@/lib/build-queue";
import { captureScreenshot, validateCapture } from "@/lib/visual-qa";

export const dynamic = "force-dynamic";

/**
 * POST /api/tasks/[id]/screenshot
 * Capture a screenshot of the target URL for a given task.
 * Body: { targetUrl: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await params;

  try {
    const body = await request.json();
    const { targetUrl } = body;

    if (!targetUrl) {
      return NextResponse.json(
        { error: "targetUrl is required (e.g. http://localhost:3001/tasks or /tasks)" },
        { status: 400 },
      );
    }

    const tasks = readTasks();
    const task = tasks.find((t: any) => t.id === taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Resolve URL — if relative path, prepend localhost origin
    const resolvedUrl = targetUrl.startsWith("http")
      ? targetUrl
      : `http://localhost:3001${targetUrl.startsWith("/") ? targetUrl : `/${targetUrl}`}`;

    const capture = await captureScreenshot(resolvedUrl, taskId);
    const isValid = validateCapture(capture.filePath);

    // Update task with capture metadata
    const now = new Date().toISOString();
    const existingReview = task.visualReview || {};
    const captures = Array.isArray(existingReview.captures)
      ? existingReview.captures
      : [];

    const captureEntry = {
      id: `cap-${Date.now()}`,
      relativePath: capture.relativePath,
      filePath: capture.filePath,
      url: capture.url,
      capturedAt: capture.timestamp,
      targetPath: targetUrl,
      viewport: capture.viewport,
      valid: isValid,
    };

    task.visualReview = {
      ...existingReview,
      required: true,
      status: "captured",
      lastCapturedAt: now,
      lastUpdatedAt: now,
      captures: [...captures, captureEntry],
    };
    task.updated = now;

    writeTasks(tasks);

    return NextResponse.json({
      success: true,
      capture: captureEntry,
      screenshotUrl: `/${capture.relativePath}`,
      task: { id: task.id, title: task.title, visualReview: task.visualReview },
    });
  } catch (error) {
    console.error(`[screenshot] Capture failed for task ${taskId}:`, error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Screenshot capture failed",
      },
      { status: 500 },
    );
  }
}
