import assert from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";

import type { MemoryContextResult } from "@/lib/orchestration/memory-context";

const PROJECT_WORKSPACE = process.env.MC_APP_ROOT ?? process.cwd();
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_WORKSPACE, "output", "proof", "sprint-5-retrieval-evidence");
const FIXTURE_SOURCE_ID = "ins-47-retrieval-evidence-fixture";

type FixtureCase = {
  id: string;
  title: string;
  category: "approved" | "stale" | "duplicate" | "orphan" | "graph-backed" | "refused";
  expectation: "included" | "warning" | "refused";
  description: string;
};

type ProofCheck = {
  name: string;
  status: "pass" | "fail";
  detail: string;
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const absolute = path.join(dir, entry);
      const relative = path.relative(root, absolute);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        visit(absolute);
      } else {
        files.push(relative);
      }
    }
  };
  visit(root);
  return files.sort();
}

function snapshotProjectWorkspace(outputDir: string): string[] {
  const proofRoot = path.resolve(PROJECT_WORKSPACE, "output", "proof");
  return listFiles(PROJECT_WORKSPACE)
    .filter((relative) => {
      const absolute = path.resolve(PROJECT_WORKSPACE, relative);
      if (absolute.startsWith(proofRoot + path.sep) || absolute === proofRoot) return false;
      if (absolute.startsWith(path.resolve(outputDir) + path.sep)) return false;
      // Exclude Next.js dev-server build artifacts — these are written by a background
      // process (webpack HMR) and are not vault writes.
      if (relative.split(path.sep).includes(".next")) return false;
      return true;
    });
}

function insertIndexedMemory(input: {
  db: Database.Database;
  companyId: string;
  projectId: string;
  taskKey: string;
  id: string;
  title: string;
  content: string;
  sourcePath: string;
  layer?: "company" | "project" | "agent";
  tags?: string[];
  linkedIds?: string[];
  pinned?: 0 | 1;
  fileMtime?: string;
  frontmatter?: Record<string, unknown>;
}) {
  const frontmatter = {
    review_state: "approved",
    project_id: input.projectId,
    source_task_key: input.taskKey,
    confidence: 0.94,
    ...input.frontmatter,
  };
  input.db.prepare(`
    INSERT INTO memory_source_index
      (record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts,
       file_type, file_mtime, frontmatter_json, tags_json, linked_ids_json, pinned,
       hiverunner_tags_json, status, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'markdown', ?, ?, ?, ?, ?, '[]', 'active', ?)
  `).run(
    input.id,
    input.companyId,
    FIXTURE_SOURCE_ID,
    input.sourcePath,
    input.layer ?? "project",
    input.title,
    input.content,
    input.content,
    input.fileMtime ?? new Date().toISOString(),
    JSON.stringify(frontmatter),
    JSON.stringify(input.tags ?? ["role:qa", "evidence:retrieval"]),
    JSON.stringify(input.linkedIds ?? [input.taskKey]),
    input.pinned ?? 0,
    new Date().toISOString(),
  );
}

function summarizeContext(context: MemoryContextResult | null) {
  return {
    source: context?.source ?? null,
    quality: context?.quality ?? null,
    evidence: context?.evidence.map((item) => ({
      recordId: item.recordId,
      title: item.title,
      layer: item.layer,
      sourcePath: item.sourcePath,
      envelope: {
        envelopeId: item.evidenceEnvelope.envelopeId,
        retrievalRank: item.evidenceEnvelope.retrievalRank,
        sourceType: item.evidenceEnvelope.sourceType,
        contentSha256: item.evidenceEnvelope.contentSha256,
        matched: item.evidenceEnvelope.matched,
        inclusionReasons: item.evidenceEnvelope.inclusionReasons,
      },
    })) ?? [],
    sectionExcerpt: context?.section.split("\n").slice(0, 18).join("\n") ?? null,
  };
}

function addCheck(checks: ProofCheck[], name: string, condition: boolean, detail: string) {
  checks.push({ name, status: condition ? "pass" : "fail", detail });
}

function markdownIndex(input: {
  generatedAt: string;
  outputDir: string;
  fixtures: FixtureCase[];
  checks: ProofCheck[];
  acceptedContext: ReturnType<typeof summarizeContext>;
  refusedContext: ReturnType<typeof summarizeContext>;
  changedProjectFilesOutsideProof: string[];
  proofFiles: string[];
}) {
  const passCount = input.checks.filter((check) => check.status === "pass").length;
  const failCount = input.checks.length - passCount;
  const lines: string[] = [
    "# INS-47 Retrieval Evidence Proof Harness",
    "",
    `Generated: ${input.generatedAt}`,
    `Output directory: \`${input.outputDir}\``,
    "",
    "## Pass/Fail Summary",
    "",
    `- Checks passed: ${passCount}`,
    `- Checks failed: ${failCount}`,
    `- Files changed outside project output/proof: ${input.changedProjectFilesOutsideProof.length}`,
    "",
    "## Fixture Inventory",
    "",
    "| Fixture | Category | Expected | Description |",
    "| --- | --- | --- | --- |",
    ...input.fixtures.map((fixture) => `| \`${fixture.id}\` | ${fixture.category} | ${fixture.expectation} | ${fixture.description} |`),
    "",
    "## Check Results",
    "",
    ...input.checks.map((check) => `- **${check.status.toUpperCase()}** ${check.name}: ${check.detail}`),
    "",
    "## Evidence Examples",
    "",
    "### Accepted / Degraded Context",
    "",
    `- Quality status: \`${input.acceptedContext.quality?.status ?? "none"}\``,
    `- Evidence records: ${input.acceptedContext.evidence.map((item) => `\`${item.recordId}\``).join(", ") || "none"}`,
    `- Warning types: ${input.acceptedContext.quality?.warnings.map((issue) => `\`${issue.type}:${issue.recordId}\``).join(", ") || "none"}`,
    "",
    "```text",
    input.acceptedContext.sectionExcerpt ?? "",
    "```",
    "",
    "### Refused Context",
    "",
    `- Quality status: \`${input.refusedContext.quality?.status ?? "none"}\``,
    `- Refusal types: ${input.refusedContext.quality?.refusals.map((issue) => `\`${issue.type}:${issue.recordId}\``).join(", ") || "none"}`,
    "",
    "```text",
    input.refusedContext.sectionExcerpt ?? "",
    "```",
    "",
    "## Proof Files",
    "",
    ...input.proofFiles.map((file) => `- \`${file}\``),
    "",
  ];
  return lines.join("\n");
}

async function main() {
  const outputDir = path.resolve(process.env.INS47_PROOF_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR);
  const proofRoot = path.resolve(PROJECT_WORKSPACE, "output", "proof");
  assert.ok(outputDir === proofRoot || outputDir.startsWith(proofRoot + path.sep), `Proof output must stay under ${proofRoot}`);

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  const beforeProjectFiles = snapshotProjectWorkspace(outputDir);

  const dbPath = process.env.ORCHESTRATION_DB_PATH ?? path.join(outputDir, "retrieval-evidence-proof.db");
  assert.ok(path.resolve(dbPath).startsWith(outputDir + path.sep), "ORCHESTRATION_DB_PATH must stay under the proof output directory");
  process.env.ORCHESTRATION_DB_PATH = dbPath;
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  process.env.MC_WORKSPACE_ROOT = path.join(outputDir, "fixture-workspace");
  mkdirSync(process.env.MC_WORKSPACE_ROOT, { recursive: true });

  const [
    { createCompany },
    { closeOrchestrationDb, getOrchestrationDb },
    { buildMemoryContext },
    { createProject, createTask },
  ] = await Promise.all([
    import("@/lib/orchestration/company-service"),
    import("@/lib/orchestration/db"),
    import("@/lib/orchestration/memory-context"),
    import("@/lib/orchestration/service"),
  ]);

  const db = getOrchestrationDb();
  const stamp = Date.now();
  const company = createCompany({
    name: `INS-47 Retrieval Evidence Company ${stamp}`,
    description: "Fixture company for retrieval evidence proof harness.",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `INS-47 Retrieval Evidence Project ${stamp}`,
    description: "Fixture project for retrieval evidence proof harness.",
    color: "#0f766e",
    emoji: "icon:test-tube",
    status: "active",
  }).project;
  const agent = {
    id: `ins-47-qa-agent-${stamp}`,
    role: "QA Verification Lead",
  };
  const task = createTask({
    projectId: project.id,
    title: "INS-47 retrieval evidence fixture task",
    description: "Fixture task used by the proof harness.",
    priority: "P1",
    type: "research",
    status: "in-progress",
    labels: [],
    createdBy: "ins-47-proof",
  }).task;

  const sourceBase = path.join(outputDir, "fixtures");
  const fixtures: FixtureCase[] = [
    { id: "approved-evidence", title: "Approved Retrieval Evidence", category: "approved", expectation: "included", description: "Approved, high-confidence project evidence with source task provenance." },
    { id: "graph-backed-evidence", title: "Graph Backed Retrieval Evidence", category: "graph-backed", expectation: "included", description: "Approved map/graph evidence with linked graph IDs and evidence cluster metadata." },
    { id: "duplicate-a", title: "Duplicate Retrieval Evidence", category: "duplicate", expectation: "included", description: "First duplicate with approved provenance." },
    { id: "duplicate-b", title: "Duplicate Retrieval Evidence", category: "duplicate", expectation: "warning", description: "Second duplicate should be downranked with a duplicate warning." },
    { id: "orphan-evidence", title: "Orphan Retrieval Evidence", category: "orphan", expectation: "warning", description: "Approved company note with no links or source provenance." },
    { id: "missing-approval-evidence", title: "Missing Approval Retrieval Evidence", category: "approved", expectation: "warning", description: "Eligible evidence missing review state, used to prove quality warnings are surfaced." },
    { id: "stale-refused-evidence", title: "Stale Refused Evidence", category: "stale", expectation: "refused", description: "Approved evidence older than the 365-day refusal threshold." },
    { id: "unapproved-refused-evidence", title: "Unapproved Refused Evidence", category: "refused", expectation: "refused", description: "Evidence with requested review state must not be injected." },
    { id: "low-confidence-refused-evidence", title: "Low Confidence Refused Evidence", category: "refused", expectation: "refused", description: "Evidence below the 0.5 confidence threshold must not be injected." },
  ];

  insertIndexedMemory({
    db,
    companyId: company.id,
    projectId: project.id,
    taskKey: task.key,
    id: "approved-evidence",
    title: "Approved Retrieval Evidence",
    content: "Approved fixture: operators should see this supported context with deterministic envelope metadata.",
    sourcePath: path.join(sourceBase, "approved-evidence.md"),
    pinned: 1,
  });
  insertIndexedMemory({
    db,
    companyId: company.id,
    projectId: project.id,
    taskKey: task.key,
    id: "graph-backed-evidence",
    title: "Graph Backed Retrieval Evidence",
    content: "Graph-backed fixture: this context is linked to the memory map and a graph evidence cluster.",
    sourcePath: path.join(sourceBase, "maps", "graph-backed-evidence.md"),
    layer: "project",
    linkedIds: [task.key, "graph:company-memory", "map:retrieval-evidence"],
    frontmatter: { evidence_cluster: "retrieval-evidence-graph", graph_node_id: "graph-backed-evidence", confidence: 0.96 },
  });
  insertIndexedMemory({
    db,
    companyId: company.id,
    projectId: project.id,
    taskKey: task.key,
    id: "duplicate-a",
    title: "Duplicate Retrieval Evidence",
    content: "Duplicate fixture A: the higher-ranked duplicate remains eligible.",
    sourcePath: path.join(sourceBase, "duplicate-a.md"),
    pinned: 1,
    frontmatter: { confidence: 0.91 },
  });
  insertIndexedMemory({
    db,
    companyId: company.id,
    projectId: project.id,
    taskKey: task.key,
    id: "duplicate-b",
    title: "Duplicate Retrieval Evidence",
    content: "Duplicate fixture B: same title should produce a duplicate warning and downranking.",
    sourcePath: path.join(sourceBase, "duplicate-b.md"),
    frontmatter: { confidence: 0.9 },
  });
  insertIndexedMemory({
    db,
    companyId: company.id,
    projectId: project.id,
    taskKey: task.key,
    id: "orphan-evidence",
    title: "Orphan Retrieval Evidence",
    content: "Orphan fixture: approved but intentionally lacks indexed links and source task provenance.",
    sourcePath: path.join(sourceBase, "orphan-evidence.md"),
    layer: "company",
    linkedIds: [],
    frontmatter: { review_state: "approved", confidence: 0.88, project_id: undefined, source_task_key: undefined },
  });
  insertIndexedMemory({
    db,
    companyId: company.id,
    projectId: project.id,
    taskKey: task.key,
    id: "missing-approval-evidence",
    title: "Missing Approval Retrieval Evidence",
    content: "Missing approval fixture: eligible but downranked until curation records review state.",
    sourcePath: path.join(sourceBase, "missing-approval-evidence.md"),
    frontmatter: { review_state: undefined, confidence: 0.89 },
  });

  const acceptedContext = buildMemoryContext({
    db,
    companyId: company.id,
    agentId: agent.id,
    agentRole: agent.role,
    projectId: project.id,
    limit: 10,
  });

  const refusalCompany = createCompany({
    name: `INS-47 Retrieval Refusal Company ${stamp}`,
    description: "Fixture company for refused retrieval proof.",
    status: "active",
  }).company;
  const refusalProject = createProject({
    companyId: refusalCompany.id,
    name: `INS-47 Retrieval Refusal Project ${stamp}`,
    description: "Fixture project for refused retrieval proof.",
    color: "#b91c1c",
    emoji: "icon:ban",
    status: "active",
  }).project;
  const refusalAgent = {
    id: `ins-47-refusal-qa-agent-${stamp}`,
    role: "QA Verification Lead",
  };

  insertIndexedMemory({
    db,
    companyId: refusalCompany.id,
    projectId: refusalProject.id,
    taskKey: "INS-47",
    id: "stale-refused-evidence",
    title: "Stale Refused Evidence",
    content: "Stale fixture: too old to inject even though it was previously approved.",
    sourcePath: path.join(sourceBase, "stale-refused-evidence.md"),
    fileMtime: isoDaysAgo(730),
  });
  insertIndexedMemory({
    db,
    companyId: refusalCompany.id,
    projectId: refusalProject.id,
    taskKey: "INS-47",
    id: "unapproved-refused-evidence",
    title: "Unapproved Refused Evidence",
    content: "Unapproved fixture: requested review state should refuse injection.",
    sourcePath: path.join(sourceBase, "unapproved-refused-evidence.md"),
    frontmatter: { review_state: "requested", confidence: 0.92 },
  });
  insertIndexedMemory({
    db,
    companyId: refusalCompany.id,
    projectId: refusalProject.id,
    taskKey: "INS-47",
    id: "low-confidence-refused-evidence",
    title: "Low Confidence Refused Evidence",
    content: "Low-confidence fixture: below threshold and must not be injected.",
    sourcePath: path.join(sourceBase, "low-confidence-refused-evidence.md"),
    frontmatter: { confidence: 0.2 },
  });

  const refusedContext = buildMemoryContext({
    db,
    companyId: refusalCompany.id,
    agentId: refusalAgent.id,
    agentRole: refusalAgent.role,
    projectId: refusalProject.id,
    limit: 10,
  });

  const accepted = summarizeContext(acceptedContext);
  const refused = summarizeContext(refusedContext);
  const checks: ProofCheck[] = [];
  addCheck(checks, "approved evidence included", accepted.evidence.some((item) => item.recordId === "approved-evidence"), "approved high-confidence fixture appears in retrieved evidence");
  addCheck(checks, "graph-backed evidence included", accepted.evidence.some((item) => item.recordId === "graph-backed-evidence" && item.sourcePath?.includes("/maps/")), "graph/map-backed fixture appears with source path and envelope");
  addCheck(checks, "duplicate warning surfaced", Boolean(accepted.quality?.warnings.some((issue) => issue.type === "duplicate_cluster" && issue.recordId === "duplicate-b")), "second duplicate is retained as warning evidence and downranked");
  addCheck(checks, "orphan warning surfaced", Boolean(accepted.quality?.warnings.some((issue) => issue.type === "orphan_note" && issue.recordId === "orphan-evidence")), "orphan note warning is present");
  addCheck(checks, "missing approval warning surfaced", Boolean(accepted.quality?.warnings.some((issue) => issue.type === "missing_approval_state" && issue.recordId === "missing-approval-evidence")), "missing approval warning is present");
  addCheck(checks, "accepted context is degraded, not refused", accepted.quality?.status === "degraded" && accepted.evidence.length > 0, "mixed eligible fixtures still inject with warnings");
  addCheck(checks, "refused context injects no evidence", refused.quality?.status === "refused" && refused.evidence.length === 0, "all weak/stale fixtures are refused");
  addCheck(checks, "stale refusal surfaced", Boolean(refused.quality?.refusals.some((issue) => issue.type === "stale_evidence" && issue.recordId === "stale-refused-evidence")), "stale evidence refusal reason is present");
  addCheck(checks, "unapproved refusal surfaced", Boolean(refused.quality?.refusals.some((issue) => issue.type === "unapproved" && issue.recordId === "unapproved-refused-evidence")), "unapproved evidence refusal reason is present");
  addCheck(checks, "low-confidence refusal surfaced", Boolean(refused.quality?.refusals.some((issue) => issue.type === "low_confidence" && issue.recordId === "low-confidence-refused-evidence")), "low-confidence refusal reason is present");
  addCheck(checks, "evidence envelopes are deterministic-shaped", accepted.evidence.every((item) => /^[a-f0-9]{64}$/.test(item.envelope.envelopeId) && /^[a-f0-9]{64}$/.test(item.envelope.contentSha256)), "included evidence has sha256 envelope identifiers and content hashes");

  closeOrchestrationDb();

  const proofJson = {
    generatedAt: new Date().toISOString(),
    outputDir,
    company: { id: company.id, slug: company.slug },
    refusalCompany: { id: refusalCompany.id, slug: refusalCompany.slug },
    fixtures,
    checks,
    acceptedContext: accepted,
    refusedContext: refused,
  };

  const afterProjectFiles = snapshotProjectWorkspace(outputDir);
  const beforeSet = new Set(beforeProjectFiles);
  const changedProjectFilesOutsideProof = afterProjectFiles.filter((file) => !beforeSet.has(file));
  addCheck(checks, "no project workspace writes outside output/proof", changedProjectFilesOutsideProof.length === 0, changedProjectFilesOutsideProof.length === 0 ? "project workspace changes are confined to output/proof" : changedProjectFilesOutsideProof.join(", "));

  await writeFile(path.join(outputDir, "retrieval-evidence-proof.json"), JSON.stringify(proofJson, null, 2) + "\n", "utf-8");
  const plannedProofFiles = [...listFiles(outputDir), "proof-index.md", "sha256s.txt"].sort();
  const index = markdownIndex({
    generatedAt: proofJson.generatedAt,
    outputDir,
    fixtures,
    checks,
    acceptedContext: accepted,
    refusedContext: refused,
    changedProjectFilesOutsideProof,
    proofFiles: plannedProofFiles,
  });
  await writeFile(path.join(outputDir, "proof-index.md"), index, "utf-8");

  const shaFile = [
    `retrieval-evidence-proof.json  ${sha256(JSON.stringify(proofJson, null, 2) + "\n")}`,
    `proof-index.md  ${sha256(index)}`,
    "",
  ].join("\n");
  await writeFile(path.join(outputDir, "sha256s.txt"), shaFile, "utf-8");

  const failed = checks.filter((check) => check.status === "fail");
  console.log(JSON.stringify({
    outputDir,
    proofIndex: path.join(outputDir, "proof-index.md"),
    proofJson: path.join(outputDir, "retrieval-evidence-proof.json"),
    checksPassed: checks.length - failed.length,
    checksFailed: failed.length,
  }, null, 2));
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
