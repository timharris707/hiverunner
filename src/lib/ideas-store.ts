import fsSync from "fs";
import path from "path";

import {
  buildTimestampedVideoUrl,
  normalizeVideoTimestampLabel,
} from "@/lib/ideas-processing";
import { getOrchestrationDb } from "@/lib/orchestration/db";

const LEGACY_REVIEWS_PATH = process.env.IDEAS_LEGACY_REVIEWS_PATH?.trim()
  ? path.resolve(process.env.IDEAS_LEGACY_REVIEWS_PATH)
  : null;

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const IDEAS_META_KEY = "store";

type TakeawaySyncStatus = "building" | "shipped" | "rejected";

type IdeasMeta = {
  last_updated: string;
  total_reviews: number;
  next_review_id: number;
  next_takeaway_id: number;
  [key: string]: unknown;
};

type IdeasStoreShape = {
  reviews: Array<Record<string, unknown>>;
  meta: IdeasMeta;
};

type ReviewRow = {
  id: string;
  type: string;
  url: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: string;
  reviewed_at: string | null;
  submitted_by: string;
  status: string;
  summary: string;
  assessment: string;
  rating: number;
  screenshot_count: number | null;
  extra_json: string;
};

type TakeawayRow = {
  id: string;
  review_id: string;
  sort_order: number;
  title: string;
  description: string;
  video_timestamp: string;
  video_url: string;
  video_context: string;
  priority: string;
  effort: string;
  assigned_to: string;
  status: string;
  notes: string;
  github_issue: string;
  extra_json: string;
};

const TASK_TO_TAKEAWAY_STATUS: Record<string, TakeawaySyncStatus> = {
  in_progress: "building",
  "in-progress": "building",
  done: "shipped",
  cancelled: "rejected",
  canceled: "rejected",
};

const REVIEW_FIELDS = new Set([
  "id",
  "type",
  "url",
  "title",
  "channel",
  "thumbnail",
  "duration",
  "reviewed_at",
  "submitted_by",
  "status",
  "summary",
  "assessment",
  "rating",
  "screenshot_count",
  "takeaways",
]);

const TAKEAWAY_FIELDS = new Set([
  "id",
  "title",
  "description",
  "video_timestamp",
  "video_url",
  "video_context",
  "priority",
  "effort",
  "assigned_to",
  "status",
  "notes",
  "github_issue",
]);

function normalizeLifecycleStatus(status: string): string {
  return status.trim().toLowerCase().replaceAll("-", "_");
}

function nowIso(): string {
  return new Date().toISOString();
}

function toStringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return fallback;
  }
  return String(value);
}

function toNumberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseObjectJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function computeNextSequenceFromIds(ids: string[], prefix: string): number {
  let max = 0;
  for (const id of ids) {
    const normalized = String(id ?? "").trim();
    if (!normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
      continue;
    }

    const tail = normalized.slice(prefix.length);
    const numericPart = Number.parseInt(tail, 10);
    if (Number.isFinite(numericPart) && numericPart > max) {
      max = numericPart;
    }
  }
  return max + 1;
}

function buildDefaultStore(): IdeasStoreShape {
  return {
    reviews: [],
    meta: {
      last_updated: nowIso(),
      total_reviews: 0,
      next_review_id: 1,
      next_takeaway_id: 1,
    },
  };
}

function buildTakeawaysByReview(rows: TakeawayRow[]): Map<string, Array<Record<string, unknown>>> {
  const byReview = new Map<string, Array<Record<string, unknown>>>();

  for (const row of rows) {
    const extra = parseObjectJson(row.extra_json);
    const takeaway: Record<string, unknown> = {
      ...extra,
      id: row.id,
      title: row.title,
      description: row.description,
      video_timestamp: row.video_timestamp,
      video_url: row.video_url,
      video_context: row.video_context,
      priority: row.priority,
      effort: row.effort,
      assigned_to: row.assigned_to,
      status: row.status,
      notes: row.notes,
      github_issue: row.github_issue,
    };

    const existing = byReview.get(row.review_id) ?? [];
    existing.push(takeaway);
    byReview.set(row.review_id, existing);
  }

  return byReview;
}

function buildStoreFromDb(): IdeasStoreShape {
  const db = getOrchestrationDb();

  const reviewRows = db
    .prepare(
      `SELECT
        id,
        type,
        url,
        title,
        channel,
        thumbnail,
        duration,
        reviewed_at,
        submitted_by,
        status,
        summary,
        assessment,
        rating,
        screenshot_count,
        extra_json
      FROM ideas_reviews
      ORDER BY datetime(reviewed_at) DESC, datetime(updated_at) DESC, id ASC`
    )
    .all() as ReviewRow[];

  const takeawayRows = db
    .prepare(
      `SELECT
        id,
        review_id,
        sort_order,
        title,
        description,
        video_timestamp,
        video_url,
        video_context,
        priority,
        effort,
        assigned_to,
        status,
        notes,
        github_issue,
        extra_json
      FROM ideas_takeaways
      ORDER BY review_id ASC, sort_order ASC, datetime(created_at) ASC`
    )
    .all() as TakeawayRow[];

  const takeawaysByReview = buildTakeawaysByReview(takeawayRows);

  const metaRow = db
    .prepare("SELECT value_json FROM ideas_meta WHERE key = ? LIMIT 1")
    .get(IDEAS_META_KEY) as { value_json: string } | undefined;
  const persistedMeta = parseObjectJson(metaRow?.value_json);

  const reviews = reviewRows.map((row) => {
    const extra = parseObjectJson(row.extra_json);
    return {
      ...extra,
      id: row.id,
      type: row.type,
      url: row.url,
      title: row.title,
      channel: row.channel,
      thumbnail: row.thumbnail,
      duration: row.duration,
      reviewed_at: row.reviewed_at ?? "",
      submitted_by: row.submitted_by,
      status: row.status,
      summary: row.summary,
      assessment: row.assessment,
      rating: row.rating,
      screenshot_count: row.screenshot_count ?? undefined,
      takeaways: takeawaysByReview.get(row.id) ?? [],
    } as Record<string, unknown>;
  });

  const nextReviewId = Math.max(
    toNumberValue(persistedMeta.next_review_id, 0),
    computeNextSequenceFromIds(
      reviews.map((review) => toStringValue(review.id)),
      "review-"
    )
  );

  const nextTakeawayId = Math.max(
    toNumberValue(persistedMeta.next_takeaway_id, 0),
    computeNextSequenceFromIds(
      takeawayRows.map((row) => row.id),
      "tw-"
    )
  );

  const meta: IdeasMeta = {
    ...persistedMeta,
    last_updated: toStringValue(persistedMeta.last_updated, nowIso()),
    total_reviews: reviews.length,
    next_review_id: nextReviewId > 0 ? nextReviewId : 1,
    next_takeaway_id: nextTakeawayId > 0 ? nextTakeawayId : 1,
  };

  return { reviews, meta };
}

function toExtraFields(source: Record<string, unknown>, knownFields: Set<string>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!knownFields.has(key)) {
      extra[key] = value;
    }
  }
  return extra;
}

function persistStoreToDb(input: Record<string, unknown>): IdeasStoreShape {
  const db = getOrchestrationDb();
  const rawReviews = Array.isArray(input.reviews) ? input.reviews : [];
  const incomingMeta =
    input.meta && typeof input.meta === "object" && !Array.isArray(input.meta)
      ? (input.meta as Record<string, unknown>)
      : {};

  const now = nowIso();

  const writeTx = db.transaction(() => {
    db.prepare("DELETE FROM ideas_takeaways").run();
    db.prepare("DELETE FROM ideas_reviews").run();

    const insertReview = db.prepare(
      `INSERT INTO ideas_reviews (
        id,
        type,
        url,
        title,
        channel,
        thumbnail,
        duration,
        reviewed_at,
        submitted_by,
        status,
        summary,
        assessment,
        rating,
        screenshot_count,
        extra_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertTakeaway = db.prepare(
      `INSERT INTO ideas_takeaways (
        id,
        review_id,
        sort_order,
        title,
        description,
        video_timestamp,
        video_url,
        video_context,
        priority,
        effort,
        assigned_to,
        status,
        notes,
        github_issue,
        extra_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const reviewCandidate of rawReviews) {
      const review =
        reviewCandidate && typeof reviewCandidate === "object" && !Array.isArray(reviewCandidate)
          ? (reviewCandidate as Record<string, unknown>)
          : null;
      if (!review) {
        continue;
      }

      const reviewId = toStringValue(review.id).trim();
      if (!reviewId) {
        continue;
      }

      const extraReviewFields = toExtraFields(review, REVIEW_FIELDS);
      const takeaways = Array.isArray(review.takeaways) ? review.takeaways : [];

      insertReview.run(
        reviewId,
        toStringValue(review.type, "manual"),
        toStringValue(review.url),
        toStringValue(review.title),
        toStringValue(review.channel),
        toStringValue(review.thumbnail),
        toStringValue(review.duration),
        toStringValue(review.reviewed_at) || null,
        toStringValue(review.submitted_by),
        toStringValue(review.status, "active"),
        toStringValue(review.summary),
        toStringValue(review.assessment),
        toNumberValue(review.rating, 0),
        review.screenshot_count == null ? null : toNumberValue(review.screenshot_count),
        JSON.stringify(extraReviewFields),
        now,
        now,
      );

      let sortOrder = 0;
      for (const takeawayCandidate of takeaways) {
        const takeaway =
          takeawayCandidate && typeof takeawayCandidate === "object" && !Array.isArray(takeawayCandidate)
            ? (takeawayCandidate as Record<string, unknown>)
            : null;
        if (!takeaway) {
          continue;
        }

        const takeawayId = toStringValue(takeaway.id).trim();
        if (!takeawayId) {
          continue;
        }

        const rawVideoTimestamp = toStringValue(takeaway.video_timestamp);
        const rawVideoUrl = toStringValue(takeaway.video_url);
        const normalizedVideoUrl = buildTimestampedVideoUrl(rawVideoUrl, rawVideoTimestamp);
        const normalizedTimestamp = normalizeVideoTimestampLabel(
          rawVideoTimestamp,
          normalizedVideoUrl
        );
        const extraTakeawayFields = toExtraFields(takeaway, TAKEAWAY_FIELDS);

        insertTakeaway.run(
          takeawayId,
          reviewId,
          sortOrder,
          toStringValue(takeaway.title),
          toStringValue(takeaway.description),
          normalizedTimestamp,
          normalizedVideoUrl,
          toStringValue(takeaway.video_context),
          toStringValue(takeaway.priority),
          toStringValue(takeaway.effort),
          toStringValue(takeaway.assigned_to),
          toStringValue(takeaway.status, "idea"),
          toStringValue(takeaway.notes),
          toStringValue(takeaway.github_issue),
          JSON.stringify(extraTakeawayFields),
          now,
          now,
        );

        sortOrder += 1;
      }
    }

    const parsedReviews = db
      .prepare("SELECT id FROM ideas_reviews ORDER BY id ASC")
      .all() as Array<{ id: string }>;
    const parsedTakeaways = db
      .prepare("SELECT id FROM ideas_takeaways ORDER BY id ASC")
      .all() as Array<{ id: string }>;

    const metaToPersist: IdeasMeta = {
      ...incomingMeta,
      last_updated: now,
      total_reviews: parsedReviews.length,
      next_review_id: Math.max(
        toNumberValue(incomingMeta.next_review_id, 0),
        computeNextSequenceFromIds(
          parsedReviews.map((row) => row.id),
          "review-"
        )
      ),
      next_takeaway_id: Math.max(
        toNumberValue(incomingMeta.next_takeaway_id, 0),
        computeNextSequenceFromIds(
          parsedTakeaways.map((row) => row.id),
          "tw-"
        )
      ),
    };

    db.prepare(
      `INSERT INTO ideas_meta (key, value_json, updated_at)
       VALUES (?, ?, ${NOW_SQL})
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = ${NOW_SQL}`
    ).run(IDEAS_META_KEY, JSON.stringify(metaToPersist));
  });

  writeTx();
  return buildStoreFromDb();
}

function maybeImportLegacyReviewsJsonSync(): boolean {
  if (!LEGACY_REVIEWS_PATH) {
    return false;
  }

  const db = getOrchestrationDb();
  const existing = db
    .prepare("SELECT COUNT(*) AS count FROM ideas_reviews")
    .get() as { count: number };

  if (existing.count > 0 || !fsSync.existsSync(LEGACY_REVIEWS_PATH)) {
    return false;
  }

  try {
    const raw = fsSync.readFileSync(LEGACY_REVIEWS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.reviews)) {
      return false;
    }

    persistStoreToDb(parsed);
    return true;
  } catch {
    return false;
  }
}

function syncTakeawayStatusInDb(input: {
  takeawayId: string;
  taskStatus: string;
}): { updated: boolean; skippedReason?: string } {
  const takeawayId = String(input.takeawayId ?? "").trim();
  if (!takeawayId) {
    return { updated: false, skippedReason: "missing_takeaway_id" };
  }

  const normalizedTaskStatus = normalizeLifecycleStatus(String(input.taskStatus ?? ""));
  const mappedStatus = TASK_TO_TAKEAWAY_STATUS[normalizedTaskStatus];
  if (!mappedStatus) {
    return { updated: false, skippedReason: "status_not_mapped" };
  }

  try {
    const db = getOrchestrationDb();
    maybeImportLegacyReviewsJsonSync();
    const takeaway = db
      .prepare("SELECT id, status FROM ideas_takeaways WHERE id = ? LIMIT 1")
      .get(takeawayId) as { id: string; status: string } | undefined;

    if (!takeaway) {
      return { updated: false, skippedReason: "takeaway_not_found" };
    }

    const currentStatus = String(takeaway.status ?? "").trim().toLowerCase();
    if (currentStatus === mappedStatus) {
      return { updated: false, skippedReason: "already_synced" };
    }

    const now = nowIso();
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE ideas_takeaways
         SET status = ?, updated_at = ?
         WHERE id = ?`
      ).run(mappedStatus, now, takeawayId);

      const existingMetaRow = db
        .prepare("SELECT value_json FROM ideas_meta WHERE key = ? LIMIT 1")
        .get(IDEAS_META_KEY) as { value_json: string } | undefined;
      const nextMeta = parseObjectJson(existingMetaRow?.value_json);
      nextMeta.last_updated = now;

      db.prepare(
        `INSERT INTO ideas_meta (key, value_json, updated_at)
         VALUES (?, ?, ${NOW_SQL})
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = ${NOW_SQL}`
      ).run(IDEAS_META_KEY, JSON.stringify(nextMeta));
    });

    tx();
    return { updated: true };
  } catch (error) {
    console.warn("[ideas] takeaway lifecycle sync skipped", {
      takeawayId,
      taskStatus: normalizedTaskStatus,
      reason: error instanceof Error ? error.message : String(error),
    });
    return { updated: false, skippedReason: "sync_failed" };
  }
}

export function syncTakeawayStatusFromTaskLifecycle(input: {
  takeawayId: string;
  taskStatus: string;
}): { updated: boolean; skippedReason?: string } {
  return syncTakeawayStatusInDb(input);
}

export async function syncTakeawayStatusFromTaskLifecycleAsync(input: {
  takeawayId: string;
  taskStatus: string;
}): Promise<{ updated: boolean; skippedReason?: string }> {
  return syncTakeawayStatusInDb(input);
}

export async function readReviews(): Promise<IdeasStoreShape> {
  maybeImportLegacyReviewsJsonSync();

  try {
    return buildStoreFromDb();
  } catch {
    return buildDefaultStore();
  }
}

export async function writeReviews(data: Record<string, unknown>): Promise<void> {
  persistStoreToDb(data);
}
