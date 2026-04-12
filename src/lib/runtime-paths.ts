import path from "path";

function resolveConfiguredAbsolute(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

export function resolveMissionControlAppRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveConfiguredAbsolute(env.MC_APP_ROOT) ?? path.resolve(process.cwd());
}

export function resolveMissionControlAppRootSource(
  env: NodeJS.ProcessEnv = process.env,
): "MC_APP_ROOT" | "process.cwd()" {
  return resolveConfiguredAbsolute(env.MC_APP_ROOT) ? "MC_APP_ROOT" : "process.cwd()";
}

export function resolveMissionControlDataDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    resolveConfiguredAbsolute(env.MC_DATA_DIR) ??
    path.join(resolveMissionControlAppRoot(env), "data")
  );
}

export function resolveMissionControlLogDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    resolveConfiguredAbsolute(env.MC_LOG_DIR) ??
    path.join(resolveMissionControlAppRoot(env), "data")
  );
}

export function resolveMissionControlStableDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveMissionControlAppRoot(env), ".stable");
}
