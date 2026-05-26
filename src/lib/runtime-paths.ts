import path from "path";

function resolveConfiguredAbsolute(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

export function resolveHiveRunnerAppRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveConfiguredAbsolute(env.MC_APP_ROOT) ?? path.resolve(process.cwd());
}

export function resolveHiveRunnerAppRootSource(
  env: NodeJS.ProcessEnv = process.env,
): "MC_APP_ROOT" | "process.cwd()" {
  return resolveConfiguredAbsolute(env.MC_APP_ROOT) ? "MC_APP_ROOT" : "process.cwd()";
}

export function resolveHiveRunnerDataDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    resolveConfiguredAbsolute(env.MC_DATA_DIR) ??
    path.join(resolveHiveRunnerAppRoot(env), "data")
  );
}

export function resolveHiveRunnerLogDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    resolveConfiguredAbsolute(env.MC_LOG_DIR) ??
    path.join(resolveHiveRunnerAppRoot(env), "data")
  );
}

export function resolveHiveRunnerStableDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveHiveRunnerAppRoot(env), ".stable");
}
