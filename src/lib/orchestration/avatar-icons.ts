export const AVATAR_ICON_PREFIX = "icon:";

const PLACEHOLDER_SYMBOLS = new Set(["", "pixel", "🤖"]);

export function toAvatarIconToken(iconKey: string): string {
  return `${AVATAR_ICON_PREFIX}${iconKey}`;
}

export function isAvatarIconToken(symbol: string | null | undefined): boolean {
  return Boolean(symbol?.trim().startsWith(AVATAR_ICON_PREFIX));
}

export function avatarDisplaySymbol(
  symbol: string | null | undefined,
  fallback = "",
): string {
  const trimmed = symbol?.trim() ?? "";
  if (!trimmed || isAvatarIconToken(trimmed)) return fallback;
  return trimmed;
}

export function agentDisplayLabel(
  symbol: string | null | undefined,
  name: string,
): string {
  const displaySymbol = avatarDisplaySymbol(symbol);
  return displaySymbol ? `${displaySymbol} ${name}` : name;
}

export function defaultAgentIconKey(role: string | null | undefined): string {
  const normalized = role?.toLowerCase() ?? "";

  if (/\b(ceo|chief|founder|president|lead|director|head)\b/.test(normalized)) return "crown";
  if (/\b(quant|analytic|analyst|finance|market|metric|data|report)\b/.test(normalized)) return "bar-chart";
  if (/\b(ops|operation|coordinator|manager|orchestrat|workflow|heartbeat)\b/.test(normalized)) return "activity";
  if (/\b(engineer|developer|software|frontend|backend|full-stack|code|architect)\b/.test(normalized)) return "code";
  if (/\b(qa|quality|test|verification|verify|audit)\b/.test(normalized)) return "test-tube";
  if (/\b(research|scout|discover|investigat|search)\b/.test(normalized)) return "telescope";
  if (/\b(design|creative|brand|visual|ui|ux)\b/.test(normalized)) return "palette";
  if (/\b(security|risk|compliance|guard|review|gate)\b/.test(normalized)) return "shield";
  if (/\b(infra|platform|systems|devops|database|server)\b/.test(normalized)) return "server";
  if (/\b(voice|audio|call|speech)\b/.test(normalized)) return "mic";

  return "bot";
}

export function defaultAgentIconToken(role: string | null | undefined): string {
  return toAvatarIconToken(defaultAgentIconKey(role));
}

export function normalizeAgentSymbol(
  symbol: string | null | undefined,
  role: string | null | undefined,
): string {
  const trimmed = symbol?.trim() ?? "";
  if (PLACEHOLDER_SYMBOLS.has(trimmed)) return defaultAgentIconToken(role);
  return trimmed.startsWith(AVATAR_ICON_PREFIX) ? trimmed : defaultAgentIconToken(role);
}
