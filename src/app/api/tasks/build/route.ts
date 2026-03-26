import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
export const dynamic = "force-dynamic";

const TASKS_FILE = join(process.cwd(), "data", "tasks.json");
const PROJECTS_FILE = join(process.cwd(), "data", "projects.json");
const BUILD_LOG_FILE = join(process.cwd(), "data", "build-log.json");

function readJSON(path: string) {
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return []; }
}

function readBuildLog() {
  try { return JSON.parse(readFileSync(BUILD_LOG_FILE, "utf-8")); } catch { return { builds: [] }; }
}

function writeBuildLog(data: any) {
  writeFileSync(BUILD_LOG_FILE, JSON.stringify(data, null, 2));
}

// POST /api/tasks/build — Trigger a build agent for a task
export async function POST(req: NextRequest) {
  try {
    const { taskId } = await req.json();

    const tasks = readJSON(TASKS_FILE);
    const task = tasks.find((t: any) => t.id === taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const projects = readJSON(PROJECTS_FILE);
    const project = projects.find((p: any) => p.id === task.project);
    const projectName = project?.name || task.project;
    const repo = project?.repo || "";

    // Determine the working directory based on project
    const PROJECT_DIRS: Record<string, string> = {
      "mission-control": "projects/mission-control-app",
      "advisory-board": "projects/mission-control-app",
      "crypto-trading": "projects/crypto-trading",
      "weather-trading": "projects/weather-trading",
      "stock-trading": "projects/stock-trading",
      "snapaudit": "projects/snapaudit",
      "idea-intake": "projects/idea-intake",
      "infrastructure": "",
      "org": "",
      "karpathy-loop": "projects/karpathy-loop",
    };

    const workspaceRoot = process.env.WORKSPACE_ROOT || join(process.cwd(), "..", "..");
    const projectDir = PROJECT_DIRS[task.project]
      ? join(workspaceRoot, PROJECT_DIRS[task.project])
      : workspaceRoot;

    // Build the agent prompt
    const agentPrompt = [
      `## Task: ${task.title}`,
      ``,
      `**Project:** ${projectName}`,
      `**Type:** ${task.type || "feature"}`,
      `**Priority:** ${task.priority}`,
      ``,
      `### Description`,
      task.description || task.title,
      ``,
      `### Requirements`,
      `- Make the necessary code changes to complete this task`,
      `- Run the build (npm run build) and make sure it passes`,
      `- Run tests if they exist`,
      `- Commit with a clear message describing what was built`,
      `- Push to the remote repository`,
      ``,
      `When completely finished, run this command to notify the system:`,
      `openclaw system event --text "Done: ${task.title.replace(/"/g, '\\"')}" --mode now`,
    ].join("\n");

    // Log the build
    const buildLog = readBuildLog();
    const buildEntry = {
      id: `build-${Date.now()}`,
      taskId: task.id,
      taskTitle: task.title,
      project: task.project,
      status: "spawning",
      startedAt: new Date().toISOString(),
      completedAt: null,
      agentType: "claude-code",
      workDir: projectDir,
    };
    buildLog.builds.unshift(buildEntry);
    writeBuildLog(buildLog);

    // Spawn the build agent (non-blocking)
    const command = `cd "${projectDir}" && claude --permission-mode bypassPermissions --print "${agentPrompt.replace(/"/g, '\\"')}"`;

    // Fire and forget — the agent runs in background
    exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      // When agent completes, update the task and build log
      const tasks = readJSON(TASKS_FILE);
      const taskIdx = tasks.findIndex((t: any) => t.id === taskId);

      if (taskIdx !== -1) {
        // Determine if this needs review (UI/money/external) or goes straight to done
        const needsReview = task.tags?.some((tag: string) =>
          ["ui", "trading-live", "external", "marketing", "money"].includes(tag)
        );
        tasks[taskIdx].status = needsReview ? "review" : "done";
        tasks[taskIdx].updated = new Date().toISOString();
        tasks[taskIdx].buildOutput = error ? `Error: ${error.message}` : "Build completed successfully";
        writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
      }

      // Update build log
      const log = readBuildLog();
      const entry = log.builds.find((b: any) => b.id === buildEntry.id);
      if (entry) {
        entry.status = error ? "failed" : "completed";
        entry.completedAt = new Date().toISOString();
        entry.output = error ? stderr?.slice(-500) : stdout?.slice(-500);
        writeBuildLog(log);
      }

      // Send Telegram notification via OpenClaw system event
      if (!error) {
        exec(`openclaw system event --text "✅ Task completed: ${task.title.replace(/"/g, '\\"')}" --mode now`);
      } else {
        exec(`openclaw system event --text "❌ Task failed: ${task.title.replace(/"/g, '\\"')} — check build log" --mode now`);
      }
    });

    // Update task status to in-progress immediately
    task.status = "in-progress";
    task.updated = new Date().toISOString();
    task.buildTriggeredAt = new Date().toISOString();
    writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));

    return NextResponse.json({
      message: "Build agent spawned",
      build: buildEntry,
      task: { id: task.id, title: task.title, status: "in-progress" },
    });
  } catch (error) {
    console.error("Error triggering build:", error);
    return NextResponse.json({ error: "Failed to trigger build" }, { status: 500 });
  }
}

// GET /api/tasks/build — Get build log
export async function GET() {
  const buildLog = readBuildLog();
  return NextResponse.json(buildLog);
}
