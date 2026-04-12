import os from "os";
import path from "path";

export type MissionControlLane = "dev" | "stable";

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

export function resolveMissionControlLane(
  env: NodeJS.ProcessEnv = process.env,
): MissionControlLane {
  const configuredWorkspaceRoot = resolveConfiguredAbsolute(env.MC_WORKSPACE_ROOT);
  if (configuredWorkspaceRoot) {
    if (configuredWorkspaceRoot.includes(`${path.sep}.mission-control${path.sep}dev${path.sep}`)) {
      return "dev";
    }
    if (configuredWorkspaceRoot.includes(`${path.sep}.mission-control${path.sep}stable${path.sep}`)) {
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

export function resolveDefaultMissionControlWorkspaceRoot(
  lane: MissionControlLane,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveHomeDir(env), ".mission-control", lane, "workspaces");
}

export function resolveMissionControlWorkspaceRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    resolveConfiguredAbsolute(env.MC_WORKSPACE_ROOT) ??
    resolveDefaultMissionControlWorkspaceRoot(resolveMissionControlLane(env), env)
  );
}

export function resolveMissionControlWorkspaceRootSource(
  env: NodeJS.ProcessEnv = process.env,
): "MC_WORKSPACE_ROOT" | "default" {
  return resolveConfiguredAbsolute(env.MC_WORKSPACE_ROOT) ? "MC_WORKSPACE_ROOT" : "default";
}
