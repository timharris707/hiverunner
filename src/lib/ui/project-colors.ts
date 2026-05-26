export const PROJECT_COLOR_PALETTE = [
  "#0ea5e9",
  "#14b8a6",
  "#f97316",
  "#a855f7",
  "#22c55e",
  "#e11d48",
  "#f59e0b",
  "#38bdf8",
  "#8b5cf6",
  "#ec4899",
  "#84cc16",
  "#06b6d4",
] as const;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isProjectHexColor(value: string | null | undefined): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value.trim());
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function suggestProjectColor(seed: string, usedColors: Iterable<string> = []): string {
  const used = new Set(Array.from(usedColors, (color) => color.toLowerCase()));
  const start = hashString(seed || "project") % PROJECT_COLOR_PALETTE.length;

  for (let offset = 0; offset < PROJECT_COLOR_PALETTE.length; offset += 1) {
    const color = PROJECT_COLOR_PALETTE[(start + offset) % PROJECT_COLOR_PALETTE.length];
    if (!used.has(color.toLowerCase())) return color;
  }

  return PROJECT_COLOR_PALETTE[start];
}

export function distinctProjectColor<T extends { id: string; slug?: string; name?: string; color?: string }>(
  project: T,
  usedColors: Set<string>,
): string {
  const stored = project.color?.trim();
  const normalized = stored?.toLowerCase();

  if (isProjectHexColor(stored) && normalized && !usedColors.has(normalized)) {
    usedColors.add(normalized);
    return stored;
  }

  const color = suggestProjectColor(project.slug || project.name || project.id, usedColors);
  usedColors.add(color.toLowerCase());
  return color;
}
