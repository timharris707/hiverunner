export const PUBLIC_HUMAN_LABEL = "Local Owner";
export const PUBLIC_ASSISTANT_LABEL = "Assistant";
export const PUBLIC_COMPANY_LABEL = "current HiveRunner workspace";

const LEGACY_HUMAN_LABELS = new Set([
  "tim",
  "tim-local",
  "tim harris",
]);

export function isLegacyHumanActor(value: string | null | undefined): boolean {
  return LEGACY_HUMAN_LABELS.has((value ?? "").trim().toLowerCase());
}

export function publicHumanDisplayName(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed || isLegacyHumanActor(trimmed)) return PUBLIC_HUMAN_LABEL;
  return trimmed;
}
