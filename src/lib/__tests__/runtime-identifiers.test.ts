import assert from "node:assert";

import Database from "better-sqlite3";

import {
  buildOpenClawRuntimeId,
  ensureUniqueAgentRuntimeSlug,
  ensureUniqueCompanyRuntimeSlug,
  OPENCLAW_RUNTIME_ID_MAX_LENGTH,
} from "@/lib/orchestration/runtime-identifiers";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error: unknown) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  \u2717 ${name}`);
    console.error(`    ${message}`);
  }
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE companies (
      id TEXT PRIMARY KEY,
      runtime_slug TEXT,
      created_at TEXT
    );

    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      runtime_slug TEXT,
      openclaw_agent_id TEXT,
      created_at TEXT
    );
  `);
  return db;
}

console.log("\nRuntime Identifier Tests\n");

const db = createTestDb();

test("short human-readable IDs stay readable when unique", () => {
  const runtimeId = buildOpenClawRuntimeId({
    db,
    companyId: "company-a",
    companyRuntimeSlug: "running-company",
    agentId: "agent-a",
    agentRuntimeSlug: "forge",
  });

  assert.strictEqual(runtimeId, "mc-running-company-forge");
});

test("company and agent runtime slugs get deterministic numeric suffixes when names collide", () => {
  db.prepare("INSERT INTO companies (id, runtime_slug, created_at) VALUES (?, ?, datetime('now'))").run(
    "company-existing",
    "running-company",
  );
  db.prepare(
    "INSERT INTO agents (id, company_id, runtime_slug, openclaw_agent_id, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
  ).run("agent-existing", "company-existing", "forge", "mc-running-company-forge");

  assert.strictEqual(ensureUniqueCompanyRuntimeSlug(db, "running-company"), "running-company-2");
  assert.strictEqual(
    ensureUniqueAgentRuntimeSlug(db, "company-existing", "forge"),
    "forge-2",
  );
});

test("long company and agent slugs truncate deterministically and stay within the 120-char limit", () => {
  const companyRuntimeSlug = `running-company-${"very-long-segment-".repeat(8)}`;
  const agentRuntimeSlug = `principal-engineer-${"another-long-segment-".repeat(8)}`;

  const runtimeId = buildOpenClawRuntimeId({
    companyId: "company-long",
    companyRuntimeSlug,
    agentId: "agent-long",
    agentRuntimeSlug,
  });

  assert.ok(runtimeId.length <= OPENCLAW_RUNTIME_ID_MAX_LENGTH);
  assert.match(runtimeId, /^mc-[a-z0-9-]+-[a-z0-9-]+-[0-9a-f]{8}$/);
  assert.strictEqual(
    runtimeId,
    buildOpenClawRuntimeId({
      companyId: "company-long",
      companyRuntimeSlug,
      agentId: "agent-long",
      agentRuntimeSlug,
    }),
  );
});

test("base collisions fall back to deterministic hash suffixes", () => {
  const takenBase = "mc-running-company-forge";
  db.prepare(
    "INSERT INTO agents (id, company_id, runtime_slug, openclaw_agent_id, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
  ).run("agent-taken-base", "company-existing", "forge", takenBase);

  const runtimeId = buildOpenClawRuntimeId({
    db,
    companyId: "company-existing",
    companyRuntimeSlug: "running-company",
    agentId: "agent-new-base-collision",
    agentRuntimeSlug: "forge",
  });

  assert.notStrictEqual(runtimeId, takenBase);
  assert.ok(runtimeId.length <= OPENCLAW_RUNTIME_ID_MAX_LENGTH);
  assert.match(runtimeId, /^mc-running-company-forge-[0-9a-f]{8}$/);
});

test("hashed collisions deterministically escalate to a longer hash suffix", () => {
  const companyRuntimeSlug = `running-company-${"very-long-segment-".repeat(8)}`;
  const agentRuntimeSlug = `principal-engineer-${"another-long-segment-".repeat(8)}`;
  const eightCharHashRuntimeId = buildOpenClawRuntimeId({
    companyId: "company-hash-collision",
    companyRuntimeSlug,
    agentId: "agent-hash-collision",
    agentRuntimeSlug,
  });

  db.prepare(
    "INSERT INTO agents (id, company_id, runtime_slug, openclaw_agent_id, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
  ).run(
    "agent-taken-hash",
    "company-existing",
    "principal-engineer",
    eightCharHashRuntimeId,
  );

  const runtimeId = buildOpenClawRuntimeId({
    db,
    companyId: "company-hash-collision",
    companyRuntimeSlug,
    agentId: "agent-hash-collision",
    agentRuntimeSlug,
  });

  assert.notStrictEqual(runtimeId, eightCharHashRuntimeId);
  assert.ok(runtimeId.length <= OPENCLAW_RUNTIME_ID_MAX_LENGTH);
  assert.match(runtimeId, /^mc-[a-z0-9-]+-[a-z0-9-]+-[0-9a-f]{12}$/);
  assert.strictEqual(
    runtimeId,
    buildOpenClawRuntimeId({
      db,
      companyId: "company-hash-collision",
      companyRuntimeSlug,
      agentId: "agent-hash-collision",
      agentRuntimeSlug,
    }),
  );
});

db.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
