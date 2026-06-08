const EXTERNAL_RUNNER_ENV_DENYLIST = [
  "HIVERUNNER_RUNTIME_PROMOTION_DB",
  "HIVERUNNER_EPHEMERAL_DATA_DIR",
  "MC_API_KEY",
  "MC_APP_ROOT",
  "MC_DATA_DIR",
  "MC_DEV_EXECUTION_TEST_MODE",
  "MC_ENGINE_TICK",
  "MC_LOG_DIR",
  "MC_SWEEP_COMPANIES",
  "MC_SWEEP_INTERVAL_MS",
  "MC_TICK_MAX_CONCURRENT",
  "MC_WORKSPACE_ROOT",
  "ORCHESTRATION_DB_PATH",
  "PORT",
  "WORKSPACE_ROOT",
] as const;

export function buildExternalRunnerEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const key of EXTERNAL_RUNNER_ENV_DENYLIST) {
    delete env[key];
  }
  return {
    ...env,
    ...overrides,
  };
}
