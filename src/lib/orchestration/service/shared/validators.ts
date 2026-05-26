import { createHash } from "crypto";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { formatOperatorTaskStatusLabel } from "@/lib/orchestration/status-copy";

import { DEFAULT_STALE_ALERT_THRESHOLDS_HOURS, toApiStatus } from "./mappers";
import type {
  DbTaskStatus,
  ProjectSettings,
  StaleAlertThresholds,
} from "./types";

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item));
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function readWorkspaceSourceRoot(parsed: Record<string, unknown>): string | null {
  const workspace =
    parsed.workspace &&
    typeof parsed.workspace === "object" &&
    !Array.isArray(parsed.workspace)
      ? parsed.workspace as Record<string, unknown>
      : null;
  const candidate =
    typeof workspace?.sourceRoot === "string"
      ? workspace.sourceRoot
      : typeof parsed.sourceWorkspaceRoot === "string"
        ? parsed.sourceWorkspaceRoot
        : "";
  return candidate.trim() || null;
}

function parseProjectSettings(value: string | null | undefined): ProjectSettings {
  const parsed = (() => {
    if (!value) return {};
    try {
      const json = JSON.parse(value) as unknown;
      if (!json || typeof json !== "object" || Array.isArray(json)) return {};
      return json as Record<string, unknown>;
    } catch {
      return {};
    }
  })();

  const thresholdsRaw =
    parsed.staleAlertThresholdsHours &&
    typeof parsed.staleAlertThresholdsHours === "object" &&
    !Array.isArray(parsed.staleAlertThresholdsHours)
      ? (parsed.staleAlertThresholdsHours as Record<string, unknown>)
      : {};

  const thresholds: StaleAlertThresholds = {
    review:
      asNonNegativeNumber(thresholdsRaw.review) ??
      DEFAULT_STALE_ALERT_THRESHOLDS_HOURS.review,
    inProgress:
      asNonNegativeNumber(thresholdsRaw.inProgress) ??
      DEFAULT_STALE_ALERT_THRESHOLDS_HOURS.inProgress,
    blocked:
      asNonNegativeNumber(thresholdsRaw.blocked) ??
      DEFAULT_STALE_ALERT_THRESHOLDS_HOURS.blocked,
  };

  return {
    emoji:
      typeof parsed.emoji === "string" && parsed.emoji.trim()
        ? parsed.emoji
        : "🛰️",
    sourceWorkspaceRoot: readWorkspaceSourceRoot(parsed),
    staleAlertThresholdsHours: thresholds,
    extra: parsed,
  };
}

function encodeActivityCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
}

/**
 * Generates a deterministic UUID v4-format string from a composite event key.
 * Used so sprint synthetic events always return a valid UUID as their public `id`.
 */
function deterministicEventId(compositeKey: string): string {
  const h = createHash("sha256").update(compositeKey).digest("hex");
  const variantNibble = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variantNibble}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function decodeActivityCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const splitAt = decoded.lastIndexOf("|");
    if (splitAt <= 0 || splitAt >= decoded.length - 1) {
      throw new Error("Malformed cursor");
    }
    const createdAt = decoded.slice(0, splitAt);
    const id = decoded.slice(splitAt + 1);
    if (!createdAt || !id) {
      throw new Error("Malformed cursor");
    }
    return { createdAt, id };
  } catch {
    throw new OrchestrationApiError(400, "invalid_cursor", "Invalid activity cursor");
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function validateTransition(
  db: Database.Database,
  fromStatus: DbTaskStatus,
  toStatus: DbTaskStatus,
  hasAssignee: boolean,
  reviewNotes: string | null
): void {
  if (fromStatus === toStatus) return;

  const rule = db
    .prepare(
      `SELECT requires_assignee, requires_review
       FROM status_transition_rules
       WHERE from_status = ? AND to_status = ?`
    )
    .get(fromStatus, toStatus) as
    | {
        requires_assignee: number;
        requires_review: number;
      }
    | undefined;

  if (!rule) {
    const fromLabel = formatOperatorTaskStatusLabel(toApiStatus(fromStatus)) ?? toApiStatus(fromStatus);
    const toLabel = formatOperatorTaskStatusLabel(toApiStatus(toStatus)) ?? toApiStatus(toStatus);
    throw new OrchestrationApiError(
      400,
      "invalid_transition",
      `Task transition ${fromLabel} -> ${toLabel} is not allowed`
    );
  }

  if (rule.requires_assignee === 1 && !hasAssignee) {
    throw new OrchestrationApiError(
      400,
      "assignee_required",
      "This status transition requires an assignee"
    );
  }

  if (rule.requires_review === 1 && (!reviewNotes || !reviewNotes.trim())) {
    throw new OrchestrationApiError(
      400,
      "review_notes_required",
      "This status transition requires review notes"
    );
  }
}

export {
  decodeActivityCursor,
  deterministicEventId,
  encodeActivityCursor,
  parseJsonArray,
  parseJsonObject,
  parseProjectSettings,
  slugify,
  validateTransition,
};
