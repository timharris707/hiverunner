const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  "to-do": "To-Do",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

function normalizeStatusToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) {
    return null;
  }

  switch (normalized) {
    case "on deck":
    case "to do":
      return "to-do";
    case "in progress":
      return "in-progress";
    default:
      return normalized;
  }
}

export function formatOperatorTaskStatusLabel(value: string | null | undefined): string | null {
  const normalized = normalizeStatusToken(value);
  if (!normalized) {
    return null;
  }

  return STATUS_LABELS[normalized] ?? value?.trim() ?? null;
}

export function replaceTaskStatusTokensInText(value: string): string {
  return value
    .replace(/\bon[_ -]?deck\b/gi, "To-Do")
    .replace(/\bto[_ -]?do\b/gi, "To-Do")
    .replace(/\bin[_ -]?progress\b/gi, "In Progress");
}
