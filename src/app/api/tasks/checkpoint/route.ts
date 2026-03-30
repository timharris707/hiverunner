import { NextRequest, NextResponse } from "next/server";
import { dbCheckpoint, dbGetSnapshots, dbGetTransitions } from "@/lib/tasks-db";

export const dynamic = "force-dynamic";

/**
 * POST /api/tasks/checkpoint
 * Force a WAL checkpoint (TRUNCATE mode) — writes all pending WAL pages to the
 * main DB file and truncates the WAL. Creates a clean on-disk snapshot.
 * Safe to call at any time; can be wired to a cron job for scheduled snapshots.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const note = typeof body?.note === "string" ? body.note : undefined;
    const result = dbCheckpoint(note);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[checkpoint] WAL checkpoint failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * GET /api/tasks/checkpoint
 * Returns the transition journal and snapshot history.
 * Query params:
 *   ?taskId=TASK-xxx   — filter transitions to a specific task
 *   ?limit=N           — how many transitions to return (default 100)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get("taskId") ?? undefined;
    const limit  = Math.min(parseInt(searchParams.get("limit") ?? "100", 10), 500);

    const transitions = dbGetTransitions(taskId, limit);
    const snapshots   = dbGetSnapshots(10);

    return NextResponse.json({ transitions, snapshots });
  } catch (err) {
    console.error("[checkpoint] Failed to fetch journal:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
