export type OrchestrationExecutionProvider = "openclaw" | "paperclip" | "codex";

const DEFAULT_PROVIDER: OrchestrationExecutionProvider = "openclaw";

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

  if (raw === "paperclip") {
    return "paperclip";
  }
  if (raw === "codex") {
    return "codex";
  }
  if (raw === "openclaw") {
    return "openclaw";
  }
  return DEFAULT_PROVIDER;
}

export function isPaperclipBridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return getOrchestrationExecutionProvider(env) === "paperclip";
}
