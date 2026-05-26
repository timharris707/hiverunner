import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";

type ManagedEnvKey = "MC_WORKSPACE_ROOT" | "OPENCLAW_DIR" | "OPENCLAW_WORKSPACE_ROOT";

type OrchestrationWorkspaceIsolationOptions = {
  prefix?: string;
};

type CompanyWorkspaceRow = {
  id: string;
  slug: string;
  workspace_slug: string | null;
  runtime_slug: string | null;
};

export type OrchestrationWorkspaceIsolation = {
  tempRoot: string;
  workspaceRoot: string;
  openClawDir: string;
  openClawWorkspaceRoot: string;
  syncDatabase: (db: Database.Database) => void;
  dispose: () => void;
};

const ENV_KEYS: ManagedEnvKey[] = [
  "MC_WORKSPACE_ROOT",
  "OPENCLAW_DIR",
  "OPENCLAW_WORKSPACE_ROOT",
];

function restoreEnv(previousEnv: Record<ManagedEnvKey, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const previousValue = previousEnv[key];
    if (previousValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previousValue;
    }
  }
}

function normalizeWorkspacePart(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/'/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "company";
}

export function createIsolatedOrchestrationWorkspace(
  options: OrchestrationWorkspaceIsolationOptions = {},
): OrchestrationWorkspaceIsolation {
  const prefix = options.prefix ?? "mc-orchestration-test-";
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  const workspaceRoot = path.join(tempRoot, "workspaces");
  const openClawDir = path.join(tempRoot, "openclaw");
  const openClawWorkspaceRoot = path.join(openClawDir, "workspace");
  const previousEnv = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<ManagedEnvKey, string | undefined>;
  let disposed = false;

  mkdirSync(path.join(workspaceRoot, "companies"), { recursive: true });
  mkdirSync(openClawWorkspaceRoot, { recursive: true });

  process.env.MC_WORKSPACE_ROOT = workspaceRoot;
  process.env.OPENCLAW_DIR = openClawDir;
  process.env.OPENCLAW_WORKSPACE_ROOT = openClawWorkspaceRoot;

  function syncDatabase(db: Database.Database): void {
    const companiesRoot = path.join(workspaceRoot, "companies");
    mkdirSync(companiesRoot, { recursive: true });

    const rows = db
      .prepare(
        `SELECT id, slug, workspace_slug, runtime_slug
         FROM companies
         WHERE archived_at IS NULL`,
      )
      .all() as CompanyWorkspaceRow[];
    const update = db.prepare(
      `UPDATE companies
       SET workspace_root = ?,
           workspace_source = 'provisioned',
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
    );

    for (const row of rows) {
      const workspaceSlug = normalizeWorkspacePart(
        row.workspace_slug || row.runtime_slug || row.slug || row.id,
      );
      const companyRoot = path.join(companiesRoot, workspaceSlug);
      mkdirSync(path.join(companyRoot, "projects"), { recursive: true });
      mkdirSync(path.join(companyRoot, "memory"), { recursive: true });
      mkdirSync(path.join(companyRoot, "scripts"), { recursive: true });
      update.run(companyRoot, row.id);
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    restoreEnv(previousEnv);
    rmSync(tempRoot, { recursive: true, force: true });
  }

  process.once("exit", dispose);

  return {
    tempRoot,
    workspaceRoot,
    openClawDir,
    openClawWorkspaceRoot,
    syncDatabase,
    dispose,
  };
}
