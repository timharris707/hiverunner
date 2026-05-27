function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function normalizeText(input: unknown): string | null {
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (trimmed === "[object Object]") return null;
  return trimmed.length > 0 ? trimmed : null;
}

function readSafeErrorMessage(input: unknown, depth = 0): string | null {
  if (depth > 3 || input == null) return null;

  if (typeof input === "string") {
    return normalizeText(input);
  }

  if (input instanceof Error) {
    return normalizeText(input.message);
  }

  if (!isRecord(input)) return null;

  for (const key of ["message", "error", "detail", "details", "reason", "setupHint", "setup"]) {
    const nested = readSafeErrorMessage(input[key], depth + 1);
    if (nested) return nested;
  }

  return null;
}

function readSetupMessage(input: unknown, depth = 0): string | null {
  if (depth > 3 || input == null) return null;

  const direct = normalizeText(input);
  if (direct) return direct;

  if (Array.isArray(input)) {
    const parts = input
      .map((entry) => readSetupMessage(entry, depth + 1))
      .filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? parts.join(" ") : null;
  }

  if (!isRecord(input)) return null;

  const note = readSetupMessage(input.note, depth + 1);
  const setupHint = readSetupMessage(input.setupHint, depth + 1);
  const steps = readSetupMessage(input.steps, depth + 1);
  const parts = [note, setupHint, steps].filter((entry): entry is string => Boolean(entry));
  return parts.length > 0 ? parts.join(" ") : null;
}

export function normalizeSafeErrorMessage(input: unknown, fallback: string): string {
  const message = readSafeErrorMessage(input) ?? fallback;
  const setup = isRecord(input) ? readSetupMessage(input.setup) : null;
  if (!setup || message.includes(setup)) {
    return message;
  }

  const separator = /[.!?]$/.test(message) ? " " : ". ";
  return `${message}${separator}${setup}`;
}

export function normalizeAvatarWizardErrorMessage(input: unknown, fallback: string): string {
  return normalizeSafeErrorMessage(input, fallback);
}
