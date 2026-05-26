export function formatRelativeTime(
  value: string | number | Date | null | undefined,
  now = Date.now(),
  options?: { compact?: boolean },
): string {
  if (value === null || value === undefined) return "";
  const timestamp = value instanceof Date ? value.getTime() : typeof value === "number" ? value : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";

  const diffMs = Math.max(0, now - timestamp);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 45) return options?.compact ? "now" : "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return options?.compact ? `${minutes}m ago` : `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return options?.compact ? `${hours}h ago` : `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (options?.compact) return `${days}d ago`;
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
