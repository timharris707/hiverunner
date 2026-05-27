import { normalizeAvatarWizardErrorMessage } from "@/lib/orchestration/avatar-wizard-errors";

export interface AvatarProviderStatusView {
  provider: "local" | "openai" | "replicate";
  label: string;
  aiAvailable: boolean;
  setupHint?: string;
}

const FALLBACK_PROVIDER_STATUS: AvatarProviderStatusView = {
  provider: "local",
  label: "AI image generation unavailable",
  aiAvailable: false,
  setupHint:
    "To enable generated portrait avatars, add OPENAI_API_KEY via environment config or local keychain integration. Otherwise use a basic icon.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePreviewSource(value: unknown): string | null {
  const direct = readTrimmedString(value);
  if (direct) return direct;

  if (!isRecord(value)) return null;

  const nested =
    readTrimmedString(value.url) ??
    readTrimmedString(value.src) ??
    readTrimmedString(value.imageUrl) ??
    readTrimmedString(value.image_url);
  if (nested) return nested;

  const b64 = readTrimmedString(value.b64_json) ?? readTrimmedString(value.base64);
  if (!b64) return null;
  return b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
}

export function normalizeAvatarProviderStatus(input: unknown): AvatarProviderStatusView {
  if (!isRecord(input)) {
    return FALLBACK_PROVIDER_STATUS;
  }

  const provider = readTrimmedString(input.provider);
  const label = readTrimmedString(input.label);
  const aiAvailable = typeof input.aiAvailable === "boolean" ? input.aiAvailable : provider === "openai";
  const setupHint = normalizeAvatarWizardErrorMessage(input.setupHint ?? input.error ?? input.details, "");

  if (provider === "openai") {
    return {
      provider,
      label: label ?? "OpenAI (DALL-E)",
      aiAvailable,
      ...(aiAvailable ? {} : { setupHint: setupHint || FALLBACK_PROVIDER_STATUS.setupHint }),
    };
  }

  if (provider === "replicate") {
    return {
      provider,
      label: label ?? "Replicate (not implemented)",
      aiAvailable: false,
      setupHint:
        setupHint ||
        "Replicate avatar generation is not implemented in this build. Add OPENAI_API_KEY to enable generated portraits.",
    };
  }

  if (provider === "local") {
    return {
      provider,
      label: label ?? FALLBACK_PROVIDER_STATUS.label,
      aiAvailable: false,
      setupHint: setupHint || FALLBACK_PROVIDER_STATUS.setupHint,
    };
  }

  return {
    ...FALLBACK_PROVIDER_STATUS,
    ...(setupHint ? { setupHint } : {}),
  };
}

export function normalizeAvatarPreviewResponse(input: unknown): { previews: string[]; error?: string } {
  if (!isRecord(input)) {
    return { previews: [] };
  }

  const rawPreviewList = Array.isArray(input.previews)
    ? input.previews
    : Array.isArray(input.images)
      ? input.images
      : Array.isArray(input.data)
        ? input.data
        : [];
  const previews = rawPreviewList
    .map(normalizePreviewSource)
    .filter((value): value is string => Boolean(value));
  const error = normalizeAvatarWizardErrorMessage(input.error ?? input, "");

  return {
    previews,
    ...(error ? { error } : {}),
  };
}
