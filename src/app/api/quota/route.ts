import { NextRequest, NextResponse } from "next/server";
import {
  getQuotaSummary,
  getQuotaConfig,
  configureQuota,
  evaluateTask,
  drainDeferredQueue,
  removeDeferredTask,
  loadQuotaState,
} from "@/lib/quota-scheduler";
import { readTasks } from "@/lib/build-queue";

export const dynamic = "force-dynamic";

/**
 * GET /api/quota — returns current quota summary and scheduling state
 */
export async function GET() {
  try {
    const summary = getQuotaSummary();
    const config = getQuotaConfig();

    return NextResponse.json({
      ...summary,
      config: {
        dailyBudgetUsd: config.dailyBudgetUsd,
        peakBudgetRatio: config.peakBudgetRatio,
        offPeakBudgetRatio: config.offPeakBudgetRatio,
        debounceWindowMs: config.debounceWindowMs,
        maxOffPeakBatchSize: config.maxOffPeakBatchSize,
      },
    });
  } catch (error) {
    console.error("Error getting quota summary:", error);
    return NextResponse.json({ error: "Failed to get quota summary" }, { status: 500 });
  }
}

/**
 * POST /api/quota — actions: evaluate, drain, configure, remove-deferred
 *
 * Body shapes:
 *   { action: "evaluate", taskId: string }
 *   { action: "drain" }
 *   { action: "configure", dailyBudgetUsd?: number, ... }
 *   { action: "remove-deferred", taskId: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === "evaluate") {
      const { taskId } = body;
      if (!taskId) {
        return NextResponse.json({ error: "taskId is required" }, { status: 400 });
      }

      const tasks = readTasks();
      const task = tasks.find((t: any) => t.id === taskId);
      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }

      const verdict = evaluateTask(task, tasks);
      return NextResponse.json({ verdict, task: { id: task.id, title: task.title, priority: task.priority } });
    }

    if (action === "drain") {
      const tasks = readTasks();
      const eligible = drainDeferredQueue(tasks);
      return NextResponse.json({
        drained: eligible.length,
        taskIds: eligible,
        message: eligible.length > 0
          ? `${eligible.length} deferred task(s) released for off-peak processing`
          : "No deferred tasks eligible to drain",
      });
    }

    if (action === "configure") {
      const { dailyBudgetUsd, peakBudgetRatio, offPeakBudgetRatio, debounceWindowMs, maxOffPeakBatchSize } = body;
      const updated = configureQuota({
        ...(dailyBudgetUsd !== undefined && { dailyBudgetUsd }),
        ...(peakBudgetRatio !== undefined && { peakBudgetRatio }),
        ...(offPeakBudgetRatio !== undefined && { offPeakBudgetRatio }),
        ...(debounceWindowMs !== undefined && { debounceWindowMs }),
        ...(maxOffPeakBatchSize !== undefined && { maxOffPeakBatchSize }),
      });
      return NextResponse.json({
        message: "Quota configuration updated",
        config: {
          dailyBudgetUsd: updated.dailyBudgetUsd,
          peakBudgetRatio: updated.peakBudgetRatio,
          offPeakBudgetRatio: updated.offPeakBudgetRatio,
          debounceWindowMs: updated.debounceWindowMs,
          maxOffPeakBatchSize: updated.maxOffPeakBatchSize,
        },
      });
    }

    if (action === "remove-deferred") {
      const { taskId } = body;
      if (!taskId) {
        return NextResponse.json({ error: "taskId is required" }, { status: 400 });
      }
      const removed = removeDeferredTask(taskId);
      return NextResponse.json({
        removed,
        message: removed ? `Task ${taskId} removed from deferred queue` : `Task ${taskId} was not in deferred queue`,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error("Error processing quota action:", error);
    return NextResponse.json({ error: "Failed to process quota action" }, { status: 500 });
  }
}
