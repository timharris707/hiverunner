import os from "os";
import path from "path";

export type HiveRunnerLane = "dev" | "stable";

function resolveConfiguredAbsolute(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function resolveHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME?.trim() || os.homedir();
}

export function resolveOpenClawDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolveConfiguredAbsolute(env.OPENCLAW_DIR) ?? path.join(resolveHomeDir(env), ".openclaw");
}

export function resolveOpenClawWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  return (
    resolveConfiguredAbsolute(env.OPENCLAW_WORKSPACE_ROOT) ??
    path.join(resolveOpenClawDir(env), "workspace")
  );
}

export function resolveHiveRunnerLane(
  env: NodeJS.ProcessEnv = process.env,
): HiveRunnerLane {
  const configuredWorkspaceRoot = resolveConfiguredAbsolute(env.MC_WORKSPACE_ROOT);
  if (configuredWorkspaceRoot) {
    if (configuredWorkspaceRoot.includes(`${path.sep}.hiverunner${path.sep}dev${path.sep}`)) {
      return "dev";
    }
    if (configuredWorkspaceRoot.includes(`${path.sep}.hiverunner${path.sep}stable${path.sep}`)) {
      return "stable";
    }
  }

  const configuredDataDir = resolveConfiguredAbsolute(env.MC_DATA_DIR);
  if (configuredDataDir) {
    const baseName = path.basename(configuredDataDir);
    if (baseName === "data-dev") {
      return "dev";
    }
    if (baseName === "data") {
      return "stable";
    }
  }

  if (env.NODE_ENV === "development") {
    return "dev";
  }

  return "stable";
}

export function resolveDefaultHiveRunnerWorkspaceRoot(
  _lane: HiveRunnerLane,
  env: NodeJS.ProcessEnv = process.env,
): string {
  void _lane;
  return path.join(resolveHomeDir(env), ".hiverunner", "workspace");
}

export function resolveHiveRunnerWorkspaceRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    resolveConfiguredAbsolute(env.MC_WORKSPACE_ROOT) ??
    resolveDefaultHiveRunnerWorkspaceRoot(resolveHiveRunnerLane(env), env)
  );
}

export function resolveHiveRunnerWorkspaceRootSource(
  env: NodeJS.ProcessEnv = process.env,
): "MC_WORKSPACE_ROOT" | "default" {
  return resolveConfiguredAbsolute(env.MC_WORKSPACE_ROOT) ? "MC_WORKSPACE_ROOT" : "default";
}
