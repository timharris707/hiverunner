import type Database from "better-sqlite3";

import { enqueueWakeup, findCompanyCeo } from "@/lib/orchestration/engine/engine";

/**
 * Orchestration sweeper: periodically scans open tasks (on_deck / in_progress /
 * review) and enqueues wakes for the assigned agent if one isn't already in
 * flight. Terminates naturally when tasks reach done / cancelled / backlog or
 * get moved to blocked (blocked is treated as "waiting on something external"
 * and skipped).
 *
 * Design constraints:
 * - Per-task idempotency: `sweep:{taskId}:{status}` — multiple sweep cycles
 *   collapse into one queued wake until it is claimed.
 * - Per-agent concurrency: skip tasks whose assignee already has a queued or
 *   running wake. Another tick will pick them up when the prior run finishes.
 * - Loop guard: skip tasks with 3+ failed runs in the last hour. Chronic
 *   failures should not be re-woken forever — they require operator attention
 *   or a blocker comment before the sweep resumes.
 * - Agent state: paused/offline/archived agents never get swept.
 * - Cap: bounded number of wakes per sweep cycle to avoid bursty enqueues.
 */

export type SweepResult = {
  sweptAt: string;
  candidatesConsidered: number;
  wakesEnqueued: number;
  wakesCoalesced: number;
  skippedReasons: Record<string, number>;
};

type OpenTaskRow = {
  task_id: string;
  task_status: "on_deck" | "in_progress" | "review";
  assignee_agent_id: string;
  company_id: string;
  agent_status: string;
  agent_archived_at: string | null;
};

const DEFAULT_SWEEP_CAP = 10;
const BACKOFF_FAILED_RUN_THRESHOLD = 3;
const BACKOFF_WINDOW_MS = 60 * 60 * 1000; // 1h

/**
 * Optional company-slug allowlist read from MC_SWEEP_COMPANIES. Unset = sweep
 * every company (platform-wide orchestration). Set to a comma-separated list
 * of slugs to restrict the sweep — useful when you want stable focused on one
 * lane without touching code (e.g. "weather-edge-2").
 *
 * Unknown slugs are dropped rather than aborting; an empty effective list (all
 * values unknown) still sweeps nothing, which is the intended safety — if the
 * operator typoed every slug, we'd rather do nothing than silently fall back
 * to platform-wide.
 */
function readSweepCompanyAllowlist(): string[] | null {
  const raw = process.env.MC_SWEEP_COMPANIES?.trim();
  if (!raw) return null;
  const slugs = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return slugs.length > 0 ? slugs : null;
}

export function sweepOpenTasks(
  db: Database.Database,
  options: { cap?: number; now?: Date; companySlugs?: string[] | null } = {},
): SweepResult {
  const cap = options.cap ?? DEFAULT_SWEEP_CAP;
  const now = options.now ?? new Date();
  const sweptAt = now.toISOString();
  const backoffSince = new Date(now.getTime() - BACKOFF_WINDOW_MS).toISOString();
  const companySlugs = options.companySlugs !== undefined
    ? options.companySlugs
    : readSweepCompanyAllowlist();

  const skippedReasons: Record<string, number> = {};
  const bumpSkip = (reason: string) => {
    skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
  };

  // Pull eligible open tasks + their assignee agent. Done/cancelled/backlog
  // and blocked are filtered out at the query level. Unassigned tasks are
  // also filtered — sweep only operates on tasks that already have someone
  // accountable. Archived companies/projects are excluded outright so stale
  // demo fixtures can't keep burning agent runs after they've been archived
  // in the UI (observed 2026-04-17: four archived "Detail Co …" rows kept
  // showing up in sweep results because nothing filtered them out).
  const companyFilter = companySlugs && companySlugs.length > 0
    ? ` AND c.slug IN (${companySlugs.map(() => "?").join(",")})`
    : "";
  const candidates = db
    .prepare(
      `SELECT
         t.id             AS task_id,
         t.status         AS task_status,
         t.assignee_agent_id,
         p.company_id,
         a.status         AS agent_status,
         a.archived_at    AS agent_archived_at
       FROM tasks t
       INNER JOIN projects p  ON p.id = t.project_id
       INNER JOIN companies c ON c.id = p.company_id
       INNER JOIN agents a    ON a.id = t.assignee_agent_id
       WHERE t.archived_at IS NULL
         AND p.archived_at IS NULL
         AND c.archived_at IS NULL
         AND c.status = 'active'
         AND t.status IN ('on_deck', 'in_progress', 'review')
         AND t.assignee_agent_id IS NOT NULL${companyFilter}
       ORDER BY
         CASE t.status
           WHEN 'in_progress' THEN 0
           WHEN 'review' THEN 1
           WHEN 'on_deck' THEN 2
         END,
         t.updated_at ASC`,
    )
    .all(...(companySlugs ?? [])) as OpenTaskRow[];

  let wakesEnqueued = 0;
  let wakesCoalesced = 0;

  for (const row of candidates) {
    if (wakesEnqueued + wakesCoalesced >= cap) {
      bumpSkip("cap_reached");
      continue;
    }

    // Review is a reviewer-gated state: the assignee cannot approve their
    // own work. Route review-task sweeps to the CEO (company reviewer). If
    // no CEO exists, or the CEO is the assignee, skip — we don't want to
    // re-wake the assignee into the review-pinning loop observed 2026-04-18.
    // For on_deck / in_progress, continue to target the assignee.
    let targetAgentId = row.assignee_agent_id;
    let sweepReason: "sweep_open_task" | "sweep_review_to_ceo" = "sweep_open_task";
    let idempotencyKey = `sweep:${row.task_id}:${row.task_status}`;
    if (row.task_status === "review") {
      const ceo = findCompanyCeo(row.company_id, db);
      if (!ceo) {
        bumpSkip("no_ceo_for_review");
        continue;
      }
      if (ceo.id === row.assignee_agent_id) {
        bumpSkip("assignee_is_ceo_for_review");
        continue;
      }
      const ceoRow = db
        .prepare(
          `SELECT status, archived_at FROM agents WHERE id = ? LIMIT 1`,
        )
        .get(ceo.id) as { status: string; archived_at: string | null } | undefined;
      if (!ceoRow || ceoRow.archived_at) {
        bumpSkip("ceo_archived");
        continue;
      }
      if (ceoRow.status === "paused" || ceoRow.status === "offline") {
        bumpSkip(`ceo_${ceoRow.status}`);
        continue;
      }
      targetAgentId = ceo.id;
      sweepReason = "sweep_review_to_ceo";
      idempotencyKey = `ceo_review:${row.task_id}`;
    } else {
      if (row.agent_archived_at) {
        bumpSkip("agent_archived");
        continue;
      }
      if (row.agent_status === "paused" || row.agent_status === "offline") {
        bumpSkip(`agent_${row.agent_status}`);
        continue;
      }
    }

    const activeWake = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM agent_wakeup_requests
         WHERE agent_id = ? AND status IN ('queued', 'claimed')`,
      )
      .get(targetAgentId) as { n: number } | undefined;

    if ((activeWake?.n ?? 0) > 0) {
      bumpSkip("agent_has_active_wake");
      continue;
    }

    const activeRun = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM heartbeat_runs
         WHERE agent_id = ? AND status = 'running'`,
      )
      .get(targetAgentId) as { n: number } | undefined;

    if ((activeRun?.n ?? 0) > 0) {
      bumpSkip("agent_has_running_run");
      continue;
    }

    const recentFailed = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM heartbeat_runs
         WHERE agent_id = ? AND status = 'failed'
           AND started_at > ?`,
      )
      .get(targetAgentId, backoffSince) as { n: number } | undefined;

    if ((recentFailed?.n ?? 0) >= BACKOFF_FAILED_RUN_THRESHOLD) {
      bumpSkip("agent_backoff");
      continue;
    }

    const result = enqueueWakeup(
      {
        agentId: targetAgentId,
        companyId: row.company_id,
        source: "api",
        reason: sweepReason,
        payload: {
          taskId: row.task_id,
          taskStatus: row.task_status,
          sweptAt,
          ...(sweepReason === "sweep_review_to_ceo"
            ? { assigneeAgentId: row.assignee_agent_id }
            : {}),
        },
        idempotencyKey,
      },
      db,
    );

    if (result.status === "coalesced") {
      wakesCoalesced += 1;
    } else {
      wakesEnqueued += 1;
    }
  }

  return {
    sweptAt,
    candidatesConsidered: candidates.length,
    wakesEnqueued,
    wakesCoalesced,
    skippedReasons,
  };
}

/**
 * Caller-scoped scheduler for periodic sweeps. Engine tick fires every ~10s;
 * the sweeper is more expensive and only needs to fire once a minute. In-memory
 * `lastSweepAt` is fine: on process restart the sweep just fires on the first
 * tick after the server comes up, which is the right behavior.
 */
let lastSweepAt = 0;

const SWEEP_INTERVAL_MS = (() => {
  const raw = process.env.MC_SWEEP_INTERVAL_MS;
  if (!raw) return 60_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
})();

export function maybeSweepOpenTasks(db: Database.Database): SweepResult | null {
  if (process.env.MC_ORCHESTRATION_SWEEP === "0") {
    return null;
  }
  const nowMs = Date.now();
  if (nowMs - lastSweepAt < SWEEP_INTERVAL_MS) {
    return null;
  }
  lastSweepAt = nowMs;
  return sweepOpenTasks(db, { now: new Date(nowMs) });
}

// Exposed for testing only — lets tests force a sweep regardless of cadence.
export const __sweeperTestHooks = {
  resetLastSweepAt: () => {
    lastSweepAt = 0;
  },
};
