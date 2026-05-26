export type OrchestrationExecutionProvider =
  | "manual"
  | "openclaw"
  | "codex"
  | "anthropic"
  | "hermes"
  | "gemini"
  | "symphony";

const DEFAULT_PROVIDER: OrchestrationExecutionProvider = "manual";

export function getOrchestrationExecutionProvider(
  env: NodeJS.ProcessEnv = process.env
): OrchestrationExecutionProvider {
  const raw = (
    env.ORCHESTRATION_EXECUTION_PROVIDER ??
    env.ORCHESTRATION_EXECUTION_BACKEND ??
    ""
  )
    .trim()
    .toLowerCase();

  if (raw === "codex") {
    return "codex";
  }
  if (raw === "anthropic") {
    return "anthropic";
  }
  if (raw === "hermes") {
    return "hermes";
  }
  if (raw === "gemini") {
    return "gemini";
  }
  if (raw === "symphony") {
    return "symphony";
  }
  if (raw === "openclaw") {
    return "openclaw";
  }
  if (raw === "manual") {
    return "manual";
  }
  return DEFAULT_PROVIDER;
}
