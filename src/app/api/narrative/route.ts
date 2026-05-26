/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET /api/narrative
 * Synthesizes tasks + recent activities into human-readable narrative items.
 * "Pixel picked up auth redesign." not "file_write: src/components/auth.tsx"
 */
import { NextResponse } from "next/server";
import { readTasks } from "@/lib/build-queue";
import { getActivities } from "@/lib/activities-db";
import { buildNarrativeItems } from "@/lib/task-narrative";

export const dynamic = "force-dynamic";

export async function GET() {
  let tasks: any[] = [];
  try {
    tasks = readTasks();
  } catch {
    tasks = [];
  }
 
  let activities: Array<{
    id: string;
    timestamp: string;
    type?: string;
    description?: string;
    status?: string;
    agent?: string | null;
  }> = [];
  try {
    activities = getActivities({ limit: 30, sort: "newest" }).activities;
  } catch {
    activities = [];
  }

  return NextResponse.json(buildNarrativeItems(tasks, activities));
}
