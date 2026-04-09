/**
 * data-dir.ts — Single source of truth for the Mission Control data directory.
 *
 * Controls where SQLite databases (orchestration.db, tasks.db, activities.db,
 * usage-tracking.db) are stored. Each lane sets MC_DATA_DIR in its start script:
 *
 *   Stable (:3001) → MC_DATA_DIR=$APP_DIR/data      (production data)
 *   Dev    (:3010) → MC_DATA_DIR=$APP_DIR/data-dev   (isolated dev data)
 *
 * When MC_DATA_DIR is not set, falls back to process.cwd()/data (legacy default).
 */
import path from "path";

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");

export const MC_DATA_DIR = process.env.MC_DATA_DIR
  ? path.resolve(process.env.MC_DATA_DIR)
  : DEFAULT_DATA_DIR;

/**
 * True when MC_DATA_DIR resolves to a non-default directory (e.g., data-dev).
 * Used to suppress legacy JSON backfill so non-default data directories
 * start with a clean slate instead of importing shared JSON from data/.
 *
 * The stable lane sets MC_DATA_DIR=$APP_DIR/data explicitly — that resolves
 * to the same path as the default, so MC_DATA_DIR_IS_NON_DEFAULT is false
 * and JSON backfill still works for stable.
 */
export const MC_DATA_DIR_IS_NON_DEFAULT = MC_DATA_DIR !== DEFAULT_DATA_DIR;
