import assert from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";

import type { MemoryContextResult } from "@/lib/orchestration/memory-context";

const PROJECT_WORKSPACE = process.env.MC_APP_ROOT ?? process.cwd();
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_WORKSPACE, "output", "proof", "sprint-6-integrated-memory-benchmark");
const FIXTURE_SOURCE_ID = "ins-53-integrated-memory-benchmark";

type SmokeCheck = {
  name: string;
  status: "pass" | "fail";
  detail: string;
};

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const absolute = path.join(dir, entry);
      const relative = path.relative(root, absolute);
      const stat = statSync(absolute);
      if (stat.isDirectory()) visit(absolute);
      else files.push(relative);
    }
  };
  visit(root);
  return files.sort();
}

function addCheck(checks: SmokeCheck[], name: string, condition: boolean, detail: string) {
  checks.push({ name, status: condition ? "pass" : "fail", detail });
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
  layer?: "company" | "project" | "agent" | "map";
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
  const now = new Date().toISOString();
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
    input.fileMtime ?? now,
    JSON.stringify(frontmatter),
    JSON.stringify(input.tags ?? ["role:qa", "evidence:integrated-smoke"]),
    JSON.stringify(input.linkedIds ?? [input.taskKey]),
    input.pinned ?? 0,
    now,
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
    sectionExcerpt: context?.section.split("\n").slice(0, 14).join("\n") ?? null,
  };
}

function markdownIndex(input: {
  generatedAt: string;
  outputDir: string;
  checks: SmokeCheck[];
  dashboard: unknown;
  wiki: {
    requestId: string;
    targetPath: string;
    requestedState: string;
    writtenState: string;
    preApprovalRefusalCode: string | null;
    fileSha256After: string;
    idempotentRetry: boolean;
  };
  graph: {
    nodes: number;
    edges: number;
    readiness: string;
    graphNotesWritten: number;
    mapNotesWritten: number;
    sampleLinks: string[];
  };
  retrieval: {
    accepted: ReturnType<typeof summarizeContext>;
    refused: ReturnType<typeof summarizeContext>;
  };
  proofFiles: string[];
}) {
  const passCount = input.checks.filter((check) => check.status === "pass").length;
  const failCount = input.checks.length - passCount;
  const lines = [
    "# INS-53 Integrated Memory Benchmark Smoke Harness",
    "",
    `Generated: ${input.generatedAt}`,
    `Output directory: \`${input.outputDir}\``,
    "",
    "## Pass/Fail Summary",
    "",
    `- Checks passed: ${passCount}`,
    `- Checks failed: ${failCount}`,
    "",
    "## Check Results",
    "",
    ...input.checks.map((check) => `- **${check.status.toUpperCase()}** ${check.name}: ${check.detail}`),
    "",
    "## Dashboard Quality Metrics",
    "",
    "```json",
    JSON.stringify(input.dashboard, null, 2),
    "```",
    "",
    "## Wiki Write-Back",
    "",
    `- Request: \`${input.wiki.requestId}\``,
    `- Target: \`${input.wiki.targetPath}\``,
    `- Approval path: \`${input.wiki.requestedState}\` -> \`${input.wiki.writtenState}\``,
    `- Pre-approval refusal: \`${input.wiki.preApprovalRefusalCode ?? "none"}\``,
    `- Written file sha256: \`${input.wiki.fileSha256After}\``,
    `- Idempotent retry: \`${input.wiki.idempotentRetry}\``,
    "",
    "## Graph Output",
    "",
    `- Nodes: ${input.graph.nodes}`,
    `- Edges: ${input.graph.edges}`,
    `- Readiness: \`${input.graph.readiness}\``,
    `- Graph notes written: ${input.graph.graphNotesWritten}`,
    `- Knowledge map notes written: ${input.graph.mapNotesWritten}`,
    `- Sample links: ${input.graph.sampleLinks.map((link) => `\`${link}\``).join(", ") || "none"}`,
    "",
    "## Retrieval Evidence",
    "",
    `- Accepted quality: \`${input.retrieval.accepted.quality?.status ?? "none"}\``,
    `- Accepted evidence: ${input.retrieval.accepted.evidence.map((item) => `\`${item.recordId}\``).join(", ") || "none"}`,
    `- Refused quality: \`${input.retrieval.refused.quality?.status ?? "none"}\``,
    `- Refusal types: ${input.retrieval.refused.quality?.refusals.map((issue) => `\`${issue.type}:${issue.recordId}\``).join(", ") || "none"}`,
    "",
    "## Proof Files",
    "",
    ...input.proofFiles.map((file) => `- \`${file}\``),
    "",
  ];
  return lines.join("\n");
}

async function main() {
  const outputDir = path.resolve(process.env.INS53_SMOKE_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR);
  const proofRoot = path.resolve(PROJECT_WORKSPACE, "output", "proof");
  assert.ok(outputDir === proofRoot || outputDir.startsWith(proofRoot + path.sep), `Smoke output must stay under ${proofRoot}`);

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const dbPath = path.join(outputDir, "integrated-memory-benchmark.db");
  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.MC_WORKSPACE_ROOT = path.join(outputDir, "fixture-workspace");
  rmSync(process.env.MC_WORKSPACE_ROOT, { recursive: true, force: true });
  mkdirSync(process.env.MC_WORKSPACE_ROOT, { recursive: true });

  const [
    { createCompany },
    { closeOrchestrationDb, getOrchestrationDb },
    { createCompanyMemoryRecord },
    { createProject, createTask },
    { buildMemoryContext },
    {
      applyMemoryCurationAction,
      getMemoryQualityDashboard,
      listMemoryQualityQueue,
      recordMemoryQualityRecomputation,
      recordMemoryQualitySignal,
    },
    { executeApprovedWikiMarkdownWriteback, prepareWikiMarkdownWriteback },
    { updateWikiWritebackApprovalState },
    {
      generateKnowledgeMapNotes,
      getCompanyMemorySettings,
      getMemoryGraph,
      initializeCompanyMemoryVault,
      writeGraphNoteMetadata,
    },
  ] = await Promise.all([
    import("@/lib/orchestration/company-service"),
    import("@/lib/orchestration/db"),
    import("@/lib/orchestration/company-memory"),
    import("@/lib/orchestration/service"),
    import("@/lib/orchestration/memory-context"),
    import("@/lib/orchestration/memory-quality"),
    import("@/lib/orchestration/wiki-writeback-service"),
    import("@/lib/orchestration/wiki-writeback-requests"),
    import("@/lib/orchestration/memory-vault"),
  ]);

  const db = getOrchestrationDb();
  const stamp = Date.now();
  const checks: SmokeCheck[] = [];
  const company = createCompany({
    name: `INS-53 Integrated Memory Company ${stamp}`,
    description: "Fixture company for the integrated memory benchmark smoke harness.",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `INS-53 Benchmark Project ${stamp}`,
    description: "Fixture project used to prove integrated memory behavior.",
    color: "#0f766e",
    emoji: "icon:gauge",
    status: "active",
  }).project;
  const task = createTask({
    projectId: project.id,
    title: "INS-53 integrated smoke fixture task",
    description: "Fixture task for memory benchmark smoke evidence.",
    priority: "P1",
    type: "infrastructure",
    status: "in-progress",
    labels: [],
    createdBy: "ins-53-smoke",
  }).task;

  initializeCompanyMemoryVault(company.slug);
  const { settings } = getCompanyMemorySettings(company.slug);
  assert.ok(settings.vaultRoot.startsWith(process.env.MC_WORKSPACE_ROOT + path.sep), "Fixture vault must stay under the smoke workspace");

  const approvedMemory = createCompanyMemoryRecord(company.slug, {
    title: "Approved Wiki Benchmark Memory",
    body: "Approved source memory for the write-back smoke path. It should be eligible for an approved company wiki note.",
    kind: "workflow_note",
    scope: "company",
    status: "active",
    source: "task",
    confidence: 0.96,
    taskId: task.key,
    reviewRequired: true,
    reviewState: "approved",
    metadata: { sourcePath: path.join(outputDir, "fixtures", "approved-wiki-memory.md") },
  }).memory;
  const secondApprovedMemory = createCompanyMemoryRecord(company.slug, {
    title: "Second Approved Wiki Benchmark Memory",
    body: "Second approved source memory proving multi-source wiki write-back provenance.",
    kind: "decision",
    scope: "project",
    status: "active",
    source: "task",
    confidence: 0.93,
    projectId: project.id,
    taskId: task.key,
    reviewRequired: true,
    reviewState: "approved",
    metadata: { sourcePath: path.join(outputDir, "fixtures", "second-approved-wiki-memory.md") },
  }).memory;

  const sourceBase = path.join(outputDir, "fixtures");
  insertIndexedMemory({
    db,
    companyId: company.id,
    projectId: project.id,
    taskKey: task.key,
    id: "quality-weak-provenance",
    title: "Quality Weak Provenance",
    content: "Quality fixture with missing provenance and intentionally weak graph support.",
    sourcePath: path.join(sourceBase, "quality-weak-provenance.md"),
    layer: "company",
    linkedIds: [],
    frontmatter: { confidence: 0.72, review_state: undefined },
  });
  insertIndexedMemory({
    db,
    companyId: company.id,
    projectId: project.id,
    taskKey: task.key,
    id: "quality-duplicate-a",
    title: "Quality Duplicate Cluster",
    content: "Duplicate cluster fixture A for dashboard scoring.",
    sourcePath: path.join(sourceBase, "quality-duplicate-a.md"),
    pinned: 1,
    frontmatter: { confidence: 0.9 },
  });
  insertIndexedMemory({
    db,
    companyId: company.id,
    projectId: project.id,
    taskKey: task.key,
    id: "quality-duplicate-b",
    title: "Quality Duplicate Cluster",
    content: "Duplicate cluster fixture B for dashboard scoring.",
    sourcePath: path.join(sourceBase, "quality-duplicate-b.md"),
    frontmatter: { confidence: 0.88 },
  });
  insertIndexedMemory({
    db,
    companyId: company.id,
    projectId: project.id,
    taskKey: task.key,
    id: "graph-backed-evidence",
    title: "Graph Backed Evidence",
    content: "Graph-backed fixture linked to a task key and map node for retrieval evidence envelopes.",
    sourcePath: path.join(sourceBase, "maps", "graph-backed-evidence.md"),
    layer: "project",
    linkedIds: [task.key, "Quality Duplicate Cluster"],
    frontmatter: { confidence: 0.97, evidence_cluster: "ins-53-integrated" },
  });

  recordMemoryQualitySignal(company.slug, {
    targetType: "source_index",
    targetId: "quality-weak-provenance",
    queue: "weak_provenance",
    qualityScore: 41,
    reason: "Missing approval state and indexed source provenance",
    evidence: { fixture: "quality-weak-provenance" },
    scoringContract: "ins-53-integrated-smoke-v1",
    sourceFingerprint: "quality-weak-provenance-v1",
  });
  recordMemoryQualitySignal(company.slug, {
    targetType: "source_index",
    targetId: "quality-duplicate-b",
    queue: "duplicates",
    qualityScore: 52,
    reason: "Title duplicates another indexed memory source",
    evidence: { duplicateOf: "quality-duplicate-a" },
    scoringContract: "ins-53-integrated-smoke-v1",
    sourceFingerprint: "quality-duplicate-b-v1",
  });
  recordMemoryQualityRecomputation(company.slug, {
    recomputationKey: "ins-53-integrated-smoke-v1",
    inputHash: sha256(JSON.stringify({ company: company.id, fixture: stamp })),
    status: "completed",
    scoresWritten: 2,
  });
  const curation = applyMemoryCurationAction(company.slug, {
    targetType: "source_index",
    targetId: "quality-weak-provenance",
    action: "acknowledge",
    actor: "INS-53 smoke harness",
    note: "Acknowledged during integrated benchmark smoke run.",
    idempotencyKey: "ins-53-acknowledge-quality-weak-provenance",
  });
  const dashboard = getMemoryQualityDashboard(company.slug);
  const duplicateQueue = listMemoryQualityQueue(company.slug, { queue: "duplicates", state: "all" });
  addCheck(checks, "dashboard quality metrics populated", dashboard.kpis.totalScored === 2 && dashboard.kpis.acknowledgedIssues === 1 && dashboard.queues.duplicates.count === 1, "dashboard includes scored, acknowledged, and duplicate queue metrics");
  addCheck(checks, "curation action reflected in queue", curation.state.state === "acknowledged" && duplicateQueue.items.some((item) => item.targetId === "quality-duplicate-b"), "curation state and duplicate queue are queryable");

  const prepared = await prepareWikiMarkdownWriteback(company.slug, {
    targetPath: "company/ins-53-approved-wiki-writeback.md",
    sourceMemoryIds: [approvedMemory.id, secondApprovedMemory.id],
    curationActionIds: [curation.action.id],
    idempotencyKey: "ins-53-integrated-wiki-writeback",
    requestedBy: "INS-53 smoke harness",
  });
  let preApprovalRefusalCode: string | null = null;
  try {
    await executeApprovedWikiMarkdownWriteback(prepared.request.id, { actor: "INS-53 smoke harness" });
  } catch (error) {
    preApprovalRefusalCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
  }
  const approvedRequest = updateWikiWritebackApprovalState(prepared.request.id, {
    approvalState: "approved",
    approvedBy: "INS-53 smoke harness",
  });
  const written = await executeApprovedWikiMarkdownWriteback(prepared.request.id, { actor: "INS-53 smoke harness" });
  const retry = await executeApprovedWikiMarkdownWriteback(prepared.request.id, { actor: "INS-53 smoke harness" });
  const wikiContent = readFileSync(written.filePath, "utf-8");
  addCheck(checks, "wiki write-back requires approval before writing", preApprovalRefusalCode === "writeback_not_approved", "unapproved request was refused before file write");
  addCheck(checks, "approved wiki write-back writes curated markdown", written.fileWritten && wikiContent.includes("Approved Wiki Benchmark Memory") && written.request.approvalState === "written", "approved request wrote generated wiki content");
  addCheck(checks, "wiki write-back retry is idempotent", retry.idempotent && !retry.fileWritten, "re-running written request reports idempotent success without another write");

  const graphNotes = writeGraphNoteMetadata(company.slug, { apply: true, limit: 100 });
  const mapNotes = generateKnowledgeMapNotes(company.slug, { apply: true, limit: 100 });
  const graph = getMemoryGraph(company.slug, { limit: 200 });
  const graphLinks = graphNotes.notes.flatMap((note) => note.links.map((link) => link.wikilink)).slice(0, 8);
  addCheck(checks, "graph metadata generated with links", graphNotes.written.length > 0 && graphLinks.length > 0 && graphNotes.errors.length === 0, "graph note metadata was written with Obsidian links");
  addCheck(checks, "knowledge map artifacts generated", mapNotes.notes.length >= 4 && mapNotes.notes.some((note) => note.clusters.length > 0), "knowledge map notes include clustered source metadata");
  addCheck(checks, "memory graph includes nodes and edges", graph.nodes.length > 0 && graph.edges.length > 0, "graph explorer data includes linked nodes and edges");

  const acceptedContext = buildMemoryContext({
    db,
    companyId: company.id,
    agentId: "ins-53-smoke-agent",
    agentRole: "QA Verification Lead",
    projectId: project.id,
    limit: 25,
  });
  const accepted = summarizeContext(acceptedContext);

  const refusalCompany = createCompany({
    name: `INS-53 Retrieval Refusal Company ${stamp}`,
    description: "Fixture company for integrated refusal behavior.",
    status: "active",
  }).company;
  const refusalProject = createProject({
    companyId: refusalCompany.id,
    name: `INS-53 Retrieval Refusal Project ${stamp}`,
    description: "Fixture project for integrated refusal behavior.",
    color: "#991b1b",
    emoji: "icon:ban",
    status: "active",
  }).project;
  insertIndexedMemory({
    db,
    companyId: refusalCompany.id,
    projectId: refusalProject.id,
    taskKey: "INS-53",
    id: "stale-refused-evidence",
    title: "Stale Refused Evidence",
    content: "Stale fixture older than the retrieval threshold.",
    sourcePath: path.join(sourceBase, "stale-refused-evidence.md"),
    fileMtime: isoDaysAgo(730),
  });
  insertIndexedMemory({
    db,
    companyId: refusalCompany.id,
    projectId: refusalProject.id,
    taskKey: "INS-53",
    id: "unapproved-refused-evidence",
    title: "Unapproved Refused Evidence",
    content: "Unapproved fixture that should be refused.",
    sourcePath: path.join(sourceBase, "unapproved-refused-evidence.md"),
    frontmatter: { review_state: "requested", confidence: 0.92 },
  });
  insertIndexedMemory({
    db,
    companyId: refusalCompany.id,
    projectId: refusalProject.id,
    taskKey: "INS-53",
    id: "low-confidence-refused-evidence",
    title: "Low Confidence Refused Evidence",
    content: "Low-confidence fixture below injection threshold.",
    sourcePath: path.join(sourceBase, "low-confidence-refused-evidence.md"),
    frontmatter: { confidence: 0.2 },
  });
  const refused = summarizeContext(buildMemoryContext({
    db,
    companyId: refusalCompany.id,
    agentId: "ins-53-refusal-agent",
    agentRole: "QA Verification Lead",
    projectId: refusalProject.id,
    limit: 10,
  }));

  addCheck(
    checks,
    "retrieval evidence envelopes emitted",
    accepted.evidence.length > 0
      && accepted.evidence.every((item) => /^[a-f0-9]{64}$/.test(item.envelope.envelopeId) && /^[a-f0-9]{64}$/.test(item.envelope.contentSha256))
      && accepted.evidence.some((item) => item.recordId.includes("graph-backed-evidence") || item.sourcePath?.includes("graph-backed-evidence")),
    "accepted context includes deterministic envelope hashes and graph-backed provenance",
  );
  addCheck(checks, "retrieval warnings and accepted evidence coexist", accepted.quality?.status === "degraded" && Boolean(accepted.quality?.warnings.length) && accepted.evidence.length > 0, "accepted retrieval injects evidence while surfacing quality warnings");
  addCheck(checks, "retrieval refusal behavior surfaced", refused.quality?.status === "refused" && refused.evidence.length === 0 && refused.quality.refusals.length >= 3, "all refusal fixtures are excluded with refusal reasons");

  const evidence = {
    generatedAt: new Date().toISOString(),
    outputDir,
    dbPath,
    workspaceRoot: process.env.MC_WORKSPACE_ROOT,
    company: { id: company.id, slug: company.slug },
    project: { id: project.id, slug: project.slug },
    task: { id: task.id, key: task.key },
    checks,
    dashboard,
    duplicateQueue,
    wiki: {
      requestId: prepared.request.id,
      targetPath: written.filePath,
      requestedState: prepared.request.approvalState,
      approvedState: approvedRequest.approvalState,
      writtenState: written.request.approvalState,
      preApprovalRefusalCode,
      fileSha256Before: written.fileSha256Before,
      fileSha256After: written.fileSha256After,
      idempotentRetry: retry.idempotent,
    },
    graph: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      readiness: graph.readiness,
      qualitySignals: graph.qualitySignals,
      graphNotesPlanned: graphNotes.planned.length,
      graphNotesWritten: graphNotes.written.length,
      graphErrors: graphNotes.errors,
      mapNotes: mapNotes.notes.map((note) => ({
        kind: note.kind,
        title: note.title,
        filePath: note.filePath,
        sha256: note.sha256,
        clusters: note.clusters.length,
      })),
      sampleLinks: graphLinks,
    },
    retrieval: { accepted, refused },
  };

  await writeFile(path.join(outputDir, "integrated-memory-benchmark-smoke.json"), JSON.stringify(evidence, null, 2) + "\n", "utf-8");
  const plannedFiles = [...listFiles(outputDir), "proof-index.md", "sha256s.txt"].sort();
  const index = markdownIndex({
    generatedAt: evidence.generatedAt,
    outputDir,
    checks,
    dashboard,
    wiki: evidence.wiki,
    graph: {
      nodes: evidence.graph.nodes,
      edges: evidence.graph.edges,
      readiness: evidence.graph.readiness.status,
      graphNotesWritten: evidence.graph.graphNotesWritten,
      mapNotesWritten: evidence.graph.mapNotes.length,
      sampleLinks: evidence.graph.sampleLinks,
    },
    retrieval: evidence.retrieval,
    proofFiles: plannedFiles,
  });
  await writeFile(path.join(outputDir, "proof-index.md"), index, "utf-8");
  await writeFile(path.join(outputDir, "sha256s.txt"), [
    `integrated-memory-benchmark-smoke.json  ${sha256(JSON.stringify(evidence, null, 2) + "\n")}`,
    `proof-index.md  ${sha256(index)}`,
    "",
  ].join("\n"), "utf-8");

  closeOrchestrationDb();
  const failed = checks.filter((check) => check.status === "fail");
  console.log(JSON.stringify({
    outputDir,
    proofIndex: path.join(outputDir, "proof-index.md"),
    proofJson: path.join(outputDir, "integrated-memory-benchmark-smoke.json"),
    checksPassed: checks.length - failed.length,
    checksFailed: failed.length,
  }, null, 2));
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
