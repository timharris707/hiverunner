import { execFile } from "child_process";
import { existsSync, promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import { readTasks, writeTasks, transitionTask } from "@/lib/build-queue";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const ATTACHMENTS_DIR = path.join(process.cwd(), "data", "attachments");
const BROWSER_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

function getBrowserPath() {
  return BROWSER_CANDIDATES.find((candidate) => existsSync(candidate)) || null;
}

function normalizeTargetPath(targetPath?: string | null) {
  if (!targetPath?.trim()) return undefined;
  const trimmed = targetPath.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return undefined;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function isImageAttachment(attachment: { type?: string; path?: string }) {
  return typeof attachment?.type === "string" && attachment.type.startsWith("image/");
}

function getCaptureBaseOrigin(request: NextRequest) {
  const origin = request.nextUrl.origin;
  return origin.replace("0.0.0.0", "localhost");
}

function isVisualUiTask(task: { tags?: string[] }) {
  return Array.isArray(task.tags) && task.tags.some((tag) => String(tag).toLowerCase() === "ui");
}

export async function POST(request: NextRequest) {
  try {
    const browserPath = getBrowserPath();
    if (!browserPath) {
      return NextResponse.json({ error: "No supported headless browser found on this machine" }, { status: 500 });
    }

    const { taskId, targetPath, targetUrl, fullPage } = await request.json();
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const tasks = readTasks();
    const task = tasks.find((entry: any) => entry.id === taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const existingVisualReview = task.visualReview || {};
    const baseOrigin = getCaptureBaseOrigin(request);
    const normalizedTargetPath = normalizeTargetPath(targetPath) || existingVisualReview.targetPath;
    const resolvedTargetUrl = typeof targetUrl === "string" && targetUrl.trim()
      ? targetUrl.trim()
      : normalizedTargetPath
        ? new URL(normalizedTargetPath, baseOrigin).toString()
        : existingVisualReview.targetUrl || (typeof task.source_url === "string" && /^https?:\/\//.test(task.source_url) ? task.source_url : undefined);

    if (!resolvedTargetUrl) {
      return NextResponse.json({ error: "Provide a targetPath or targetUrl for screenshot capture" }, { status: 400 });
    }

    const taskDir = path.join(ATTACHMENTS_DIR, taskId);
    await fs.mkdir(taskDir, { recursive: true });

    const attachmentId = crypto.randomUUID();
    const storedName = `${attachmentId}.png`;
    const screenshotPath = path.join(taskDir, storedName);
    const now = new Date().toISOString();

    const args = [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--window-size=1440,1024",
      "--virtual-time-budget=5000",
      `--screenshot=${screenshotPath}`,
    ];

    if (fullPage) {
      args.push("--run-all-compositor-stages-before-draw");
    }

    args.push(resolvedTargetUrl);

    await execFileAsync(browserPath, args, {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: process.env.HOME,
      },
    });

    const stat = await fs.stat(screenshotPath);
    const attachment = {
      id: attachmentId,
      name: `Visual QC — ${normalizedTargetPath || resolvedTargetUrl}`,
      type: "image/png",
      size: stat.size,
      path: `${taskId}/${storedName}`,
    };

    const captures = Array.isArray(existingVisualReview.captures) ? existingVisualReview.captures : [];
    const attachments = Array.isArray(task.attachments) ? task.attachments : [];
    const reviewImageCount = attachments.filter(isImageAttachment).length + 1;

    task.attachments = [...attachments, attachment];
    task.visualReview = {
      ...existingVisualReview,
      required: true,
      status: "ready",
      targetPath: normalizedTargetPath,
      targetUrl: resolvedTargetUrl,
      captureStatus: "captured",
      browser: path.basename(browserPath),
      lastCapturedAt: now,
      lastUpdatedAt: now,
      captures: [
        ...captures,
        {
          id: attachment.id,
          path: attachment.path,
          name: attachment.name,
          url: resolvedTargetUrl,
          targetPath: normalizedTargetPath,
          capturedAt: now,
          browser: path.basename(browserPath),
        },
      ],
      screenshotEvidenceCount: reviewImageCount,
    };

    if (task.status === "done" && (task.reviewRequired || isVisualUiTask(task))) {
      transitionTask(task, "review", "visual-qc", { force: true, reason: "screenshot captured for done task requiring visual review" });
      task.reviewRequired = true;
      task.reviewStatus = "pending";
      task.reviewRequestedAt = task.reviewRequestedAt || now;
      delete task.completedAt;
    }

    task.updated = now;
    writeTasks(tasks);

    return NextResponse.json({
      success: true,
      browser: path.basename(browserPath),
      targetUrl: resolvedTargetUrl,
      attachment,
      task,
    });
  } catch (error) {
    console.error("[visual-qc] Capture error:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to capture screenshot",
    }, { status: 500 });
  }
}
