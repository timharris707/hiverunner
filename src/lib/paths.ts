import path from 'path';

import { resolveHiveRunnerDataDir } from "@/lib/runtime-paths";
import {
  resolveHiveRunnerWorkspaceRoot,
  resolveOpenClawDir,
  resolveOpenClawWorkspaceRoot,
} from "@/lib/workspaces/root";

/**
 * Centralized path configuration.
 * HiveRunner defaults to HiveRunner-owned workspace/data roots. OpenClaw
 * paths remain exported for explicit OpenClaw runtime integration only.
 */
export const OPENCLAW_DIR = resolveOpenClawDir();
export const OPENCLAW_WORKSPACE = process.env.OPENCLAW_WORKSPACE || resolveOpenClawWorkspaceRoot();
export const OPENCLAW_CONFIG = path.join(OPENCLAW_DIR, 'openclaw.json');
export const OPENCLAW_MEDIA = path.join(OPENCLAW_DIR, 'media');

export const HIVE_RUNNER_WORKSPACE = resolveHiveRunnerWorkspaceRoot();
export const HIVE_RUNNER_MEDIA = path.join(resolveHiveRunnerDataDir(), 'media');

export const WORKSPACE_IDENTITY = path.join(HIVE_RUNNER_WORKSPACE, 'IDENTITY.md');
export const WORKSPACE_TOOLS = path.join(HIVE_RUNNER_WORKSPACE, 'TOOLS.md');
export const WORKSPACE_MEMORY = path.join(HIVE_RUNNER_WORKSPACE, 'memory');

export const SYSTEM_SKILLS_PATH = '/usr/lib/node_modules/openclaw/skills';
export const WORKSPACE_SKILLS_PATH = path.join(HIVE_RUNNER_WORKSPACE, 'skills');

/** Allowed base paths for media/file serving */
export const ALLOWED_MEDIA_PREFIXES = [
  path.join(HIVE_RUNNER_WORKSPACE, '/'),
  path.join(HIVE_RUNNER_MEDIA, '/'),
  path.join(OPENCLAW_WORKSPACE, '/'),
  path.join(OPENCLAW_MEDIA, '/'),
];
