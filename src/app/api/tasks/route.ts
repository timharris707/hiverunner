/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { queueOrStartBuild, readBuildLog, readTasks, reconcileBuildQueue, writeBuildLog, writeTasks, autoAssignGater, autoAssignBuilder, addPipelineComment, VALID_TASK_TRANSITIONS, transitionTask } from "@/lib/build-queue";
import { appendTaskToLog } from "@/lib/tasks-log";

export const dynamic = "force-dynamic";

function serializeTask(task: any) {
  if (!task || typeof task !== "object") return task;
  if (task.buildState !== undefined) return task;

  if (task.status === "done") {
    return { ...task, buildState: "completed" };
  }
  if (task.status === "blocked") {
    return { ...task, buildState: "blocked" };
  }

  return { ...task, buildState: null };
}

function serializeTasks(tasks: any[]) {
  return tasks.map((task) => serializeTask(task));
}

export async function GET() {
  try {
    await reconcileBuildQueue({ source: "tasks-get" });
    const tasks = readTasks();
    return NextResponse.json({ tasks: serializeTasks(tasks) });
  } catch (error) {
    console.error("Error reading tasks:", error);
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const task = await req.json();

    // Guard: tasks cannot enter in_progress without at least one acceptance criterion
    if (task.status === "in-progress") {
      if (!Array.isArray(task.acceptance_criteria) || task.acceptance_criteria.length === 0) {
        return NextResponse.json(
          { error: "acceptance_criteria required: tasks cannot enter in_progress without at least one criterion" },
          { status: 400 }
        );
      }
    }

    const tasks = readTasks();
    const newTask = {
      id: `TASK-${Date.now()}`,
      ...task,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    tasks.unshift(newTask);
    writeTasks(tasks);

    // Auto-assign builder agent when new task is created as in-progress
    if (newTask.status === "in-progress" && !newTask.assignedAgent) {
      const freshTasks = readTasks();
      const t = freshTasks.find((x: any) => x.id === newTask.id);
      if (t) {
        autoAssignBuilder(t);
        writeTasks(freshTasks);
      }
      await queueOrStartBuild(newTask.id, { source: "tasks-post" });
    }

    return NextResponse.json({ task: serializeTask(readTasks().find((t: any) => t.id === newTask.id) || newTask) });
  } catch (error) {
    console.error("Error creating task:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, ...updates } = await req.json();
    const tasks = readTasks();
    const idx = tasks.findIndex((t: any) => t.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const previousTask = { ...tasks[idx] };
    const now = new Date().toISOString();

    // State machine guard: reject invalid status transitions
    if (updates.status && updates.status !== previousTask.status) {
      const allowed: string[] = VALID_TASK_TRANSITIONS[previousTask.status] ?? [];
      if (!allowed.includes(updates.status)) {
        return NextResponse.json(
          { error: `Invalid status transition: ${previousTask.status} → ${updates.status}` },
          { status: 400 }
        );
      }
    }

    // Guard: tasks cannot enter in_progress without at least one acceptance criterion
    if (updates.status === "in-progress" && previousTask.status !== "in-progress") {
      const mergedCriteria = updates.acceptance_criteria ?? previousTask.acceptance_criteria;
      if (!Array.isArray(mergedCriteria) || mergedCriteria.length === 0) {
        return NextResponse.json(
          { error: "acceptance_criteria required: tasks cannot enter in_progress without at least one criterion" },
          { status: 400 }
        );
      }
    }

    // Guard: review → done requires Gater to be assigned as reviewer (cannot skip QA gate)
    if (updates.status === "done" && previousTask.status === "review") {
      const mergedReviewAssigned = updates.reviewAssignedTo ?? previousTask.reviewAssignedTo;
      if (!mergedReviewAssigned) {
        return NextResponse.json(
          { error: "review → done requires Gater to be assigned as reviewer (reviewAssignedTo must be set)" },
          { status: 400 }
        );
      }
    }

    // Apply non-status field updates first
    const { status: newStatus, ...nonStatusUpdates } = updates;
    tasks[idx] = { ...tasks[idx], ...nonStatusUpdates, updated: now };

    // Apply status transition via transitionTask() — enforces all guards and journals the change
    // for crash-safe recovery. Pre-checks above already validated, so failure here means a guard
    // (e.g. reviewAssignedTo missing) fired at the transitionTask level.
    if (newStatus && newStatus !== previousTask.status) {
      const transitioned = transitionTask(tasks[idx], newStatus, "api");
      if (!transitioned) {
        return NextResponse.json(
          { error: `Transition ${previousTask.status} → ${newStatus} rejected by state machine guard` },
          { status: 400 }
        );
      }
    }

    if (tasks[idx].status === "review" && previousTask.status !== "review") {
      tasks[idx].reviewRequired = true;
      tasks[idx].reviewStatus = updates.reviewStatus || "pending";
      tasks[idx].reviewRequestedAt = tasks[idx].reviewRequestedAt || now;
      delete tasks[idx].completedAt;

      // Auto-assign Gater for QA review
      autoAssignGater(tasks[idx]);

      const existingVisualReview = tasks[idx].visualReview || previousTask.visualReview;
      if (existingVisualReview?.required) {
        const captureCount = Array.isArray(existingVisualReview.captures) ? existingVisualReview.captures.length : 0;
        tasks[idx].visualReview = {
          ...existingVisualReview,
          status: captureCount > 0 ? "ready" : "pending-capture",
          lastUpdatedAt: now,
        };
      }
    }

    if (previousTask.status === "review" && tasks[idx].status === "done") {
      tasks[idx].reviewRequired = true;
      tasks[idx].reviewStatus = updates.reviewStatus || "approved";
      tasks[idx].reviewCompletedAt = now;
      tasks[idx].completedAt = tasks[idx].completedAt || now;
      addPipelineComment(tasks[idx], "Review approved — task marked done", "Gater 🚧", "🚧");

      const existingVisualReview = tasks[idx].visualReview || previousTask.visualReview;
      if (existingVisualReview?.required) {
        tasks[idx].visualReview = {
          ...existingVisualReview,
          status: updates.reviewStatus === "changes-requested" ? "changes-requested" : "approved",
          lastUpdatedAt: now,
        };
      }
    }

    if (previousTask.status === "review" && tasks[idx].status === "in-progress") {
      tasks[idx].reviewRequired = true;
      tasks[idx].reviewStatus = updates.reviewStatus || "changes-requested";
      tasks[idx].reviewCompletedAt = now;
      delete tasks[idx].completedAt;
      // Re-assign to original builder on rejection
      addPipelineComment(tasks[idx], "Review rejected — reassigned to builder for fixes", "Gater 🚧", "🚧");
      autoAssignBuilder(tasks[idx]);

      const existingVisualReview = tasks[idx].visualReview || previousTask.visualReview;
      if (existingVisualReview?.required) {
        tasks[idx].visualReview = {
          ...existingVisualReview,
          status: "changes-requested",
          lastUpdatedAt: now,
        };
      }
    }

    const landedInTerminalStatus =
      (tasks[idx].status === "done" || tasks[idx].status === "blocked") &&
      tasks[idx].status !== previousTask.status;

    if (landedInTerminalStatus) {
      tasks[idx].buildState = tasks[idx].status === "done" ? "completed" : "blocked";
      tasks[idx].buildCompletedAt = now;
      delete tasks[idx].activeBuildId;
      delete tasks[idx].buildQueuedAt;
      delete tasks[idx].buildStartedAt;
      delete tasks[idx].buildExecutionKey;
    }

    // Auto-assign builder agent when task enters in-progress (manual move)
    if (
      tasks[idx].status === "in-progress" &&
      previousTask.status !== "in-progress" &&
      !tasks[idx].assignedAgent // don't override if pipeline already assigned
    ) {
      autoAssignBuilder(tasks[idx]);
    }

    if (landedInTerminalStatus) {
      const buildLog = readBuildLog();
      const pendingEntry = buildLog.builds.find((build: any) =>
        build.taskId === id && ["queued", "spawning", "running"].includes(build.status)
      );
      if (pendingEntry) {
        pendingEntry.status = tasks[idx].status === "done" ? "completed" : "failed";
        pendingEntry.completedAt = now;
        pendingEntry.output = tasks[idx].status === "done"
          ? "Build tracking closed by terminal task transition"
          : "Build tracking closed because task moved to blocked";
        writeBuildLog(buildLog);
      }
    }

    writeTasks(tasks);

    // Sync to tasks-log.md for manual status transitions (agent-driven completions
    // are handled by notifyTaskCompletion in build-queue.ts)
    if (
      tasks[idx].status === "done" &&
      previousTask.status !== "done" &&
      !tasks[idx].buildState  // skip if the build pipeline will handle it
    ) {
      appendTaskToLog(tasks[idx], "done");
    }

    const shouldTriggerBuild =
      tasks[idx].status === "in-progress" &&
      (
        (!previousTask.buildTriggeredAt && previousTask.status !== "in-progress") ||
        previousTask.buildState === "failed"
      );

    if (shouldTriggerBuild) {
      await queueOrStartBuild(id, { source: "tasks-patch" });
    }

    // When a task leaves in-progress (done, review), advance the pipeline:
    // promote the next to-do task and spawn a new agent.
    const taskFreedSlot =
      previousTask.status === "in-progress" && tasks[idx].status !== "in-progress" ||
      previousTask.status === "review" && tasks[idx].status === "done";
    if (taskFreedSlot) {
      await reconcileBuildQueue({ source: "tasks-patch-advance", force: true });
    }

    return NextResponse.json({ task: serializeTask(readTasks().find((t: any) => t.id === id) || tasks[idx]) });
  } catch (error) {
    console.error("Error updating task:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}
