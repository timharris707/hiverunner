import assert from "node:assert";
import { rmSync } from "node:fs";

import { GET as getMemoryQualityRoute } from "@/app/api/orchestration/companies/[slug]/memory/quality/route";
import {
  GET as getMemoryQualityIssueRoute,
  PATCH as patchMemoryQualityIssueRoute,
} from "@/app/api/orchestration/companies/[slug]/memory/quality/issues/[targetType]/[targetId]/route";
import { createCompany } from "@/lib/orchestration/company-service";
import { createCompanyMemoryRecord } from "@/lib/orchestration/company-memory";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  applyMemoryCurationAction,
  recordMemoryQualitySignal,
  recordMemoryQualityRecomputation,
} from "@/lib/orchestration/memory-quality";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  PASS ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      console.error(`  FAIL ${name}`);
      console.error(`    ${error instanceof Error ? error.message : String(error)}`);
    });
}

function getRequest(url: string): Request {
  return new Request(url, { method: "GET" });
}

function patchRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function nextRequest(url: string): { nextUrl: URL } {
  return { nextUrl: new URL(url) };
}

async function routeJson<T>(url: string, slug: string): Promise<{ status: number; body: T }> {
  const res = await getMemoryQualityRoute(nextRequest(url) as never, {
    params: Promise.resolve({ slug }),
  });
  return { status: res.status, body: await res.json() as T };
}

async function run() {
  console.log("\nOrchestration Memory Quality API Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const db = getOrchestrationDb();
  const stamp = Date.now();
  const insight = createCompany({
    name: `Insight Memory Quality ${stamp}`,
    description: "Representative Insight vault fixture",
    status: "active",
  }).company;
  const empty = createCompany({
    name: `Insight Empty Quality ${stamp}`,
    description: "empty fixture",
    status: "active",
  }).company;

  const now = new Date().toISOString();
  const old = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  const sourceRows = [
    {
      id: "insight-source-duplicate",
      path: `/Users/timharris/.mission-control/dev/workspaces/companies/insight/memory/company/duplicate-${stamp}.md`,
      title: "Duplicate operating rule",
      excerpt: "This repeats the same operating rule as another Insight note.",
      tags: ["company", "workflow"],
      links: [],
      mtime: now,
    },
    {
      id: "insight-source-stale",
      path: `/Users/timharris/.mission-control/dev/workspaces/companies/insight/memory/company/stale-${stamp}.md`,
      title: "Stale sprint decision",
      excerpt: "A sprint decision that has not been refreshed recently.",
      tags: ["company", "decision"],
      links: [],
      mtime: old,
    },
    {
      id: "insight-source-weak-provenance",
      path: `/Users/timharris/.mission-control/dev/workspaces/companies/insight/memory/company/weak-provenance-${stamp}.md`,
      title: "Weak provenance note",
      excerpt: "This note lacks a clear source task or run.",
      tags: ["company"],
      links: [],
      mtime: now,
    },
    {
      id: "insight-source-broken-links",
      path: `/Users/timharris/.mission-control/dev/workspaces/companies/insight/memory/company/broken-links-${stamp}.md`,
      title: "Broken links note",
      excerpt: "This note references missing source files.",
      tags: ["company"],
      links: ["missing-note"],
      mtime: now,
    },
  ];

  for (const row of sourceRows) {
    db.prepare(`
      INSERT INTO memory_source_index (
        record_id, company_id, source_id, source_path, layer, title, content_excerpt,
        content_fts, file_type, file_mtime, frontmatter_json, tags_json, linked_ids_json,
        hiverunner_tags_json, status, indexed_at
      )
      VALUES (?, ?, 'company-vault', ?, 'company', ?, ?, ?, 'markdown', ?, '{}', ?, ?, '[]', 'active', ?)
    `).run(
      row.id,
      insight.id,
      row.path,
      row.title,
      row.excerpt,
      row.excerpt,
      row.mtime,
      JSON.stringify(row.tags),
      JSON.stringify(row.links),
      now,
    );
  }

  const lowConfidenceMemory = createCompanyMemoryRecord(insight.slug, {
    title: "Low confidence company memory",
    body: "Extracted memory that needs confidence review before reuse.",
    kind: "fact",
    scope: "company",
    source: "extractor",
    confidence: 0.22,
    metadata: { sourcePath: "/memory/company/low-confidence.md", tags: ["extractor"] },
  }).memory;

  recordMemoryQualityRecomputation(insight.slug, {
    recomputationKey: "sprint-2-contract",
    inputHash: `insight-${stamp}`,
    scoresWritten: 5,
  });
  recordMemoryQualitySignal(insight.slug, {
    targetType: "source_index",
    targetId: "insight-source-duplicate",
    queue: "duplicates",
    qualityScore: 44,
    reason: "Near-identical Insight operating rule",
    evidence: { duplicateOf: "insight-source-stale" },
    scoringContract: "sprint-1-quality-v1",
    sourceFingerprint: "duplicate-hash",
  });
  recordMemoryQualitySignal(insight.slug, {
    targetType: "source_index",
    targetId: "insight-source-stale",
    queue: "stale",
    qualityScore: 38,
    reason: "Older than the Sprint 1 freshness threshold",
    evidence: { ageDays: 120 },
    scoringContract: "sprint-1-quality-v1",
    sourceFingerprint: "stale-hash",
  });
  recordMemoryQualitySignal(insight.slug, {
    targetType: "source_index",
    targetId: "insight-source-weak-provenance",
    queue: "weak_provenance",
    qualityScore: 52,
    reason: "No source task, run, or approval attribution",
    evidence: { weakProvenance: true },
    scoringContract: "sprint-1-quality-v1",
    sourceFingerprint: "weak-provenance-hash",
  });
  recordMemoryQualitySignal(insight.slug, {
    targetType: "source_index",
    targetId: "insight-source-broken-links",
    queue: "broken_links",
    qualityScore: 58,
    reason: "One linked note is missing from the indexed vault",
    evidence: { brokenLinkCount: 1 },
    scoringContract: "sprint-1-quality-v1",
    sourceFingerprint: "broken-link-hash",
  });
  recordMemoryQualitySignal(insight.slug, {
    targetType: "memory_record",
    targetId: lowConfidenceMemory.id,
    queue: "low_confidence",
    qualityScore: 46,
    confidence: 0.22,
    reason: "Extractor confidence below Sprint 1 threshold",
    evidence: { confidence: 0.22 },
    scoringContract: "sprint-1-quality-v1",
    sourceFingerprint: "low-confidence-hash",
  });

  applyMemoryCurationAction(insight.slug, {
    targetType: "source_index",
    targetId: "insight-source-stale",
    action: "acknowledge",
    actor: "Fixture",
    idempotencyKey: "acknowledge-stale-once",
  });

  await test("dashboard returns KPIs and queue counts for representative Insight data", async () => {
    const { status, body } = await routeJson<{
      company: { id: string };
      kpis: {
        totalScored: number;
        openIssues: number;
        reviewedIssues: number;
        acknowledgedIssues: number;
        resolvedIssues: number;
        dismissedIssues: number;
        supersededIssues: number;
        archivedIssues: number;
        rewriteRequestedIssues: number;
        mergeCandidateIssues: number;
        averageQualityScore: number | null;
        criticalIssues: number;
      };
      queues: Record<string, { count: number; worstScore: number | null }>;
      recentRecomputation: { recomputationKey: string } | null;
    }>(`http://localhost/api/orchestration/companies/${insight.slug}/memory/quality`, insight.slug);

    assert.strictEqual(status, 200);
    assert.strictEqual(body.company.id, insight.id);
    assert.strictEqual(body.kpis.totalScored, 5);
    assert.strictEqual(body.kpis.openIssues, 4);
    assert.strictEqual(body.kpis.acknowledgedIssues, 1);
    assert.strictEqual(body.kpis.averageQualityScore, 47.6);
    assert.strictEqual(body.queues.duplicates.count, 1);
    assert.strictEqual(body.queues.stale.count, 1);
    assert.strictEqual(body.queues.weak_provenance.count, 1);
    assert.strictEqual(body.queues.broken_links.count, 1);
    assert.strictEqual(body.queues.low_confidence.count, 1);
    assert.strictEqual(body.recentRecomputation?.recomputationKey, "sprint-2-contract");
  });

  for (const [queue, expectedTarget] of [
    ["duplicates", "insight-source-duplicate"],
    ["stale", "insight-source-stale"],
    ["weak_provenance", "insight-source-weak-provenance"],
    ["broken_links", "insight-source-broken-links"],
    ["low_confidence", lowConfidenceMemory.id],
  ] as const) {
    await test(`queue API returns ${queue} items`, async () => {
      const { status, body } = await routeJson<{
        queue: string;
        items: Array<{ targetId: string; target: { title: string }; queues: string[]; reasons: string[] }>;
      }>(`http://localhost/api/orchestration/companies/${insight.slug}/memory/quality?view=queue&queue=${queue}`, insight.slug);

      assert.strictEqual(status, 200);
      assert.strictEqual(body.queue, queue);
      assert.strictEqual(body.items.length, 1);
      assert.strictEqual(body.items[0].targetId, expectedTarget);
      assert.ok(body.items[0].queues.includes(queue));
      assert.ok(body.items[0].target.title.length > 0);
      assert.ok(body.items[0].reasons.length > 0);
    });
  }

  await test("queue API supports curation state filters", async () => {
    const { status, body } = await routeJson<{ items: Array<{ targetId: string; curationState: string }> }>(
      `http://localhost/api/orchestration/companies/${insight.slug}/memory/quality?view=queue&queue=stale&state=acknowledged`,
      insight.slug,
    );

    assert.strictEqual(status, 200);
    assert.deepStrictEqual(body.items.map((item) => [item.targetId, item.curationState]), [["insight-source-stale", "acknowledged"]]);
  });

  await test("issue detail returns latest score, target payload, and curation actions", async () => {
    const res = await getMemoryQualityIssueRoute(getRequest(
      `http://localhost/api/orchestration/companies/${insight.slug}/memory/quality/issues/source_index/insight-source-stale`,
    ) as never, {
      params: Promise.resolve({ slug: insight.slug, targetType: "source_index", targetId: "insight-source-stale" }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json() as {
      issue: { targetId: string; curationState: string; target: { sourcePath: string | null }; queues: string[] };
      actions: Array<{ action: string; toState: string }>;
    };
    assert.strictEqual(body.issue.targetId, "insight-source-stale");
    assert.strictEqual(body.issue.curationState, "acknowledged");
    assert.ok(body.issue.target.sourcePath?.includes("/insight/memory/company/stale-"));
    assert.deepStrictEqual(body.issue.queues, ["stale"]);
    assert.deepStrictEqual(body.actions.map((action) => [action.action, action.toState]), [["acknowledge", "acknowledged"]]);
  });

  await test("issue PATCH route applies curation actions", async () => {
    const res = await patchMemoryQualityIssueRoute(patchRequest(
      `http://localhost/api/orchestration/companies/${insight.slug}/memory/quality/issues/source_index/insight-source-broken-links`,
      { action: "resolve", actor: "api-test" },
    ) as never, {
      params: Promise.resolve({ slug: insight.slug, targetType: "source_index", targetId: "insight-source-broken-links" }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json() as {
      state: { state: string; actor: string | null };
      action: { action: string; toState: string };
      idempotent: boolean;
    };
    assert.strictEqual(body.state.state, "resolved");
    assert.strictEqual(body.state.actor, "api-test");
    assert.strictEqual(body.action.action, "resolve");
    assert.strictEqual(body.action.toState, "resolved");
    assert.strictEqual(body.idempotent, false);
  });

  await test("empty state returns zero KPIs and empty queues", async () => {
    const { status, body } = await routeJson<{
      kpis: { totalScored: number; averageQualityScore: number | null };
      queues: Record<string, { count: number }>;
    }>(`http://localhost/api/orchestration/companies/${empty.slug}/memory/quality`, empty.slug);

    assert.strictEqual(status, 200);
    assert.strictEqual(body.kpis.totalScored, 0);
    assert.strictEqual(body.kpis.averageQualityScore, null);
    assert.deepStrictEqual(Object.values(body.queues).map((queue) => queue.count), [0, 0, 0, 0, 0]);
  });

  await test("malformed filters return 400 errors", async () => {
    const badQueue = await routeJson<{ error: { code: string } }>(
      `http://localhost/api/orchestration/companies/${insight.slug}/memory/quality?view=queue&queue=unknown`,
      insight.slug,
    );
    const badState = await routeJson<{ error: { code: string } }>(
      `http://localhost/api/orchestration/companies/${insight.slug}/memory/quality?view=queue&state=done`,
      insight.slug,
    );
    const badLimit = await routeJson<{ error: { code: string } }>(
      `http://localhost/api/orchestration/companies/${insight.slug}/memory/quality?view=queue&limit=-1`,
      insight.slug,
    );

    assert.strictEqual(badQueue.status, 400);
    assert.strictEqual(badQueue.body.error.code, "invalid_quality_queue");
    assert.strictEqual(badState.status, 400);
    assert.strictEqual(badState.body.error.code, "invalid_curation_state");
    assert.strictEqual(badLimit.status, 400);
    assert.strictEqual(badLimit.body.error.code, "invalid_limit");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
