// Repro for the flaky duplicate-a/duplicate-b ordering in
// orchestration-memory-retrieval-quality.test.ts. Pins indexed_at explicitly:
//   Scenario 1 ("same-ms"): both duplicates share one indexed_at millisecond.
//   Scenario 2 ("b-newer-1ms"): duplicate-b is indexed 1ms later, as happens
//   when the wall clock ticks between the test's two inserts.
// Run: ORCHESTRATION_DB_PATH=/tmp/memory-dup-order-repro-$$.db node ./scripts/run-ts-test.mjs scratch/memory-dup-order-repro.test.ts
import { createCompanyProjectAgentFixture } from "@/lib/__tests__/helpers/orchestration-learning-fixtures";
import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { buildMemoryContext } from "@/lib/orchestration/memory-context";

resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);
const db = getOrchestrationDb();

function runScenario(label: string, indexedAtA: string, indexedAtB: string): boolean {
  const { agent, company, project } = createCompanyProjectAgentFixture({
    companyName: (value) => `Dup Order ${label} Company ${value}`,
    projectName: (value) => `Dup Order ${label} Project ${value}`,
    projectColor: "#0ea5e9",
    agentName: (value) => `Dup Order ${label} Agent ${value}`,
    emoji: "icon:bot",
    role: "Implementation Engineer",
  });

  const insert = db.prepare(`
    INSERT INTO memory_source_index
      (record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts,
       file_type, file_mtime, frontmatter_json, tags_json, linked_ids_json, pinned,
       hiverunner_tags_json, status, indexed_at)
    VALUES (?, ?, 'company-vault', ?, 'project', 'Duplicate Evidence', 'Duplicate Evidence body', 'Duplicate Evidence body',
            'markdown', ?, ?, '["role:implementation"]', '["INS-REPRO"]', 0, '[]', 'active', ?)
  `);
  const frontmatter = JSON.stringify({
    review_state: "approved",
    project_id: project.id,
    source_task_key: "INS-REPRO",
    confidence: 0.95,
  });
  const idA = `${label}-duplicate-a`;
  const idB = `${label}-duplicate-b`;
  insert.run(idA, company.id, `/tmp/dup-order/${idA}.md`, indexedAtA, frontmatter, indexedAtA);
  insert.run(idB, company.id, `/tmp/dup-order/${idB}.md`, indexedAtB, frontmatter, indexedAtB);

  const context = buildMemoryContext({
    db,
    companyId: company.id,
    agentId: agent.id,
    agentRole: agent.role,
    projectId: project.id,
    limit: 10,
  });
  if (!context) throw new Error(`${label}: no context returned`);

  const indexA = context.evidence.findIndex((item) => item.recordId === idA);
  const indexB = context.evidence.findIndex((item) => item.recordId === idB);
  const penalized = context.quality.warnings
    .filter((issue) => issue.type === "duplicate_cluster")
    .map((issue) => issue.recordId)
    .join(",");
  const aAboveB = indexA !== -1 && indexB !== -1 && indexB > indexA;
  console.log(
    `${label}: indexA=${indexA} indexB=${indexB} duplicate_cluster on [${penalized}] -> ` +
      (aAboveB ? "PASS (a above b)" : "FAIL (b above a)"),
  );
  return aAboveB;
}

const sameMs = runScenario("same-ms", "2026-06-12T10:00:00.000Z", "2026-06-12T10:00:00.000Z");
const bNewer = runScenario("b-newer-1ms", "2026-06-12T10:00:00.000Z", "2026-06-12T10:00:00.001Z");

if (sameMs && bNewer) {
  console.log("RESULT: deterministic — duplicate-a ranks above duplicate-b in both scenarios");
} else {
  console.log("RESULT: ordering depends on indexed_at millisecond timing (flake reproduced)");
  process.exitCode = 1;
}
