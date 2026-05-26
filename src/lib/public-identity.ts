export const PUBLIC_HUMAN_LABEL = "Local Owner";
export const PUBLIC_HUMAN_ROLE = "operator";
export const PUBLIC_HUMAN_EVENT_ROLE = "supervisor";
export const PUBLIC_HUMAN_EMOJI = "👤";
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

export function isHumanActor(value: string | null | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return isLegacyHumanActor(normalized)
    || normalized === PUBLIC_HUMAN_LABEL.toLowerCase()
    || normalized === PUBLIC_HUMAN_ROLE;
}

export function publicHumanDisplayName(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed || isLegacyHumanActor(trimmed)) return PUBLIC_HUMAN_LABEL;
  return trimmed;
}

export function publicCompanyDisplayName(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed || PUBLIC_COMPANY_LABEL;
}
