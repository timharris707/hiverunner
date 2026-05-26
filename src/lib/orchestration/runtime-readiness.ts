export const EXECUTABLE_AGENT_RUNTIME_ADAPTERS = new Set([
  "openclaw",
  "codex",
  "anthropic",
  "hermes",
  "gemini",
  "symphony",
]);

export function normalizeRuntimeAdapter(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized || "manual";
}

export function isExecutableAgentRuntime(value: string | null | undefined): boolean {
  return EXECUTABLE_AGENT_RUNTIME_ADAPTERS.has(normalizeRuntimeAdapter(value));
}

export function runtimeProviderLabel(value: string | null | undefined): string {
  const normalized = normalizeRuntimeAdapter(value);
  switch (normalized) {
    case "openclaw":
      return "OpenClaw";
    case "codex":
      return "Codex";
    case "anthropic":
      return "Anthropic";
    case "hermes":
      return "Hermes";
    case "gemini":
      return "Gemini";
    case "symphony":
      return "External runner";
    case "manual":
      return "Manual";
    default:
      return normalized;
  }
}

export function nonExecutableRuntimeReason(value: string | null | undefined): string | null {
  const normalized = normalizeRuntimeAdapter(value);
  if (isExecutableAgentRuntime(normalized)) return null;
  if (normalized === "manual") {
    return "manual/no executable runtime attached";
  }
  return `unsupported runtime adapter '${normalized}'`;
}

export function assertExecutableAgentRuntime(input: {
  agentName: string;
  adapterType: string | null | undefined;
}): void {
  const reason = nonExecutableRuntimeReason(input.adapterType);
  if (!reason) return;
  throw new Error(
    `assignee_not_executable_runtime: ${input.agentName} is ${reason}. Attach an external runner, Codex, Anthropic, Gemini, Hermes, or OpenClaw before assigning autonomous work.`,
  );
}
