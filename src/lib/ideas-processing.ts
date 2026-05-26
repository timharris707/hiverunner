interface TakeawayLike {
  status?: unknown;
  notes?: unknown;
  github_issue?: unknown;
}

export interface ReviewLike {
  [key: string]: unknown;
  status?: unknown;
  summary?: unknown;
  assessment?: unknown;
  takeaways?: unknown;
}

const TIMESTAMP_COLON_PATTERN = /^(\d{1,2}:)?\d{1,2}:\d{1,2}$|^\d{1,2}:\d{1,2}$/;
const TIMESTAMP_COMPACT_PATTERN = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i;

export function takeawayHasTask(takeaway: TakeawayLike) {
  const status = String(takeaway.status || "").toLowerCase();
  const notes = String(takeaway.notes || "");
  return (
    Boolean(takeaway.github_issue) ||
    /task created:/i.test(notes) ||
    ["approved", "building", "shipped"].includes(status)
  );
}

export function reviewIsFullyProcessed(review: ReviewLike) {
  const takeaways = Array.isArray(review.takeaways) ? review.takeaways as TakeawayLike[] : [];
  if (!review.summary || !review.assessment || takeaways.length === 0) {
    return false;
  }

  return takeaways.every((takeaway) => {
    const status = String(takeaway.status || "").toLowerCase();
    return status === "rejected" || takeawayHasTask(takeaway);
  });
}

export function getUnprocessedReviewIds<T extends ReviewLike>(reviews: T[]) {
  return reviews
    .filter((review) => String(review.status || "active").toLowerCase() === "active")
    .filter((review) => !reviewIsFullyProcessed(review));
}

export function parseVideoTimestampSeconds(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) ? seconds : null;
  }

  if (TIMESTAMP_COLON_PATTERN.test(raw)) {
    const parts = raw.split(":").map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part))) return null;
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }

  const compact = raw.replace(/\s+/g, "");
  const match = compact.match(TIMESTAMP_COMPACT_PATTERN);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : null;
}

export function formatVideoTimestampFromSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function extractTimestampFromUrl(url: string): number | null {
  try {
    const parsed = new URL(url);
    const t =
      parsed.searchParams.get("t") ??
      parsed.searchParams.get("start") ??
      parsed.searchParams.get("time_continue");
    if (!t) return null;
    return parseVideoTimestampSeconds(t);
  } catch {
    return null;
  }
}

export function buildTimestampedVideoUrl(videoUrl: unknown, timestamp: unknown): string {
  const rawUrl = String(videoUrl ?? "").trim();
  if (!rawUrl) return "";

  const seconds = parseVideoTimestampSeconds(timestamp);
  if (!seconds) return rawUrl;

  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.searchParams.has("t") ||
      parsed.searchParams.has("start") ||
      parsed.searchParams.has("time_continue")
    ) {
      return parsed.toString();
    }
    parsed.searchParams.set("t", String(seconds));
    return parsed.toString();
  } catch {
    const separator = rawUrl.includes("?") ? "&" : "?";
    return `${rawUrl}${separator}t=${seconds}`;
  }
}

export function normalizeVideoTimestampLabel(timestamp: unknown, videoUrl: unknown): string {
  const fromTimestamp = parseVideoTimestampSeconds(timestamp);
  if (fromTimestamp !== null) {
    return formatVideoTimestampFromSeconds(fromTimestamp);
  }

  const fromUrl = extractTimestampFromUrl(String(videoUrl ?? "").trim());
  if (fromUrl !== null) {
    return formatVideoTimestampFromSeconds(fromUrl);
  }

  return "";
}
