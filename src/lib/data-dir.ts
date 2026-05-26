/**
 * data-dir.ts - Single source of truth for the HiveRunner data directory.
 *
 * Controls where SQLite databases (orchestration.db, tasks.db, activities.db,
 * usage-tracking.db) are stored. Each lane sets MC_DATA_DIR in its start script:
 *
 *   Stable (:3001) -> MC_DATA_DIR=$MC_APP_ROOT/data
 *   Dev    (:3010) -> MC_DATA_DIR=$MC_APP_ROOT/data-dev
 *
 * When MC_DATA_DIR is not set, falls back to MC_APP_ROOT/data. If MC_APP_ROOT
 * is also unset, the final legacy fallback is process.cwd().
 */
import { resolveHiveRunnerAppRoot, resolveHiveRunnerDataDir } from "./runtime-paths";

const DEFAULT_DATA_DIR = resolveHiveRunnerDataDir({
  ...process.env,
  MC_DATA_DIR: undefined,
});

export const MC_DATA_DIR = process.env.MC_DATA_DIR
  ? resolveHiveRunnerDataDir(process.env)
  : DEFAULT_DATA_DIR;

export const MC_APP_ROOT = resolveHiveRunnerAppRoot();

/**
 * True when MC_DATA_DIR resolves to a non-default directory (e.g., data-dev).
 * Used to suppress legacy JSON backfill so non-default data directories
 * start with a clean slate instead of importing shared JSON from data/.
 *
 * The stable lane sets MC_DATA_DIR=$MC_APP_ROOT/data explicitly — that resolves
 * to the same path as the default, so MC_DATA_DIR_IS_NON_DEFAULT is false
 * and JSON backfill still works for stable.
 */
export const MC_DATA_DIR_IS_NON_DEFAULT = MC_DATA_DIR !== DEFAULT_DATA_DIR;
