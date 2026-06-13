/**
 * H3 split-brain repair — move per-agent memory files from the env-recomputed
 * legacy tree into the workspace the runtime actually uses.
 *
 * Before the resolveRuntimeCompanyWorkspaceRoot fix, agent-lessons.ts and
 * voice-agent-memory.ts resolved {companyWorkspace}/memory/agents/<id>/ via
 * resolveCanonicalCompanyWorkspaceRoot (process env only), while runners,
 * artifacts, and the files UI honored the frozen companies.workspace_root.
 * After an env cutover the two trees diverge and memory files land where the
 * runtime cwd never sees them. This script moves them home.
 *
 * Read-only on the database (single-writer rule: the serving process owns all
 * DB writes); the only writes are filesystem moves. Dry-run by default.
 *
 * Run from the app root with the SERVER's env so the legacy recompute matches
 * what the serving process was doing:
 *
 *   MC_WORKSPACE_ROOT=/Users/timharris/.hiverunner/stable/workspaces \
 *     node ./scripts/run-ts-test.mjs scripts/migrate-agent-memory-workspace-root.ts -- [--db data/orchestration.db] [--apply]
 */

import fs from "fs";
import path from "path";

import Database from "better-sqlite3";

import {
  resolveCanonicalCompanyWorkspaceRoot,
  resolveRuntimeCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";

type CompanyRow = {
  id: string;
  slug: string;
  name: string;
  workspace_slug: string | null;
  workspace_root: string | null;
  workspace_source: string | null;
};

function parseArgs(argv: string[]): { dbPath: string; apply: boolean } {
  let dbPath = "data/orchestration.db";
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--db" && argv[i + 1]) {
      dbPath = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--apply") {
      apply = true;
    } else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  return { dbPath, apply };
}

function moveFile(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch {
    // Cross-device fallback.
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

function removeDirIfEmpty(dir: string): void {
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // Best-effort tidy only.
  }
}

type MoveTally = { moved: number; skippedExisting: number };

function migrateAgentFile(src: string, dest: string, apply: boolean, tally: MoveTally): void {
  if (fs.existsSync(dest)) {
    tally.skippedExisting += 1;
    console.log(`  SKIP (exists at target, merge by hand): ${src} -> ${dest}`);
    return;
  }
  tally.moved += 1;
  console.log(`  ${apply ? "MOVE" : "would move"}: ${src} -> ${dest}`);
  if (apply) moveFile(src, dest);
}

function migrateAgentDir(input: {
  legacyAgentsDir: string;
  targetRoot: string;
  agentId: string;
  apply: boolean;
  tally: MoveTally;
}): void {
  const srcAgentDir = path.join(input.legacyAgentsDir, input.agentId);
  if (!fs.statSync(srcAgentDir).isDirectory()) return;

  for (const file of fs.readdirSync(srcAgentDir)) {
    const src = path.join(srcAgentDir, file);
    if (!fs.statSync(src).isFile()) continue;
    const dest = path.join(input.targetRoot, "memory", "agents", input.agentId, file);
    migrateAgentFile(src, dest, input.apply, input.tally);
  }
  if (input.apply) removeDirIfEmpty(srcAgentDir);
}

function migrateCompany(company: CompanyRow, apply: boolean, tally: MoveTally): void {
  const legacyRoot = resolveCanonicalCompanyWorkspaceRoot(
    company.id,
    company.workspace_slug ?? company.slug,
  );
  const targetRoot = resolveRuntimeCompanyWorkspaceRoot({
    companyId: company.id,
    workspaceSlug: company.workspace_slug ?? company.slug,
    workspaceRoot: company.workspace_root,
    workspaceSource: company.workspace_source,
  });
  if (path.resolve(legacyRoot) === path.resolve(targetRoot)) return;

  const legacyAgentsDir = path.join(legacyRoot, "memory", "agents");
  if (!fs.existsSync(legacyAgentsDir)) return;

  console.log(`Company ${company.slug} (${company.name})`);
  console.log(`  legacy: ${legacyRoot}`);
  console.log(`  target: ${targetRoot}`);

  for (const agentId of fs.readdirSync(legacyAgentsDir)) {
    migrateAgentDir({ legacyAgentsDir, targetRoot, agentId, apply, tally });
  }
  if (apply) {
    removeDirIfEmpty(legacyAgentsDir);
    removeDirIfEmpty(path.join(legacyRoot, "memory"));
  }
}

function loadCompanies(resolvedDbPath: string): CompanyRow[] {
  const db = new Database(resolvedDbPath, { readonly: true, fileMustExist: true });
  try {
    return db
      .prepare(
        "SELECT id, slug, name, workspace_slug, workspace_root, workspace_source FROM companies",
      )
      .all() as CompanyRow[];
  } finally {
    db.close();
  }
}

function main(): void {
  const { dbPath, apply } = parseArgs(process.argv.slice(2));
  const resolvedDbPath = path.resolve(dbPath);
  if (!fs.existsSync(resolvedDbPath)) {
    console.error(`Database not found: ${resolvedDbPath}`);
    process.exit(2);
  }

  console.log(`DB (read-only): ${resolvedDbPath}`);
  console.log(`MC_WORKSPACE_ROOT: ${process.env.MC_WORKSPACE_ROOT ?? "(unset — home default)"}`);
  console.log(`Mode: ${apply ? "APPLY" : "dry-run (pass --apply to execute)"}\n`);

  const tally: MoveTally = { moved: 0, skippedExisting: 0 };
  for (const company of loadCompanies(resolvedDbPath)) {
    migrateCompany(company, apply, tally);
  }

  console.log(
    `\n${apply ? "Moved" : "Would move"} ${tally.moved} file(s); ${tally.skippedExisting} left in place for manual merge.`,
  );
}

main();
