/**
 * POST /api/notifications/sync
 * Reads tasks-log.md and cron runs to generate system notifications
 */
import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import os from "os";
import { getSystemStats } from "@/lib/system-stats";
import { resolveHiveRunnerWorkspaceRoot } from "@/lib/workspaces/root";

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || resolveHiveRunnerWorkspaceRoot();
const DATA_PATH = join(process.cwd(), "data", "notifications.json");

interface Notification {
  id: string;
  timestamp: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  read: boolean;
  link?: string;
  metadata?: Record<string, unknown>;
}

function loadNotifications(): Notification[] {
  try {
    const data = readFileSync(DATA_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveNotifications(notifications: Notification[]): void {
  const dir = join(process.cwd(), "data");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {}
  writeFileSync(DATA_PATH, JSON.stringify(notifications, null, 2));
}

function notificationDedupeKey(notification: Notification): string {
  const explicitKey = notification.metadata?.dedupeKey;
  if (typeof explicitKey === "string" && explicitKey.trim()) return explicitKey;
  if (notification.title.includes("High Memory Usage")) return "system:memory:high";
  if (notification.title.includes("Disk Space Warning")) return "system:disk:root:high";
  return notification.title + notification.message;
}

function getTodayString(): string {
  return new Date().toISOString().split("T")[0];
}

export async function POST() {
  try {
    const existing = loadNotifications();
    const existingTitles = new Set(existing.map(notificationDedupeKey));
    const newNotifs: Notification[] = [];

    // Parse tasks-log.md for today's completions
    const tasksLogPath = join(WORKSPACE, "memory", "tasks-log.md");
    const today = getTodayString();

    if (existsSync(tasksLogPath)) {
      const raw = readFileSync(tasksLogPath, "utf-8");
      const lines = raw.split("\n");
      let inToday = false;

      for (const line of lines) {
        if (line.startsWith("### ")) {
          inToday = line.includes(today);
          continue;
        }
        if (!inToday) continue;

        // Completed tasks
        if (line.startsWith("- ✅")) {
          const text = line.replace(/^- ✅\s*/, "").replace(/^TASK-\d+:\s*/, "").split("→")[0].trim();
          const title = "Task Completed";
          const message = text.slice(0, 120);
          const key = title + message;
          if (!existingTitles.has(key)) {
            newNotifs.push({
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              title,
              message,
              type: "success",
              read: false,
              link: "/tasks",
            });
            existingTitles.add(key);
          }
        }

        // Failed tasks
        if (line.startsWith("- ❌")) {
          const text = line.replace(/^- ❌\s*/, "").replace(/^TASK-\d+:\s*/, "").split("→")[0].trim();
          const title = "Task Failed";
          const message = text.slice(0, 120);
          const key = title + message;
          if (!existingTitles.has(key)) {
            newNotifs.push({
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              title,
              message,
              type: "error",
              read: false,
              link: "/tasks",
            });
            existingTitles.add(key);
          }
        }
      }
    }

    // System health checks
    try {
      const stats = await getSystemStats();
      const usePercent = stats.disk.total > 0
        ? Math.round((stats.disk.used / stats.disk.total) * 100)
        : 0;
      if (usePercent >= 90) {
        const title = "⚠️ Disk Space Warning";
        const message = `Root disk is ${usePercent}% full — consider cleanup`;
        const key = "system:disk:root:high";
        if (!existingTitles.has(key)) {
          newNotifs.push({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            title,
            message,
            type: "warning",
            read: false,
            link: "/system",
            metadata: { dedupeKey: key },
          });
          existingTitles.add(key);
        }
      }
    } catch {}

    // Memory check
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedPct = Math.round(((totalMem - freeMem) / totalMem) * 100);
      if (usedPct >= 90) {
        const title = "⚠️ High Memory Usage";
        const message = `RAM usage at ${usedPct}% — system may be under load`;
        const key = "system:memory:high";
        if (!existingTitles.has(key)) {
          newNotifs.push({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            title,
            message,
            type: "warning",
            read: false,
            link: "/system",
            metadata: { dedupeKey: key },
          });
          existingTitles.add(key);
        }
      }
    } catch {}

    if (newNotifs.length > 0) {
      const updated = [...newNotifs, ...existing].slice(0, 100);
      saveNotifications(updated);
    }

    return NextResponse.json({ synced: newNotifs.length });
  } catch (error) {
    console.error("[notifications/sync] Error:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
