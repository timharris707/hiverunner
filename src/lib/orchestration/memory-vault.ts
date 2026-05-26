import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  createCompanyMemoryRecord,
  type CompanyMemoryKind,
  type CompanyMemoryRecord,
} from "@/lib/orchestration/company-memory";
import {
  buildEvidenceEnvelope,
  buildMemoryContext,
  type MemoryContextEvidenceItem,
  type MemoryContextResult,
  type MemoryRetrievalQuality,
} from "@/lib/orchestration/memory-context";
import type { MemoryCandidate } from "@/lib/orchestration/memory-candidates";
import {
  normalizeMemoryUtilizationMatchedUseMetadata,
  normalizeMemoryUtilizationReceiptsMetadata,
  type MemoryUtilizationMatchedUseMetadata,
  type MemoryUtilizationReceiptsMetadata,
} from "@/lib/orchestration/memory-utilization-receipts";
import { resolveHiveRunnerWorkspaceRoot } from "@/lib/workspaces/root";

export type CompanyMemorySettings = {
  canonicalMode: "company_vault";
  vaultRoot: string;
  indexGlobalWiki: boolean;
  allowWikiWrites: false;
};

export type MemoryIndexRecord = {
  recordId: string;
  companyId: string | null;
  sourceId: string;
  sourcePath: string;
  layer: string;
  title: string;
  contentExcerpt: string;
  fileType: string;
  fileMtime: string | null;
  frontmatter: Record<string, unknown>;
  tags: string[];
  linkedIds: string[];
  subdirectory: string | null;
  agentAttribution: string | null;
  projectLink: string | null;
  pinned: boolean;
  hiveRunnerTags: string[];
  status: "active" | "archived" | "error";
  indexedAt: string;
  indexError: string | null;
  writeback: MemoryWritebackSummary | null;
};

export type MemorySyncResult = {
  companyId: string;
  vaultRoot: string;
  filesChecked: number;
  filesReindexed: number;
  filesRemoved: number;
  errors: Array<{ path: string; error: string }>;
};

export type KnowledgeMapKind = "entities" | "projects" | "workflows" | "evidence";

export type KnowledgeMapCluster = {
  id: string;
  title: string;
  summary: string;
  sourceRecordIds: string[];
  sources: Array<{
    recordId: string;
    title: string;
    sourcePath: string;
    layer: string;
    tags: string[];
  }>;
};

export type KnowledgeMapNote = {
  kind: KnowledgeMapKind;
  title: string;
  filePath: string;
  markdown: string;
  sha256: string;
  clusters: KnowledgeMapCluster[];
};

export type KnowledgeMapGenerationResult = {
  company: { id: string; slug: string; name: string };
  vaultRoot: string;
  dryRun: boolean;
  notes: KnowledgeMapNote[];
};

export type MemoryWritebackSummary = {
  candidateId: string | null;
  action: string;
  writtenAt: string;
  attribution: string | null;
  error: string | null;
};

export type MemoryInjectionEvidenceItem = {
  recordId: string;
  title: string;
  sourcePath: string | null;
  layer: string;
  reason: string;
  source: {
    type: "memory_source_index" | "company_memory_record";
    sourceId?: string;
    kind?: string;
    scope?: string;
    status?: string;
    confidence?: number;
    fileType?: string;
    fileMtime?: string | null;
    indexedAt?: string;
    updatedAt?: string;
    frontmatter?: Record<string, unknown>;
    tags?: string[];
    metadata?: Record<string, unknown>;
  };
};

export type MemoryInjectionEvidenceResult = {
  company: { id: string; slug: string; name: string };
  run: {
    id: string;
    status: string;
    taskId: string;
    taskKey: string;
    taskTitle: string;
    projectId: string;
    projectName: string;
    agentId: string;
    agentName: string;
    agentRole: string | null;
    injectedMemorySha256: string | null;
  };
  injectionSource: "vault_index" | "memory_registry_fallback" | "none";
  evidence: MemoryInjectionEvidenceItem[];
  quality?: MemoryRetrievalQuality;
  utilization?: {
    receipts?: MemoryUtilizationReceiptsMetadata;
    matchedUse?: MemoryUtilizationMatchedUseMetadata;
  };
  diagnostics?: MemoryInjectionDiagnostics;
};

export type MemoryInjectionDiagnostics = {
  version: 1;
  source: MemoryContextResult["source"] | "none";
  quality: MemoryRetrievalQuality;
  evidence: MemoryContextEvidenceItem[];
};

export type MemoryGraphNode = {
  id: string;
  label: string;
  layer: string;
  sourcePath?: string;
  taskKey?: string;
  degree: number;
};

export type MemoryGraphEdge = {
  source: string;
  target: string;
  label: string;
};

export type MemoryGraphQualitySignal =
  | {
      id: string;
      type: "orphan_note";
      severity: "high" | "medium" | "low";
      title: string;
      recordIds: string[];
      detail: string;
    }
  | {
      id: string;
      type: "duplicate_cluster";
      severity: "high" | "medium" | "low";
      title: string;
      recordIds: string[];
      detail: string;
    }
  | {
      id: string;
      type: "missing_backlink";
      severity: "high" | "medium" | "low";
      title: string;
      source: string;
      target: string;
      recordIds: string[];
      detail: string;
    }
  | {
      id: string;
      type: "stale_evidence_link";
      severity: "high" | "medium" | "low";
      title: string;
      source: string;
      missingLink: string;
      recordIds: string[];
      detail: string;
    };

export type MemoryGraphMapCoverage = {
  totalRecords: number;
  coveredRecords: number;
  uncoveredRecords: number;
  coveragePercent: number;
  uncoveredSample: Array<{ recordId: string; title: string; layer: string; sourcePath: string }>;
};

export type MemoryGraph = {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  readiness: {
    status: "ready" | "needs_attention" | "blocked";
    score: number;
    summary: string;
  };
  qualitySignals: {
    orphanNotes: MemoryGraphQualitySignal[];
    duplicateClusters: MemoryGraphQualitySignal[];
    missingBacklinks: MemoryGraphQualitySignal[];
    staleEvidenceLinks: MemoryGraphQualitySignal[];
  };
  mapCoverage: MemoryGraphMapCoverage;
};

export type GraphNoteKind = "company" | "project" | "task" | "memory" | "curation" | "evidence";

export type GraphNoteLink = {
  targetId: string;
  targetTitle: string;
  label: string;
  wikilink: string;
};

export type GraphNoteMetadata = {
  id: string;
  kind: GraphNoteKind;
  title: string;
  aliases: string[];
  tags: string[];
  links: GraphNoteLink[];
  frontmatter: Record<string, unknown>;
  body: string;
  markdown: string;
  relativePath: string;
};

export type GraphNoteMetadataResult = {
  company: { id: string; slug: string; name: string };
  vaultRoot: string;
  notes: GraphNoteMetadata[];
};

export type GraphNoteWriteResult = GraphNoteMetadataResult & {
  dryRun: boolean;
  zone: "graph" | "maps";
  planned: Array<{ id: string; filePath: string; sha256: string }>;
  written: Array<{ id: string; filePath: string; sha256: string }>;
  errors: Array<{ id: string; filePath: string; error: string }>;
};

type CompanyWorkspaceRow = {
  id: string;
  slug: string;
  name: string;
  company_code: string | null;
  workspace_root: string | null;
  settings_json: string | null;
};

type IndexedRow = {
  record_id: string;
  company_id: string | null;
  source_id: string;
  source_path: string;
  layer: string;
  title: string;
  content_excerpt: string;
  file_type: string;
  file_mtime: string | null;
  frontmatter_json: string;
  tags_json: string;
  linked_ids_json: string;
  subdirectory: string | null;
  agent_attribution: string | null;
  project_link: string | null;
  pinned: 0 | 1;
  hiverunner_tags_json: string;
  status: "active" | "archived" | "error";
  indexed_at: string;
  index_error: string | null;
  writeback_candidate_id: string | null;
  writeback_action: string | null;
  writeback_written_at: string | null;
  writeback_attribution: string | null;
  writeback_error: string | null;
};

type EvidenceIndexedRow = {
  record_id: string;
  title: string;
  content_excerpt: string;
  layer: string;
  source_id: string;
  source_path: string;
  tags_json: string;
  frontmatter_json: string;
  file_type: string;
  file_mtime: string | null;
  indexed_at: string;
  status: "active" | "archived" | "error";
};

type EvidenceMemoryRecordRow = {
  id: string;
  title: string;
  body: string;
  kind: string;
  scope: string;
  source: string;
  confidence: number;
  project_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  execution_run_id: string | null;
  metadata_json: string;
  updated_at: string;
};

type MemoryInjectionRunRow = {
  execution_run_id: string;
  execution_run_status: string;
  execution_run_metadata_json: string | null;
  task_id: string;
  task_key: string;
  task_title: string;
  project_id: string;
  project_name: string;
  agent_id: string;
  agent_name: string;
  agent_role: string | null;
  company_id: string;
  company_slug: string;
  company_name: string;
};

type StoredMemoryEvidenceRecord = {
  recordId?: unknown;
  sourcePath?: unknown;
  title?: unknown;
  layer?: unknown;
  inclusionReasons?: unknown;
};

type StoredMemoryEvidence = {
  source?: unknown;
  recordCount?: unknown;
  records?: unknown;
};

type ApprovedCandidateBackfillRow = {
  id: string;
  company_id: string | null;
  body: string;
  type: string | null;
  tags: string | null;
  category: string | null;
  status: "approved";
  scope: "role_project" | "company";
  proposed_by_agent: string | null;
  source_task_id: string | null;
  source_task_key: string | null;
  source_run_id: string | null;
  proposed_at: string;
  routing_target: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  target_source_file: string | null;
};

type GraphProjectRow = {
  id: string;
  slug: string | null;
  name: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type GraphTaskRow = {
  id: string;
  task_key: string | null;
  title: string;
  description: string;
  priority: string;
  type: string;
  status: string;
  project_id: string;
  project_name: string;
  assignee_agent_id: string | null;
  assignee_name: string | null;
  labels_json: string | null;
  created_at: string;
  updated_at: string;
};

type GraphMemoryRecordRow = {
  id: string;
  title: string;
  body: string;
  kind: string;
  scope: string;
  status: string;
  source: string;
  confidence: number;
  project_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  execution_run_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type GraphCurationRow = {
  id: string;
  target_type: string;
  target_id: string;
  state: string;
  actor: string | null;
  note: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type GraphGoalEvidenceRow = {
  id: string;
  item_id: string;
  item_kind: string;
  status: string;
  result_text: string;
  artifact_uri: string | null;
  sprint_name: string;
  project_id: string;
  project_name: string;
  created_at: string;
  updated_at: string;
};

type GraphNoteDraft = {
  id: string;
  kind: GraphNoteKind;
  title: string;
  aliases: string[];
  tags: string[];
  frontmatter: Record<string, unknown>;
  linkTargetIds: string[];
  sections: string[];
};

const VAULT_FOLDERS = ["company", "projects", "agents", "sessions", "inbox", "archive", "graph", "maps"] as const;

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function slugifyMemoryPathPart(value: string | null | undefined, fallback = "memory"): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || fallback;
}

function resolveDefaultWorkspaceRoot(company: CompanyWorkspaceRow): string {
  if (company.workspace_root?.trim()) return path.resolve(company.workspace_root);
  return path.join(
    resolveHiveRunnerWorkspaceRoot(),
    "companies",
    slugifyMemoryPathPart(company.slug),
  );
}

function resolveCompany(companyIdOrSlug: string, db = getOrchestrationDb()): CompanyWorkspaceRow {
  const needle = companyIdOrSlug.trim();
  const row = db.prepare(
    `SELECT id, slug, name, company_code, workspace_root, settings_json
     FROM companies
     WHERE id = ? OR slug = ? OR UPPER(company_code) = UPPER(?)
     LIMIT 1`,
  ).get(needle, needle, needle) as CompanyWorkspaceRow | undefined;
  if (!row) throw new Error(`Company not found: ${companyIdOrSlug}`);
  return row;
}

export function getCompanyMemorySettings(
  companyIdOrSlug: string,
  options: { persistDefaults?: boolean; db?: Database.Database } = {},
): { company: CompanyWorkspaceRow; settings: CompanyMemorySettings } {
  const db = options.db ?? getOrchestrationDb();
  const company = resolveCompany(companyIdOrSlug, db);
  const parsed = parseJsonObject(company.settings_json);
  const memory = parsed.memory && typeof parsed.memory === "object" && !Array.isArray(parsed.memory)
    ? parsed.memory as Record<string, unknown>
    : parseJsonObject(typeof parsed.memory === "string" ? parsed.memory : undefined);
  const vaultRoot = typeof memory.vaultRoot === "string" && memory.vaultRoot.trim()
    ? path.resolve(memory.vaultRoot)
    : path.join(resolveDefaultWorkspaceRoot(company), "memory");
  const settings: CompanyMemorySettings = {
    canonicalMode: "company_vault",
    vaultRoot,
    indexGlobalWiki: memory.indexGlobalWiki === undefined ? true : memory.indexGlobalWiki !== false,
    allowWikiWrites: false,
  };

  if (options.persistDefaults) {
    const next = {
      ...parsed,
      memory: settings,
    };
    db.prepare("UPDATE companies SET settings_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(next),
      new Date().toISOString(),
      company.id,
    );
  }

  return { company, settings };
}

export function initializeCompanyMemoryVault(
  companyIdOrSlug: string,
  options: { db?: Database.Database } = {},
): { companyId: string; vaultRoot: string; folders: string[] } {
  const { company, settings } = getCompanyMemorySettings(companyIdOrSlug, {
    persistDefaults: true,
    db: options.db,
  });
  const folders = VAULT_FOLDERS.map((folder) => path.join(settings.vaultRoot, folder));
  for (const folder of folders) fs.mkdirSync(folder, { recursive: true });
  return { companyId: company.id, vaultRoot: settings.vaultRoot, folders };
}

function splitFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: raw };
  const yaml = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, "");
  const frontmatter: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(",")
        .map((part) => part.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      frontmatter[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return { frontmatter, body };
}

function yamlScalar(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(String(item))).join(", ")}]`;
  if (value === null || value === undefined) return "";
  return JSON.stringify(String(value));
}

export function serializeMemoryMarkdown(input: {
  frontmatter: Record<string, unknown>;
  body: string;
}): string {
  const keys = Object.keys(input.frontmatter).filter((key) => input.frontmatter[key] !== undefined);
  const yaml = keys.map((key) => `${key}: ${yamlScalar(input.frontmatter[key])}`).join("\n");
  return `---\n${yaml}\n---\n\n${input.body.trim()}\n`;
}

function firstHeading(body: string): string | null {
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function extractLinks(markdown: string): string[] {
  const links = new Set<string>();
  for (const match of markdown.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
    if (match[1]?.trim()) links.add(match[1].trim());
  }
  for (const match of markdown.matchAll(/\b[A-Z]{2,10}-\d+\b/g)) {
    links.add(match[0]);
  }
  return [...links];
}

function extractTags(frontmatter: Record<string, unknown>, markdown: string): string[] {
  const tags = new Set<string>();
  const rawTags = frontmatter.tags;
  if (Array.isArray(rawTags)) rawTags.map(String).forEach((tag) => tags.add(tag));
  if (typeof rawTags === "string") rawTags.split(/[,\s]+/).forEach((tag) => tag && tags.add(tag));
  for (const match of markdown.matchAll(/(?:^|\s)#([A-Za-z0-9_/-]+)/g)) {
    tags.add(match[1]);
  }
  return [...tags].filter(Boolean);
}

function classifyVaultLayer(relativePath: string, sourceId: string): string {
  if (sourceId === "global-wiki") return "wiki";
  const [first] = relativePath.split(path.sep);
  if (first === "projects") return "project";
  if (first === "agents") return "agent";
  if (first === "sessions") return "session";
  if (first === "inbox") return "inbox";
  if (first === "archive") return "archive";
  return "company";
}

function walkMarkdownFiles(root: string, limit = 5000): string[] {
  const files: string[] = [];
  if (!fs.existsSync(root)) return files;
  const visit = (dir: string) => {
    if (files.length >= limit) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
        files.push(full);
      }
      if (files.length >= limit) break;
    }
  };
  visit(root);
  return files;
}

function recordIdFor(companyId: string, sourcePath: string): string {
  return createHash("sha256").update(`${companyId}:${path.resolve(sourcePath)}`).digest("hex");
}

function tableIdIsInteger(db: Database.Database, tableName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string; type: string }>;
  return columns.some((column) => column.name === "id" && column.type.toUpperCase().includes("INTEGER"));
}

function indexMarkdownFile(input: {
  db: Database.Database;
  companyId: string;
  root: string;
  sourceId: string;
  filePath: string;
}): string {
  const stat = fs.statSync(input.filePath);
  const raw = fs.readFileSync(input.filePath, "utf-8");
  const { frontmatter, body } = splitFrontmatter(raw);
  const relativePath = path.relative(input.root, input.filePath);
  const title = String(frontmatter.title ?? firstHeading(body) ?? path.basename(input.filePath, path.extname(input.filePath)));
  const layer = String(frontmatter.layer ?? classifyVaultLayer(relativePath, input.sourceId));
  const tags = extractTags(frontmatter, body);
  const links = extractLinks(body);
  const excerpt = body.replace(/\s+/g, " ").trim().slice(0, 700);
  const now = new Date().toISOString();
  const recordId = String(frontmatter.id ?? recordIdFor(input.companyId, input.filePath));

  input.db.prepare(`
    INSERT INTO memory_source_index (
      record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts,
      file_type, created_at, updated_at, file_mtime, frontmatter_json, tags_json, linked_ids_json,
      subdirectory, agent_attribution, project_link, pinned, hiverunner_tags_json, status, indexed_at, index_error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL)
    ON CONFLICT(record_id) DO UPDATE SET
      company_id = excluded.company_id,
      source_id = excluded.source_id,
      source_path = excluded.source_path,
      layer = excluded.layer,
      title = excluded.title,
      content_excerpt = excluded.content_excerpt,
      content_fts = excluded.content_fts,
      file_type = excluded.file_type,
      updated_at = excluded.updated_at,
      file_mtime = excluded.file_mtime,
      frontmatter_json = excluded.frontmatter_json,
      tags_json = excluded.tags_json,
      linked_ids_json = excluded.linked_ids_json,
      subdirectory = excluded.subdirectory,
      agent_attribution = excluded.agent_attribution,
      project_link = excluded.project_link,
      pinned = excluded.pinned,
      hiverunner_tags_json = excluded.hiverunner_tags_json,
      status = 'active',
      indexed_at = excluded.indexed_at,
      index_error = NULL
  `).run(
    recordId,
    input.companyId,
    input.sourceId,
    path.resolve(input.filePath),
    layer,
    title,
    excerpt,
    body,
    "markdown",
    String(frontmatter.created ?? now),
    String(frontmatter.updated ?? now),
    stat.mtime.toISOString(),
    JSON.stringify(frontmatter),
    JSON.stringify(tags),
    JSON.stringify(links),
    path.dirname(relativePath) === "." ? null : path.dirname(relativePath),
    typeof frontmatter.agent === "string" ? frontmatter.agent : null,
    typeof frontmatter.project === "string" ? frontmatter.project : null,
    frontmatter.pinned === true || frontmatter.pinned === "true" ? 1 : 0,
    JSON.stringify(tags.filter((tag) => tag.startsWith("hiverunner/"))),
    now,
  );
  return recordId;
}

export function syncCompanyMemoryVault(
  companyIdOrSlug: string,
  options: { includeGlobalWiki?: boolean; db?: Database.Database } = {},
): MemorySyncResult {
  const db = options.db ?? getOrchestrationDb();
  const { company, settings } = getCompanyMemorySettings(companyIdOrSlug, { persistDefaults: true, db });
  initializeCompanyMemoryVault(company.id, { db });
  const startedAt = new Date().toISOString();
  const syncLogUsesIntegerId = tableIdIsInteger(db, "memory_sync_log");
  const logInsert = syncLogUsesIntegerId
    ? db.prepare(`INSERT INTO memory_sync_log (company_id, source_id, started_at) VALUES (?, ?, ?)`)
        .run(company.id, "company-vault", startedAt)
    : db.prepare(`INSERT INTO memory_sync_log (id, company_id, source_id, started_at) VALUES (?, ?, ?, ?)`)
        .run(randomUUID(), company.id, "company-vault", startedAt);
  const logId = syncLogUsesIntegerId ? Number(logInsert.lastInsertRowid) : null;
  const logUuid = syncLogUsesIntegerId ? null : String((db.prepare("SELECT id FROM memory_sync_log WHERE rowid = last_insert_rowid()").get() as { id: string } | undefined)?.id);

  const sources = [{ sourceId: "company-vault", root: settings.vaultRoot }];
  if ((options.includeGlobalWiki ?? settings.indexGlobalWiki) && fs.existsSync(path.join(process.env.HOME || "", "wiki"))) {
    sources.push({ sourceId: "global-wiki", root: path.join(process.env.HOME || "", "wiki") });
  }

  const seen = new Set<string>();
  let filesChecked = 0;
  let filesReindexed = 0;
  const errors: Array<{ path: string; error: string }> = [];

  for (const source of sources) {
    for (const filePath of walkMarkdownFiles(source.root)) {
      filesChecked += 1;
      try {
        const id = indexMarkdownFile({ db, companyId: company.id, root: source.root, sourceId: source.sourceId, filePath });
        seen.add(id);
        filesReindexed += 1;
      } catch (error) {
        errors.push({ path: filePath, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  const existing = db.prepare("SELECT record_id FROM memory_source_index WHERE company_id = ? AND source_id IN ('company-vault','global-wiki')").all(company.id) as Array<{ record_id: string }>;
  let filesRemoved = 0;
  const archive = db.prepare("UPDATE memory_source_index SET status = 'archived', indexed_at = ? WHERE record_id = ?");
  const now = new Date().toISOString();
  for (const row of existing) {
    if (!seen.has(row.record_id)) {
      archive.run(now, row.record_id);
      filesRemoved += 1;
    }
  }

  db.prepare(
    `UPDATE memory_sync_log
     SET completed_at = ?, files_checked = ?, files_reindexed = ?, files_removed = ?, errors = ?, error_detail = ?
     WHERE id = ?`,
  ).run(now, filesChecked, filesReindexed, filesRemoved, errors.length, errors.length ? JSON.stringify(errors.slice(0, 20)) : null, logId ?? logUuid);

  return { companyId: company.id, vaultRoot: settings.vaultRoot, filesChecked, filesReindexed, filesRemoved, errors };
}

function rowToIndexRecord(row: IndexedRow): MemoryIndexRecord {
  return {
    recordId: row.record_id,
    companyId: row.company_id,
    sourceId: row.source_id,
    sourcePath: row.source_path,
    layer: row.layer,
    title: row.title,
    contentExcerpt: row.content_excerpt,
    fileType: row.file_type,
    fileMtime: row.file_mtime,
    frontmatter: parseJsonObject(row.frontmatter_json),
    tags: parseJsonArray(row.tags_json),
    linkedIds: parseJsonArray(row.linked_ids_json),
    subdirectory: row.subdirectory,
    agentAttribution: row.agent_attribution,
    projectLink: row.project_link,
    pinned: row.pinned === 1,
    hiveRunnerTags: parseJsonArray(row.hiverunner_tags_json),
    status: row.status,
    indexedAt: row.indexed_at,
    indexError: row.index_error,
    writeback: row.writeback_action && row.writeback_written_at
      ? {
          candidateId: row.writeback_candidate_id,
          action: row.writeback_action,
          writtenAt: row.writeback_written_at,
          attribution: row.writeback_attribution,
          error: row.writeback_error,
        }
      : null,
  };
}

export function listMemoryIndexRecords(
  companyIdOrSlug: string,
  filters: {
    q?: string;
    layer?: string;
    sourceId?: string;
    status?: "active" | "archived" | "error" | "all";
    tag?: string;
    limit?: number;
    db?: Database.Database;
  } = {},
): { company: { id: string; slug: string; name: string }; records: MemoryIndexRecord[] } {
  const db = filters.db ?? getOrchestrationDb();
  const company = resolveCompany(companyIdOrSlug, db);
  const where = ["msi.company_id = ?"];
  const params: unknown[] = [company.id];
  if (filters.status && filters.status !== "all") {
    where.push("msi.status = ?");
    params.push(filters.status);
  } else if (!filters.status) {
    where.push("msi.status = 'active'");
  }
  if (filters.layer) {
    where.push("msi.layer = ?");
    params.push(filters.layer);
  }
  if (filters.sourceId) {
    where.push("msi.source_id = ?");
    params.push(filters.sourceId);
  }
  if (filters.q?.trim()) {
    const needle = `%${filters.q.trim()}%`;
    where.push("(msi.title LIKE ? OR msi.content_excerpt LIKE ? OR msi.content_fts LIKE ? OR msi.source_path LIKE ?)");
    params.push(needle, needle, needle, needle);
  }
  if (filters.tag?.trim()) {
    where.push("msi.tags_json LIKE ?");
    params.push(`%${filters.tag.trim()}%`);
  }

  const rows = db.prepare(`
    SELECT
           msi.record_id, msi.company_id, msi.source_id, msi.source_path, msi.layer, msi.title,
           msi.content_excerpt, msi.file_type, msi.file_mtime, msi.frontmatter_json, msi.tags_json,
           msi.linked_ids_json, msi.subdirectory, msi.agent_attribution, msi.project_link,
           msi.pinned, msi.hiverunner_tags_json, msi.status, msi.indexed_at, msi.index_error,
           mwl.candidate_id AS writeback_candidate_id,
           mwl.action AS writeback_action,
           mwl.written_at AS writeback_written_at,
           mwl.attribution AS writeback_attribution,
           mwl.error AS writeback_error
    FROM memory_source_index msi
    LEFT JOIN memory_writeback_log mwl
      ON mwl.id = (
        SELECT latest.id
        FROM memory_writeback_log latest
        WHERE latest.company_id = msi.company_id
          AND (
            (latest.record_id IS NOT NULL AND latest.record_id = msi.record_id)
            OR latest.source_path = msi.source_path
          )
        ORDER BY latest.written_at DESC
        LIMIT 1
      )
    WHERE ${where.join(" AND ")}
    ORDER BY pinned DESC, indexed_at DESC, title ASC
    LIMIT ?
  `).all(...params, filters.limit ?? 200) as IndexedRow[];

  return { company, records: rows.map(rowToIndexRecord) };
}

function extractRoleTags(tags: string[]): string[] {
  return tags
    .filter((tag) => tag.toLowerCase().startsWith("role:"))
    .map((tag) => tag.slice(5).trim().toLowerCase())
    .filter(Boolean);
}

function roleMatches(agentRole: string | null | undefined, roleTags: string[]): boolean {
  if (roleTags.length === 0) return true;
  if (!agentRole) return false;
  const role = agentRole.toLowerCase();
  return roleTags.some((tag) => role.includes(tag) || tag.includes(role));
}

function parseTagsValue(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string") return parseJsonArray(raw).length > 0 ? parseJsonArray(raw) : raw.split(/[,\s]+/).map((tag) => tag.trim()).filter(Boolean);
  return [];
}

function runMetadataHash(raw: string | null): string | null {
  const metadata = parseJsonObject(raw);
  return typeof metadata.injected_memory_sha256 === "string" && metadata.injected_memory_sha256.trim()
    ? metadata.injected_memory_sha256
    : null;
}

function runMetadataEvidence(raw: string | null): StoredMemoryEvidence | null {
  const metadata = parseJsonObject(raw);
  const evidence = metadata.injectedMemoryEvidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  return evidence as StoredMemoryEvidence;
}

function runMetadataQuality(raw: string | null): MemoryRetrievalQuality | undefined {
  const metadata = parseJsonObject(raw);
  const quality = metadata.injectedMemoryQuality;
  if (!quality || typeof quality !== "object" || Array.isArray(quality)) return undefined;
  return quality as MemoryRetrievalQuality;
}

function runMetadataUtilization(raw: string | null): MemoryInjectionEvidenceResult["utilization"] | undefined {
  const metadata = parseJsonObject(raw);
  const receipts = normalizeMemoryUtilizationReceiptsMetadata(metadata.memoryUtilizationReceipts);
  const matchedUse = normalizeMemoryUtilizationMatchedUseMetadata(metadata.memoryUtilizationMatchedUse);
  if (!receipts && !matchedUse) return undefined;
  return {
    ...(receipts ? { receipts } : {}),
    ...(matchedUse ? { matchedUse } : {}),
  };
}

function evidenceSourceFromStored(source: unknown): MemoryInjectionEvidenceResult["injectionSource"] {
  if (source === "memory_source_index") return "vault_index";
  if (source === "company_memory_records") return "memory_registry_fallback";
  return "none";
}

function storedEvidenceReasons(record: StoredMemoryEvidenceRecord): string[] {
  const reasons = Array.isArray(record.inclusionReasons)
    ? record.inclusionReasons.map(String).map((reason) => reason.trim()).filter(Boolean)
    : [];
  return reasons.length > 0 ? reasons : ["recorded in execution run memory injection metadata"];
}

function storedEvidenceReason(record: StoredMemoryEvidenceRecord): string {
  return storedEvidenceReasons(record).join("; ");
}

function hydrateStoredIndexedEvidence(
  db: Database.Database,
  companyId: string,
  recordId: string,
): EvidenceIndexedRow | undefined {
  return db.prepare(`
    SELECT record_id, title, content_excerpt, layer, source_id, source_path, tags_json,
           frontmatter_json, file_type, file_mtime, indexed_at, status
    FROM memory_source_index
    WHERE company_id = ?
      AND record_id = ?
    LIMIT 1
  `).get(companyId, recordId) as EvidenceIndexedRow | undefined;
}

function hydrateStoredMemoryRecord(
  db: Database.Database,
  companyId: string,
  recordId: string,
): EvidenceMemoryRecordRow | undefined {
  return db.prepare(`
    SELECT id, title, body, kind, scope, source, confidence, project_id, agent_id,
           task_id, execution_run_id, metadata_json, updated_at
    FROM company_memory_records
    WHERE company_id = ?
      AND id = ?
    LIMIT 1
  `).get(companyId, recordId) as EvidenceMemoryRecordRow | undefined;
}

function storedEvidenceForRun(input: {
  db: Database.Database;
  run: MemoryInjectionRunRow;
  limit: number;
}): MemoryInjectionEvidenceItem[] {
  const stored = runMetadataEvidence(input.run.execution_run_metadata_json);
  const records = Array.isArray(stored?.records)
    ? stored.records.slice(0, input.limit) as StoredMemoryEvidenceRecord[]
    : [];
  const result: MemoryInjectionEvidenceItem[] = [];

  for (const record of records) {
    const recordId = typeof record.recordId === "string" ? record.recordId.trim() : "";
    if (!recordId) continue;

    const indexed = hydrateStoredIndexedEvidence(input.db, input.run.company_id, recordId);
    if (indexed) {
      result.push({
        recordId,
        title: typeof record.title === "string" && record.title.trim() ? record.title : indexed.title,
        sourcePath: typeof record.sourcePath === "string" ? record.sourcePath : indexed.source_path,
        layer: typeof record.layer === "string" && record.layer.trim() ? record.layer : indexed.layer,
        reason: storedEvidenceReason(record),
        source: {
          type: "memory_source_index",
          sourceId: indexed.source_id,
          status: indexed.status,
          fileType: indexed.file_type,
          fileMtime: indexed.file_mtime,
          indexedAt: indexed.indexed_at,
          frontmatter: parseJsonObject(indexed.frontmatter_json),
          tags: parseJsonArray(indexed.tags_json),
        },
      });
      continue;
    }

    const memory = hydrateStoredMemoryRecord(input.db, input.run.company_id, recordId);
    if (memory) {
      const metadata = parseJsonObject(memory.metadata_json);
      result.push({
        recordId,
        title: typeof record.title === "string" && record.title.trim() ? record.title : memory.title,
        sourcePath: typeof record.sourcePath === "string"
          ? record.sourcePath
          : typeof metadata.sourcePath === "string" ? metadata.sourcePath : null,
        layer: typeof record.layer === "string" && record.layer.trim() ? record.layer : memory.scope,
        reason: storedEvidenceReason(record),
        source: {
          type: "company_memory_record",
          kind: memory.kind,
          scope: memory.scope,
          confidence: Number(memory.confidence),
          updatedAt: memory.updated_at,
          metadata,
        },
      });
      continue;
    }

    result.push({
      recordId,
      title: typeof record.title === "string" && record.title.trim() ? record.title : recordId,
      sourcePath: typeof record.sourcePath === "string" ? record.sourcePath : null,
      layer: typeof record.layer === "string" && record.layer.trim() ? record.layer : "unknown",
      reason: storedEvidenceReason(record),
      source: {
        type: evidenceSourceFromStored(stored?.source) === "memory_registry_fallback"
          ? "company_memory_record"
          : "memory_source_index",
        status: "archived",
      },
    });
  }

  return result;
}

function indexedEvidenceReason(input: {
  row: EvidenceIndexedRow;
  frontmatter: Record<string, unknown>;
  tags: string[];
  run: MemoryInjectionRunRow;
}): string | null {
  const roleTags = extractRoleTags(input.tags);
  if (roleTags.length > 0 && !roleMatches(input.run.agent_role, roleTags)) return null;

  if (
    input.row.layer === "project" &&
    typeof input.frontmatter.project_id === "string" &&
    input.frontmatter.project_id !== input.run.project_id
  ) {
    return null;
  }
  if (
    input.row.layer === "agent" &&
    typeof input.frontmatter.agent_id === "string" &&
    input.frontmatter.agent_id !== input.run.agent_id
  ) {
    return null;
  }

  const reasons: string[] = [];
  if (input.row.layer === "project") {
    reasons.push(typeof input.frontmatter.project_id === "string"
      ? "project_id matched the run task project"
      : "project-layer memory without a narrower project_id applies to this run");
  } else if (input.row.layer === "agent") {
    reasons.push(typeof input.frontmatter.agent_id === "string"
      ? "agent_id matched the run agent"
      : "agent-layer memory without a narrower agent_id applies to this run");
  } else {
    reasons.push(`${input.row.layer} layer applies company-wide`);
  }
  if (roleTags.length > 0) {
    reasons.push(`role tag matched agent role "${input.run.agent_role ?? ""}"`);
  }
  return reasons.join("; ");
}

function defaultMemoryRetrievalQuality(): MemoryRetrievalQuality {
  return {
    status: "accepted",
    score: 100,
    warnings: [],
    refusals: [],
  };
}

function buildMemoryEvidenceDiagnostics(input: {
  db: Database.Database;
  companyId: string;
  agentId: string;
  agentRole: string | null;
  projectId: string | null;
  limit: number;
}): MemoryInjectionDiagnostics {
  const context = buildMemoryContext({
    db: input.db,
    companyId: input.companyId,
    agentId: input.agentId,
    agentRole: input.agentRole,
    projectId: input.projectId,
    limit: input.limit,
  });
  if (!context) {
    return {
      version: 1,
      source: "none",
      quality: defaultMemoryRetrievalQuality(),
      evidence: [],
    };
  }

  return {
    version: 1,
    source: context.source,
    quality: context.quality,
    evidence: context.evidence,
  };
}

function diagnosticsSourceFromStored(source: unknown): MemoryInjectionDiagnostics["source"] {
  if (source === "memory_source_index") return "memory_source_index";
  if (source === "company_memory_records") return "company_memory_records";
  return "none";
}

function buildStoredMemoryEvidenceDiagnostics(input: {
  db: Database.Database;
  run: MemoryInjectionRunRow;
  limit: number;
  quality?: MemoryRetrievalQuality;
  fallback?: MemoryInjectionDiagnostics;
}): MemoryInjectionDiagnostics | undefined {
  const stored = runMetadataEvidence(input.run.execution_run_metadata_json);
  const records = Array.isArray(stored?.records)
    ? stored.records.slice(0, input.limit) as StoredMemoryEvidenceRecord[]
    : [];
  if (records.length === 0) return undefined;

  const evidence: MemoryContextEvidenceItem[] = [];
  for (const record of records) {
    const recordId = typeof record.recordId === "string" ? record.recordId.trim() : "";
    if (!recordId) continue;

    const inclusionReasons = storedEvidenceReasons(record);
    const indexed = hydrateStoredIndexedEvidence(input.db, input.run.company_id, recordId);
    if (indexed) {
      const title = typeof record.title === "string" && record.title.trim() ? record.title : indexed.title;
      const sourcePath = typeof record.sourcePath === "string" ? record.sourcePath : indexed.source_path;
      const layer = typeof record.layer === "string" && record.layer.trim() ? record.layer : indexed.layer;
      const tags = parseJsonArray(indexed.tags_json);
      evidence.push({
        recordId,
        sourcePath,
        title,
        layer,
        inclusionReasons,
        evidenceEnvelope: buildEvidenceEnvelope({
          sourceType: "memory_source_index",
          companyId: input.run.company_id,
          recordId,
          title,
          layer,
          sourcePath,
          content: indexed.content_excerpt,
          retrievalRank: evidence.length + 1,
          agentId: input.run.agent_id,
          agentRole: input.run.agent_role,
          projectId: input.run.project_id,
          tags,
          inclusionReasons,
        }),
      });
      continue;
    }

    const memory = hydrateStoredMemoryRecord(input.db, input.run.company_id, recordId);
    if (memory) {
      const metadata = parseJsonObject(memory.metadata_json);
      const tags = parseTagsValue(metadata.tags);
      const title = typeof record.title === "string" && record.title.trim() ? record.title : memory.title;
      const sourcePath = typeof record.sourcePath === "string"
        ? record.sourcePath
        : typeof metadata.sourcePath === "string" ? metadata.sourcePath : null;
      const layer = typeof record.layer === "string" && record.layer.trim() ? record.layer : memory.scope;
      evidence.push({
        recordId,
        sourcePath,
        title,
        layer,
        inclusionReasons,
        evidenceEnvelope: buildEvidenceEnvelope({
          sourceType: "company_memory_records",
          companyId: input.run.company_id,
          recordId,
          title,
          layer,
          sourcePath,
          content: memory.body,
          retrievalRank: evidence.length + 1,
          agentId: input.run.agent_id,
          agentRole: input.run.agent_role,
          projectId: input.run.project_id,
          tags,
          inclusionReasons,
        }),
      });
    }
  }

  return {
    version: 1,
    source: diagnosticsSourceFromStored(stored?.source),
    quality: input.quality ?? input.fallback?.quality ?? defaultMemoryRetrievalQuality(),
    evidence,
  };
}

function fallbackMemoryEvidenceReason(input: {
  row: EvidenceMemoryRecordRow;
  metadata: Record<string, unknown>;
  run: MemoryInjectionRunRow;
}): string | null {
  let scopeReason: string | null = null;
  if (input.row.scope === "company") {
    scopeReason = "company scope applies to all company runs";
  } else if (input.row.scope === "project" && input.row.project_id === input.run.project_id) {
    scopeReason = "project scope matched the run task project";
  } else if (input.row.scope === "agent" && input.row.agent_id === input.run.agent_id) {
    scopeReason = "agent scope matched the run agent";
  }
  if (!scopeReason) return null;

  const tags = parseTagsValue(input.metadata.tags);
  const roleTags = extractRoleTags(tags);
  if (roleTags.length > 0 && !roleMatches(input.run.agent_role, roleTags)) return null;
  return roleTags.length > 0
    ? `${scopeReason}; role tag matched agent role "${input.run.agent_role ?? ""}"`
    : scopeReason;
}

export function getMemoryInjectionEvidenceForRun(
  companyIdOrSlug: string,
  executionRunId: string,
  options: { limit?: number; db?: Database.Database; includeDiagnostics?: boolean } = {},
): MemoryInjectionEvidenceResult {
  const db = options.db ?? getOrchestrationDb();
  const company = resolveCompany(companyIdOrSlug, db);
  const runId = executionRunId.trim();
  if (!runId) {
    throw new OrchestrationApiError(400, "missing_execution_run_id", "executionRunId is required");
  }

  const run = db.prepare(`
    SELECT
      er.id AS execution_run_id,
      er.status AS execution_run_status,
      er.metadata_json AS execution_run_metadata_json,
      t.id AS task_id,
      t.task_key,
      t.title AS task_title,
      p.id AS project_id,
      p.name AS project_name,
      a.id AS agent_id,
      a.name AS agent_name,
      a.role AS agent_role,
      c.id AS company_id,
      c.slug AS company_slug,
      c.name AS company_name
    FROM execution_runs er
    JOIN tasks t ON t.id = er.task_id
    JOIN projects p ON p.id = t.project_id
    JOIN companies c ON c.id = p.company_id
    JOIN agents a ON a.id = COALESCE(er.agent_id, t.assignee_agent_id)
    WHERE er.id = ?
      AND c.id = ?
    LIMIT 1
  `).get(runId, company.id) as MemoryInjectionRunRow | undefined;

  if (!run) {
    throw new OrchestrationApiError(404, "execution_run_not_found", "Execution run not found for this company");
  }
  if (!["pending", "running", "completed"].includes(run.execution_run_status)) {
    throw new OrchestrationApiError(400, "unsupported_run_status", "Memory injection evidence is exposed for active or completed runs");
  }

  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 20), 100));
  const quality = runMetadataQuality(run.execution_run_metadata_json);
  const utilization = runMetadataUtilization(run.execution_run_metadata_json);
  const stored = runMetadataEvidence(run.execution_run_metadata_json);
  const storedEvidence = storedEvidenceForRun({ db, run, limit });
  const recomputedDiagnostics = options.includeDiagnostics
    ? buildMemoryEvidenceDiagnostics({
        db,
        companyId: run.company_id,
        agentId: run.agent_id,
        agentRole: run.agent_role,
        projectId: run.project_id,
        limit,
      })
    : undefined;
  const diagnostics = options.includeDiagnostics
    ? buildStoredMemoryEvidenceDiagnostics({
        db,
        run,
        limit,
        quality,
        fallback: recomputedDiagnostics,
      }) ?? recomputedDiagnostics
    : undefined;
  if (stored && storedEvidence.length === 0 && quality?.status === "refused") {
    return {
      company: { id: run.company_id, slug: run.company_slug, name: run.company_name },
      run: {
        id: run.execution_run_id,
        status: run.execution_run_status,
        taskId: run.task_id,
        taskKey: run.task_key,
        taskTitle: run.task_title,
        projectId: run.project_id,
        projectName: run.project_name,
        agentId: run.agent_id,
        agentName: run.agent_name,
        agentRole: run.agent_role,
        injectedMemorySha256: runMetadataHash(run.execution_run_metadata_json),
      },
      injectionSource: evidenceSourceFromStored(stored.source),
      evidence: [],
      quality,
      utilization,
      diagnostics,
    };
  }
  if (storedEvidence.length > 0) {
    return {
      company: { id: run.company_id, slug: run.company_slug, name: run.company_name },
      run: {
        id: run.execution_run_id,
        status: run.execution_run_status,
        taskId: run.task_id,
        taskKey: run.task_key,
        taskTitle: run.task_title,
        projectId: run.project_id,
        projectName: run.project_name,
        agentId: run.agent_id,
        agentName: run.agent_name,
        agentRole: run.agent_role,
        injectedMemorySha256: runMetadataHash(run.execution_run_metadata_json),
      },
      injectionSource: evidenceSourceFromStored(stored?.source),
      evidence: storedEvidence,
      quality,
      utilization,
      diagnostics,
    };
  }

  const indexedRows = db.prepare(`
    SELECT record_id, title, content_excerpt, layer, source_id, source_path, tags_json,
           frontmatter_json, file_type, file_mtime, indexed_at, status
    FROM memory_source_index
    WHERE company_id = ?
      AND status = 'active'
    ORDER BY pinned DESC, indexed_at DESC
    LIMIT ?
  `).all(company.id, limit * 2) as EvidenceIndexedRow[];

  const indexedEvidence: MemoryInjectionEvidenceItem[] = [];
  for (const row of indexedRows) {
    const tags = parseJsonArray(row.tags_json);
    const frontmatter = parseJsonObject(row.frontmatter_json);
    const reason = indexedEvidenceReason({ row, frontmatter, tags, run });
    if (!reason) continue;
    indexedEvidence.push({
      recordId: row.record_id,
      title: row.title,
      sourcePath: row.source_path,
      layer: row.layer,
      reason,
      source: {
        type: "memory_source_index",
        sourceId: row.source_id,
        status: row.status,
        fileType: row.file_type,
        fileMtime: row.file_mtime,
        indexedAt: row.indexed_at,
        frontmatter,
        tags,
      },
    });
    if (indexedEvidence.length >= limit) break;
  }

  if (indexedEvidence.length > 0) {
    return {
      company: { id: run.company_id, slug: run.company_slug, name: run.company_name },
      run: {
        id: run.execution_run_id,
        status: run.execution_run_status,
        taskId: run.task_id,
        taskKey: run.task_key,
        taskTitle: run.task_title,
        projectId: run.project_id,
        projectName: run.project_name,
        agentId: run.agent_id,
        agentName: run.agent_name,
        agentRole: run.agent_role,
        injectedMemorySha256: runMetadataHash(run.execution_run_metadata_json),
      },
      injectionSource: "vault_index",
      evidence: indexedEvidence,
      utilization,
      diagnostics,
    };
  }

  const memoryRows = db.prepare(`
    SELECT id, title, body, kind, scope, source, confidence, project_id, agent_id,
           task_id, execution_run_id, metadata_json, updated_at
    FROM company_memory_records
    WHERE company_id = ?
      AND status = 'active'
      AND archived_at IS NULL
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(company.id, limit * 4) as EvidenceMemoryRecordRow[];

  const fallbackEvidence: MemoryInjectionEvidenceItem[] = [];
  for (const row of memoryRows) {
    const metadata = parseJsonObject(row.metadata_json);
    const reason = fallbackMemoryEvidenceReason({ row, metadata, run });
    if (!reason) continue;
    fallbackEvidence.push({
      recordId: row.id,
      title: row.title,
      sourcePath: typeof metadata.sourcePath === "string" ? metadata.sourcePath : null,
      layer: row.scope,
      reason,
      source: {
        type: "company_memory_record",
        kind: row.kind,
        scope: row.scope,
        confidence: Number(row.confidence),
        updatedAt: row.updated_at,
        metadata,
      },
    });
    if (fallbackEvidence.length >= limit) break;
  }

  return {
    company: { id: run.company_id, slug: run.company_slug, name: run.company_name },
    run: {
      id: run.execution_run_id,
      status: run.execution_run_status,
      taskId: run.task_id,
      taskKey: run.task_key,
      taskTitle: run.task_title,
      projectId: run.project_id,
      projectName: run.project_name,
      agentId: run.agent_id,
      agentName: run.agent_name,
      agentRole: run.agent_role,
      injectedMemorySha256: runMetadataHash(run.execution_run_metadata_json),
    },
    injectionSource: fallbackEvidence.length > 0 ? "memory_registry_fallback" : "none",
    evidence: fallbackEvidence,
    utilization,
    diagnostics,
  };
}

export function getMemoryGraph(
  companyIdOrSlug: string,
  options: { limit?: number; db?: Database.Database } = {},
): MemoryGraph {
  const { records } = listMemoryIndexRecords(companyIdOrSlug, { limit: options.limit ?? 300, db: options.db });
  const nodes: MemoryGraphNode[] = records.map((record) => ({
    id: record.recordId,
    label: record.title,
    layer: record.layer,
    sourcePath: record.sourcePath,
    degree: 0,
  }));
  const edges: MemoryGraphEdge[] = [];
  const byTitleRecords = new Map<string, MemoryIndexRecord[]>();
  for (const record of records) {
    const titleKey = slugifyMemoryPathPart(record.title);
    const titleRecords = byTitleRecords.get(titleKey) ?? [];
    titleRecords.push(record);
    byTitleRecords.set(titleKey, titleRecords);
  }
  const byTitle = new Map([...byTitleRecords.entries()].map(([titleKey, titleRecords]) => [titleKey, titleRecords[0]]));
  const byRecordId = new Map(records.map((record) => [record.recordId, record]));
  const pseudoNodes = new Set<string>();
  const staleEvidenceLinks: MemoryGraphQualitySignal[] = [];
  for (const record of records) {
    for (const linked of record.linkedIds) {
      const titleTarget = byTitle.get(slugifyMemoryPathPart(linked));
      if (titleTarget) {
        edges.push({ source: record.recordId, target: titleTarget.recordId, label: "links" });
        continue;
      }
      const idTarget = byRecordId.get(linked);
      if (idTarget) {
        edges.push({ source: record.recordId, target: idTarget.recordId, label: "links" });
        continue;
      }
      if (/^[A-Z]{2,10}-\d+$/.test(linked)) {
        const id = `task:${linked}`;
        if (!pseudoNodes.has(id)) {
          nodes.push({ id, label: linked, layer: "task", taskKey: linked, degree: 0 });
          pseudoNodes.add(id);
        }
        edges.push({ source: record.recordId, target: id, label: "mentions" });
        continue;
      }
      staleEvidenceLinks.push({
        id: `stale:${record.recordId}:${slugifyMemoryPathPart(linked, "link")}`,
        type: "stale_evidence_link",
        severity: "medium",
        title: `Unresolved link from ${record.title}`,
        source: record.recordId,
        missingLink: linked,
        recordIds: [record.recordId],
        detail: `Linked evidence "${linked}" does not resolve to an indexed note or task key.`,
      });
    }
  }

  const degreeById = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    degreeById.set(edge.source, (degreeById.get(edge.source) ?? 0) + 1);
    degreeById.set(edge.target, (degreeById.get(edge.target) ?? 0) + 1);
  }
  for (const node of nodes) {
    node.degree = degreeById.get(node.id) ?? 0;
  }

  const orphanNotes = records
    .filter((record) => (degreeById.get(record.recordId) ?? 0) === 0)
    .map((record): MemoryGraphQualitySignal => ({
      id: `orphan:${record.recordId}`,
      type: "orphan_note",
      severity: "high",
      title: record.title,
      recordIds: [record.recordId],
      detail: "Indexed note has no inbound or outbound graph links.",
    }));

  const titleClusters = new Map<string, MemoryIndexRecord[]>();
  for (const record of records) {
    const key = slugifyMemoryPathPart(record.title, "untitled");
    const cluster = titleClusters.get(key) ?? [];
    cluster.push(record);
    titleClusters.set(key, cluster);
  }
  const duplicateClusters = [...titleClusters.entries()]
    .filter(([, cluster]) => cluster.length > 1)
    .map(([key, cluster]): MemoryGraphQualitySignal => ({
      id: `duplicate:${key}`,
      type: "duplicate_cluster",
      severity: "high",
      title: cluster[0]?.title ?? key,
      recordIds: cluster.map((record) => record.recordId),
      detail: `${cluster.length} indexed notes normalize to the same title.`,
    }));

  const missingBacklinks: MemoryGraphQualitySignal[] = [];
  for (const edge of edges) {
    if (edge.label !== "links") continue;
    const source = byRecordId.get(edge.source);
    const target = byRecordId.get(edge.target);
    if (!source || !target) continue;
    const targetLinks = new Set(target.linkedIds.map((linked) => slugifyMemoryPathPart(linked)));
    const hasBacklink =
      targetLinks.has(slugifyMemoryPathPart(source.title)) ||
      target.linkedIds.includes(source.recordId);
    if (!hasBacklink) {
      missingBacklinks.push({
        id: `backlink:${source.recordId}:${target.recordId}`,
        type: "missing_backlink",
        severity: "low",
        title: `${target.title} missing backlink`,
        source: source.recordId,
        target: target.recordId,
        recordIds: [source.recordId, target.recordId],
        detail: `${source.title} links to ${target.title}, but the target does not link back.`,
      });
    }
  }

  const isMapRecord = (record: MemoryIndexRecord): boolean => {
    const sourcePath = record.sourcePath.toLowerCase();
    const subdirectory = record.subdirectory?.toLowerCase() ?? "";
    return (
      record.layer.toLowerCase() === "map" ||
      subdirectory.includes("map") ||
      sourcePath.includes("/map/") ||
      sourcePath.includes("/maps/") ||
      record.tags.some((tag) => tag.toLowerCase().includes("map"))
    );
  };
  const mapCoveredRecordIds = new Set<string>();
  for (const record of records) {
    if (!isMapRecord(record)) continue;
    mapCoveredRecordIds.add(record.recordId);
    for (const linked of record.linkedIds) {
      const titleTargets = byTitleRecords.get(slugifyMemoryPathPart(linked)) ?? [];
      for (const target of titleTargets) {
        mapCoveredRecordIds.add(target.recordId);
      }
      const idTarget = byRecordId.get(linked);
      if (idTarget) {
        mapCoveredRecordIds.add(idTarget.recordId);
      }
    }
  }
  const mapCovered = records.filter((record) => {
    return mapCoveredRecordIds.has(record.recordId);
  });
  const uncoveredRecords = records.filter((record) => !mapCovered.includes(record));
  const coveragePercent = records.length === 0 ? 100 : Math.round((mapCovered.length / records.length) * 100);
  const issueCount =
    orphanNotes.length +
    duplicateClusters.length +
    missingBacklinks.length +
    staleEvidenceLinks.length +
    (coveragePercent < 50 ? 1 : 0);
  const score = Math.max(0, Math.min(100, 100 - orphanNotes.length * 8 - duplicateClusters.length * 12 - staleEvidenceLinks.length * 6 - missingBacklinks.length * 2 - Math.max(0, 80 - coveragePercent)));

  return {
    nodes,
    edges,
    readiness: {
      status: score < 50 || staleEvidenceLinks.length > 4 ? "blocked" : issueCount > 0 ? "needs_attention" : "ready",
      score,
      summary: issueCount === 0
        ? "Graph is linked, deduplicated, and map-covered."
        : `${issueCount} graph quality signal${issueCount === 1 ? "" : "s"} need operator review.`,
    },
    qualitySignals: {
      orphanNotes,
      duplicateClusters,
      missingBacklinks,
      staleEvidenceLinks,
    },
    mapCoverage: {
      totalRecords: records.length,
      coveredRecords: mapCovered.length,
      uncoveredRecords: uncoveredRecords.length,
      coveragePercent,
      uncoveredSample: uncoveredRecords.slice(0, 8).map((record) => ({
        recordId: record.recordId,
        title: record.title,
        layer: record.layer,
        sourcePath: record.sourcePath,
      })),
    },
  };
}

function graphNoteId(kind: GraphNoteKind, sourceId: string): string {
  return `graph:${kind}:${sourceId}`;
}

function graphNoteRelativePath(note: Pick<GraphNoteDraft, "id" | "kind" | "title">): string {
  const suffix = createHash("sha256").update(note.id).digest("hex").slice(0, 10);
  const folderByKind: Record<GraphNoteKind, string> = {
    company: "companies",
    project: "projects",
    task: "tasks",
    memory: "memories",
    curation: "curation",
    evidence: "evidence",
  };
  return path.join("graph", folderByKind[note.kind], `${slugifyMemoryPathPart(note.title, note.kind)}-${suffix}.md`);
}

function graphWikilink(note: Pick<GraphNoteMetadata, "relativePath" | "title">): string {
  const target = note.relativePath.replace(/\\/g, "/").replace(/\.(md|markdown)$/i, "");
  const label = note.title.replace(/[\[\]\n\r]/g, " ").replace(/\s+/g, " ").trim();
  return `[[${target}|${label}]]`;
}

function graphTags(kind: GraphNoteKind, extra: Array<string | null | undefined> = []): string[] {
  return uniqueSorted([
    "hiverunner/graph",
    `hiverunner/graph/${kind}`,
    ...extra.map((tag) => tag ? slugifyMemoryPathPart(tag, "tag").replace(/-/g, "/") : ""),
  ]);
}

function graphAliases(...values: Array<string | null | undefined>): string[] {
  return uniqueSorted(values);
}

function graphSnippet(value: string | null | undefined, max = 320): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function graphSection(title: string, lines: Array<string | null | undefined>): string {
  const clean = lines.map((line) => line?.trim()).filter(Boolean) as string[];
  return clean.length > 0 ? `## ${title}\n\n${clean.join("\n")}` : "";
}

function graphTargetForTaskKey(taskKey: string | null | undefined): string | null {
  return taskKey?.trim() ? graphNoteId("task", taskKey.trim()) : null;
}

function graphTargetForMemoryIndex(recordId: string | null | undefined): string | null {
  return recordId?.trim() ? graphNoteId("evidence", recordId.trim()) : null;
}

function graphTargetForMemoryRecord(recordId: string | null | undefined): string | null {
  return recordId?.trim() ? graphNoteId("memory", recordId.trim()) : null;
}

function addGraphDraft(drafts: Map<string, GraphNoteDraft>, draft: GraphNoteDraft): void {
  if (drafts.has(draft.id)) return;
  drafts.set(draft.id, {
    ...draft,
    aliases: uniqueSorted(draft.aliases),
    tags: uniqueSorted(draft.tags),
    linkTargetIds: uniqueSorted(draft.linkTargetIds),
    sections: draft.sections.filter(Boolean),
  });
}

function renderGraphNote(input: {
  draft: GraphNoteDraft;
  relativePath: string;
  links: GraphNoteLink[];
}): GraphNoteMetadata {
  const links = input.links
    .filter((link, index, all) => all.findIndex((other) => other.targetId === link.targetId) === index)
    .sort((a, b) => a.targetTitle.localeCompare(b.targetTitle, "en", { sensitivity: "base" }) || a.targetId.localeCompare(b.targetId));
  const frontmatter = {
    ...input.draft.frontmatter,
    id: input.draft.id,
    title: input.draft.title,
    type: "graph_note",
    graph_kind: input.draft.kind,
    aliases: uniqueSorted(input.draft.aliases),
    tags: uniqueSorted(input.draft.tags),
    links: links.map((link) => link.targetId),
    status: "active",
  };
  const linkLines = links.length > 0
    ? links.map((link) => `- ${link.wikilink} (${link.label})`)
    : ["- No graph links derived yet."];
  const body = [
    `# ${input.draft.title}`,
    "",
    graphSection("Graph Links", linkLines),
    "",
    ...input.draft.sections,
  ].filter(Boolean).join("\n\n").trim();
  const markdown = serializeMemoryMarkdown({ frontmatter, body });
  return {
    id: input.draft.id,
    kind: input.draft.kind,
    title: input.draft.title,
    aliases: uniqueSorted(input.draft.aliases),
    tags: uniqueSorted(input.draft.tags),
    links,
    frontmatter,
    body,
    markdown,
    relativePath: input.relativePath.replace(/\\/g, "/"),
  };
}

function assertGraphNoteWritePath(vaultRoot: string, relativePath: string): string {
  const root = path.resolve(vaultRoot);
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new OrchestrationApiError(403, "graph_note_path_outside_vault", "Graph note write refused: target path is outside the company vault.");
  }
  const [zone] = relative.split(path.sep);
  if (zone !== "graph") {
    throw new OrchestrationApiError(403, "graph_note_zone_not_allowed", "Graph note write refused: metadata notes must stay in the graph zone.");
  }
  if (!/\.md$/i.test(absolute)) {
    throw new OrchestrationApiError(400, "invalid_graph_note_extension", "Graph note write refused: target path must be Markdown.");
  }
  return absolute;
}

export function generateGraphNoteMetadata(
  companyIdOrSlug: string,
  options: { limit?: number; db?: Database.Database } = {},
): GraphNoteMetadataResult {
  const db = options.db ?? getOrchestrationDb();
  const { company, settings } = getCompanyMemorySettings(companyIdOrSlug, { persistDefaults: true, db });
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 500), 2000));
  const drafts = new Map<string, GraphNoteDraft>();
  const companyId = graphNoteId("company", company.id);

  addGraphDraft(drafts, {
    id: companyId,
    kind: "company",
    title: company.name,
    aliases: graphAliases(company.slug, company.company_code),
    tags: graphTags("company", [company.slug]),
    frontmatter: {
      source_type: "company",
      source_id: company.id,
      company: company.slug,
    },
    linkTargetIds: [],
    sections: [
      graphSection("Source", [
        `Company slug: \`${company.slug}\``,
        company.company_code ? `Company code: \`${company.company_code}\`` : "",
      ]),
    ],
  });

  const projects = db.prepare(`
    SELECT id, slug, name, description, status, created_at, updated_at
    FROM projects
    WHERE company_id = ?
      AND archived_at IS NULL
    ORDER BY lower(name), id
    LIMIT ?
  `).all(company.id, limit) as GraphProjectRow[];
  for (const project of projects) {
    addGraphDraft(drafts, {
      id: graphNoteId("project", project.id),
      kind: "project",
      title: project.name,
      aliases: graphAliases(project.slug, project.id),
      tags: graphTags("project", [project.status]),
      frontmatter: {
        source_type: "project",
        source_id: project.id,
        company: company.slug,
        project_slug: project.slug ?? "",
        source_status: project.status,
        updated: project.updated_at,
      },
      linkTargetIds: [companyId],
      sections: [
        graphSection("Source", [
          `Project status: \`${project.status}\``,
          graphSnippet(project.description),
        ]),
      ],
    });
  }

  const tasks = db.prepare(`
    SELECT t.id, t.task_key, t.title, t.description, t.priority, t.type, t.status,
           t.project_id, p.name AS project_name, t.assignee_agent_id, a.name AS assignee_name,
           t.labels_json, t.created_at, t.updated_at
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN agents a ON a.id = t.assignee_agent_id
    WHERE p.company_id = ?
      AND t.archived_at IS NULL
    ORDER BY COALESCE(t.task_key, t.id), lower(t.title), t.id
    LIMIT ?
  `).all(company.id, limit) as GraphTaskRow[];
  const taskTargetById = new Map<string, string>();
  for (const task of tasks) {
    const taskSourceId = task.task_key?.trim() || task.id;
    const taskId = graphNoteId("task", taskSourceId);
    taskTargetById.set(task.id, taskId);
    addGraphDraft(drafts, {
      id: taskId,
      kind: "task",
      title: task.task_key ? `${task.task_key} - ${task.title}` : task.title,
      aliases: graphAliases(task.task_key, task.id, task.title),
      tags: graphTags("task", [task.status, task.priority, task.type, ...parseJsonArray(task.labels_json)]),
      frontmatter: {
        source_type: "task",
        source_id: task.id,
        task_key: task.task_key ?? "",
        company: company.slug,
        project_id: task.project_id,
        source_status: task.status,
        priority: task.priority,
        task_type: task.type,
        updated: task.updated_at,
      },
      linkTargetIds: [companyId, graphNoteId("project", task.project_id)].filter(Boolean),
      sections: [
        graphSection("Source", [
          `Project: ${task.project_name}`,
          task.assignee_name ? `Assignee: ${task.assignee_name}` : "",
          graphSnippet(task.description),
        ]),
      ],
    });
  }

  const memoryRows = db.prepare(`
    SELECT id, title, body, kind, scope, status, source, confidence, project_id, agent_id,
           task_id, execution_run_id, metadata_json, created_at, updated_at
    FROM company_memory_records
    WHERE company_id = ?
      AND status = 'active'
      AND archived_at IS NULL
    ORDER BY lower(title), id
    LIMIT ?
  `).all(company.id, limit) as GraphMemoryRecordRow[];
  for (const memory of memoryRows) {
    const metadata = parseJsonObject(memory.metadata_json);
    const sourceRecordId = typeof metadata.vaultRecordId === "string" ? metadata.vaultRecordId : null;
    addGraphDraft(drafts, {
      id: graphNoteId("memory", memory.id),
      kind: "memory",
      title: memory.title,
      aliases: graphAliases(memory.id, typeof metadata.slug === "string" ? metadata.slug : null),
      tags: graphTags("memory", [memory.kind, memory.scope, memory.source, ...parseTagsValue(metadata.tags)]),
      frontmatter: {
        source_type: "company_memory_record",
        source_id: memory.id,
        company: company.slug,
        memory_kind: memory.kind,
        memory_scope: memory.scope,
        confidence: String(memory.confidence),
        updated: memory.updated_at,
      },
      linkTargetIds: uniqueSorted([
        companyId,
        memory.project_id ? graphNoteId("project", memory.project_id) : null,
        memory.task_id ? taskTargetById.get(memory.task_id) : null,
        graphTargetForMemoryIndex(sourceRecordId),
      ]),
      sections: [
        graphSection("Source", [
          `Memory kind: \`${memory.kind}\``,
          `Scope: \`${memory.scope}\``,
          graphSnippet(memory.body),
        ]),
      ],
    });
  }

  const indexedRecords = listMemoryIndexRecords(company.id, { status: "active", limit, db }).records
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }) || a.recordId.localeCompare(b.recordId));
  for (const record of indexedRecords) {
    addGraphDraft(drafts, {
      id: graphNoteId("evidence", record.recordId),
      kind: "evidence",
      title: record.title,
      aliases: graphAliases(record.recordId, path.basename(record.sourcePath, path.extname(record.sourcePath))),
      tags: graphTags("evidence", [record.layer, record.sourceId, ...record.tags]),
      frontmatter: {
        source_type: "memory_source_index",
        source_id: record.recordId,
        company: company.slug,
        source_path: record.sourcePath,
        source_layer: record.layer,
        indexed_at: record.indexedAt,
      },
      linkTargetIds: uniqueSorted([
        companyId,
        ...record.linkedIds.map((linked) => {
          const taskTarget = graphTargetForTaskKey(linked);
          if (taskTarget && [...drafts.keys()].includes(taskTarget)) return taskTarget;
          const target = indexedRecords.find((candidate) => candidate.recordId === linked || slugifyMemoryPathPart(candidate.title) === slugifyMemoryPathPart(linked));
          return target ? graphNoteId("evidence", target.recordId) : null;
        }),
      ]),
      sections: [
        graphSection("Source", [
          `Layer: \`${record.layer}\``,
          `Path: \`${record.sourcePath.replaceAll("\\", "/")}\``,
          graphSnippet(record.contentExcerpt),
        ]),
      ],
    });
  }

  const curationRows = db.prepare(`
    SELECT id, target_type, target_id, state, actor, note, metadata_json, created_at, updated_at
    FROM memory_curation_states
    WHERE company_id = ?
    ORDER BY target_type, target_id, id
    LIMIT ?
  `).all(company.id, limit) as GraphCurationRow[];
  for (const curation of curationRows) {
    const targetId = curation.target_type === "source_index"
      ? graphTargetForMemoryIndex(curation.target_id)
      : graphTargetForMemoryRecord(curation.target_id);
    addGraphDraft(drafts, {
      id: graphNoteId("curation", `${curation.target_type}:${curation.target_id}`),
      kind: "curation",
      title: `Curation - ${curation.target_type} ${curation.target_id}`,
      aliases: graphAliases(curation.id, curation.target_id),
      tags: graphTags("curation", [curation.state, curation.target_type]),
      frontmatter: {
        source_type: "memory_curation_state",
        source_id: curation.id,
        company: company.slug,
        target_type: curation.target_type,
        target_id: curation.target_id,
        curation_state: curation.state,
        updated: curation.updated_at,
      },
      linkTargetIds: uniqueSorted([companyId, targetId]),
      sections: [
        graphSection("Source", [
          `State: \`${curation.state}\``,
          curation.actor ? `Actor: ${curation.actor}` : "",
          graphSnippet(curation.note),
        ]),
      ],
    });
  }

  const goalEvidenceRows = db.prepare(`
    SELECT gce.id, gce.item_id, gce.item_kind, gce.status, gce.result_text, gce.artifact_uri,
           s.name AS sprint_name, p.id AS project_id, p.name AS project_name, gce.created_at, gce.updated_at
    FROM goal_contract_evidence gce
    JOIN sprints s ON s.id = gce.sprint_id
    JOIN projects p ON p.id = s.project_id
    WHERE p.company_id = ?
    ORDER BY gce.created_at DESC, gce.id
    LIMIT ?
  `).all(company.id, limit) as GraphGoalEvidenceRow[];
  for (const evidence of goalEvidenceRows) {
    addGraphDraft(drafts, {
      id: graphNoteId("evidence", `goal:${evidence.id}`),
      kind: "evidence",
      title: `Goal Evidence - ${evidence.sprint_name} - ${evidence.item_kind}`,
      aliases: graphAliases(evidence.id, evidence.item_id),
      tags: graphTags("evidence", ["goal-contract", evidence.status, evidence.item_kind]),
      frontmatter: {
        source_type: "goal_contract_evidence",
        source_id: evidence.id,
        company: company.slug,
        evidence_status: evidence.status,
        item_kind: evidence.item_kind,
        artifact_uri: evidence.artifact_uri ?? "",
        updated: evidence.updated_at,
      },
      linkTargetIds: [companyId, graphNoteId("project", evidence.project_id)],
      sections: [
        graphSection("Source", [
          `Project: ${evidence.project_name}`,
          `Sprint: ${evidence.sprint_name}`,
          graphSnippet(evidence.result_text),
          evidence.artifact_uri ? `Artifact: ${evidence.artifact_uri}` : "",
        ]),
      ],
    });
  }

  const relativePathById = new Map<string, string>();
  for (const draft of drafts.values()) relativePathById.set(draft.id, graphNoteRelativePath(draft));
  const noteShells = new Map<string, { title: string; relativePath: string }>();
  for (const draft of drafts.values()) {
    noteShells.set(draft.id, { title: draft.title, relativePath: relativePathById.get(draft.id)! });
  }

  const notes = [...drafts.values()]
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id))
    .map((draft) => {
      const links = uniqueSorted(draft.linkTargetIds)
        .map((targetId): GraphNoteLink | null => {
          const target = noteShells.get(targetId);
          if (!target || targetId === draft.id) return null;
          return {
            targetId,
            targetTitle: target.title,
            label: "derived",
            wikilink: graphWikilink(target),
          };
        })
        .filter((link): link is GraphNoteLink => Boolean(link));
      return renderGraphNote({
        draft,
        relativePath: relativePathById.get(draft.id)!,
        links,
      });
    });

  return {
    company: { id: company.id, slug: company.slug, name: company.name },
    vaultRoot: settings.vaultRoot,
    notes,
  };
}

export function writeGraphNoteMetadata(
  companyIdOrSlug: string,
  options: { apply?: boolean; limit?: number; db?: Database.Database } = {},
): GraphNoteWriteResult {
  const db = options.db ?? getOrchestrationDb();
  const generated = generateGraphNoteMetadata(companyIdOrSlug, { limit: options.limit, db });
  initializeCompanyMemoryVault(generated.company.id, { db });
  const planned = generated.notes.map((note) => ({
    id: note.id,
    filePath: path.join(generated.vaultRoot, note.relativePath),
    sha256: createHash("sha256").update(note.markdown).digest("hex"),
  }));
  const written: GraphNoteWriteResult["written"] = [];
  const errors: GraphNoteWriteResult["errors"] = [];

  if (options.apply) {
    for (const note of generated.notes) {
      const filePath = assertGraphNoteWritePath(generated.vaultRoot, note.relativePath);
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const previous = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null;
        if (previous !== note.markdown) fs.writeFileSync(filePath, note.markdown, "utf-8");
        indexMarkdownFile({ db, companyId: generated.company.id, root: generated.vaultRoot, sourceId: "company-vault", filePath });
        written.push({
          id: note.id,
          filePath,
          sha256: createHash("sha256").update(note.markdown).digest("hex"),
        });
      } catch (error) {
        errors.push({
          id: note.id,
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    ...generated,
    dryRun: !options.apply,
    zone: "graph",
    planned,
    written,
    errors,
  };
}

type KnowledgeMapRecord = MemoryIndexRecord & {
  normalizedType: string;
};

type MutableKnowledgeCluster = {
  id: string;
  title: string;
  summaryParts: Set<string>;
  sourceIds: Set<string>;
};

const KNOWLEDGE_MAP_CONFIG: Array<{
  kind: KnowledgeMapKind;
  title: string;
  filename: string;
  emptyText: string;
}> = [
  {
    kind: "entities",
    title: "Knowledge Map - Entities",
    filename: "entities.md",
    emptyText: "No entity clusters were found in the indexed vault notes.",
  },
  {
    kind: "projects",
    title: "Knowledge Map - Projects",
    filename: "projects.md",
    emptyText: "No project clusters were found in the indexed vault notes.",
  },
  {
    kind: "workflows",
    title: "Knowledge Map - Workflows",
    filename: "workflows.md",
    emptyText: "No workflow clusters were found in the indexed vault notes.",
  },
  {
    kind: "evidence",
    title: "Knowledge Map - Evidence",
    filename: "evidence.md",
    emptyText: "No evidence clusters were found in the indexed vault notes.",
  },
];

function stableString(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(stableString).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

function frontmatterStringList(frontmatter: Record<string, unknown>, keys: string[]): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const raw = frontmatter[key];
    if (Array.isArray(raw)) values.push(...raw.map(String));
    if (typeof raw === "string") values.push(...raw.split(/[,;]+/));
  }
  return uniqueSorted(values);
}

function tagValues(tags: string[], prefixes: string[]): string[] {
  const values: string[] = [];
  for (const tag of tags) {
    const normalized = tag.trim();
    for (const prefix of prefixes) {
      if (normalized.toLowerCase().startsWith(prefix)) {
        values.push(normalized.slice(prefix.length).replace(/^[/:-]+/, "").replace(/[-_]+/g, " "));
      }
    }
  }
  return uniqueSorted(values);
}

function clusterKey(kind: KnowledgeMapKind, value: string): string {
  return `${kind}:${slugifyMemoryPathPart(value, "cluster")}`;
}

function sourceProvenanceLine(source: KnowledgeMapCluster["sources"][number]): string {
  const sourcePath = source.sourcePath.replaceAll("\\", "/");
  const tags = source.tags.length > 0 ? `; tags: ${source.tags.slice().sort().join(", ")}` : "";
  return `- [[${source.title}]] (record: \`${source.recordId}\`; path: \`${sourcePath}\`; layer: \`${source.layer}\`${tags})`;
}

function addKnowledgeCluster(
  clusters: Map<string, MutableKnowledgeCluster>,
  kind: KnowledgeMapKind,
  title: string,
  record: KnowledgeMapRecord,
  summary: string,
): void {
  const trimmed = title.trim();
  if (!trimmed) return;
  const id = clusterKey(kind, trimmed);
  const existing = clusters.get(id) ?? {
    id,
    title: trimmed,
    summaryParts: new Set<string>(),
    sourceIds: new Set<string>(),
  };
  existing.summaryParts.add(summary);
  existing.sourceIds.add(record.recordId);
  clusters.set(id, existing);
}

function normalizedRecordType(record: MemoryIndexRecord): string {
  const candidates = [record.frontmatter.type, record.frontmatter.category, record.frontmatter.kind];
  return candidates
    .map((value) => typeof value === "string" ? value.toLowerCase() : "")
    .find(Boolean) ?? "";
}

function buildKnowledgeClusters(kind: KnowledgeMapKind, records: KnowledgeMapRecord[]): KnowledgeMapCluster[] {
  const clusters = new Map<string, MutableKnowledgeCluster>();

  for (const record of records) {
    if (record.layer === "map") continue;
    if (kind === "entities") {
      const entities = uniqueSorted([
        ...frontmatterStringList(record.frontmatter, ["entity", "entities", "people", "organizations", "topics"]),
        ...tagValues(record.tags, ["entity", "person", "org", "topic"]),
      ]);
      for (const entity of entities) {
        addKnowledgeCluster(clusters, kind, entity, record, `${record.title} contributes entity context for ${entity}.`);
      }
    }

    if (kind === "projects") {
      const projectValues = uniqueSorted([
        stableString(record.projectLink),
        ...frontmatterStringList(record.frontmatter, ["project", "project_id", "project_slug"]),
        record.layer === "project" ? stableString(record.subdirectory?.split(path.sep).at(1) ?? record.subdirectory) : "",
      ]);
      for (const project of projectValues) {
        addKnowledgeCluster(clusters, kind, project, record, `${record.title} is project-scoped source material for ${project}.`);
      }
    }

    if (kind === "workflows") {
      const workflowValues = uniqueSorted([
        ...frontmatterStringList(record.frontmatter, ["workflow", "workflows", "process", "runbook"]),
        ...tagValues(record.tags, ["workflow", "process", "runbook"]),
        record.normalizedType.includes("workflow") ? record.title : "",
      ]);
      for (const workflow of workflowValues) {
        addKnowledgeCluster(clusters, kind, workflow, record, `${record.title} documents workflow behavior for ${workflow}.`);
      }
    }

    if (kind === "evidence") {
      const taskMentions = record.linkedIds.filter((linked) => /^[A-Z]{2,10}-\d+$/.test(linked));
      const evidenceValues = uniqueSorted([
        ...frontmatterStringList(record.frontmatter, ["evidence", "evidence_cluster", "source_task_key", "source_run_id"]),
        ...tagValues(record.tags, ["evidence", "proof", "source", "provenance"]),
        ...taskMentions,
        /evidence|proof|provenance|source/.test(record.normalizedType) ? record.title : "",
      ]);
      for (const evidence of evidenceValues) {
        addKnowledgeCluster(clusters, kind, evidence, record, `${record.title} supplies evidence or provenance for ${evidence}.`);
      }
    }
  }

  const byId = new Map(records.map((record) => [record.recordId, record]));
  return [...clusters.values()]
    .map((cluster) => {
      const sources = [...cluster.sourceIds]
        .map((recordId) => byId.get(recordId))
        .filter((record): record is KnowledgeMapRecord => Boolean(record))
        .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }) || a.recordId.localeCompare(b.recordId));
      return {
        id: cluster.id,
        title: cluster.title,
        summary: [...cluster.summaryParts].sort().join(" "),
        sourceRecordIds: sources.map((source) => source.recordId),
        sources: sources.map((source) => ({
          recordId: source.recordId,
          title: source.title,
          sourcePath: source.sourcePath,
          layer: source.layer,
          tags: source.tags.slice().sort(),
        })),
      };
    })
    .filter((cluster) => cluster.sources.length > 0)
    .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

function renderKnowledgeMapMarkdown(input: {
  companySlug: string;
  kind: KnowledgeMapKind;
  title: string;
  clusters: KnowledgeMapCluster[];
  emptyText: string;
}): string {
  const sourceRecordIds = uniqueSorted(input.clusters.flatMap((cluster) => cluster.sourceRecordIds));
  const bodyLines = [
    `# ${input.title}`,
    "",
    `Company: [[${input.companySlug}]]`,
    "",
    "## Clusters",
    "",
  ];

  if (input.clusters.length === 0) {
    bodyLines.push(input.emptyText, "");
  } else {
    for (const cluster of input.clusters) {
      bodyLines.push(`### ${cluster.title}`, "");
      bodyLines.push(cluster.summary, "");
      bodyLines.push("**Provenance**", "");
      for (const source of cluster.sources) bodyLines.push(sourceProvenanceLine(source));
      bodyLines.push("");
    }
  }

  return serializeMemoryMarkdown({
    frontmatter: {
      id: `knowledge-map-${input.kind}`,
      title: input.title,
      type: "knowledge_map",
      layer: "map",
      company: input.companySlug,
      map_kind: input.kind,
      source_record_ids: sourceRecordIds,
      tags: ["hiverunner/knowledge-map", `knowledge-map/${input.kind}`],
      status: "active",
    },
    body: bodyLines.join("\n").trim(),
  });
}

export function generateKnowledgeMapNotes(
  companyIdOrSlug: string,
  options: { apply?: boolean; limit?: number; db?: Database.Database } = {},
): KnowledgeMapGenerationResult {
  const db = options.db ?? getOrchestrationDb();
  const { company, settings } = getCompanyMemorySettings(companyIdOrSlug, { persistDefaults: true, db });
  initializeCompanyMemoryVault(company.id, { db });
  const mapDir = path.join(settings.vaultRoot, "maps");
  const records = listMemoryIndexRecords(company.id, {
    status: "active",
    limit: options.limit ?? 1000,
    db,
  }).records
    .filter((record) => record.layer !== "map")
    .map((record) => ({ ...record, normalizedType: normalizedRecordType(record) }));

  const notes = KNOWLEDGE_MAP_CONFIG.map((config) => {
    const clusters = buildKnowledgeClusters(config.kind, records);
    const filePath = path.join(mapDir, config.filename);
    const markdown = renderKnowledgeMapMarkdown({
      companySlug: company.slug,
      kind: config.kind,
      title: config.title,
      clusters,
      emptyText: config.emptyText,
    });
    return {
      kind: config.kind,
      title: config.title,
      filePath,
      markdown,
      sha256: createHash("sha256").update(markdown).digest("hex"),
      clusters,
    };
  });

  if (options.apply) {
    fs.mkdirSync(mapDir, { recursive: true });
    for (const note of notes) {
      const previous = fs.existsSync(note.filePath) ? fs.readFileSync(note.filePath, "utf-8") : null;
      if (previous !== note.markdown) fs.writeFileSync(note.filePath, note.markdown, "utf-8");
      indexMarkdownFile({ db, companyId: company.id, root: settings.vaultRoot, sourceId: "company-vault", filePath: note.filePath });
    }
  }

  return {
    company: { id: company.id, slug: company.slug, name: company.name },
    vaultRoot: settings.vaultRoot,
    dryRun: !options.apply,
    notes,
  };
}

function resolveProjectSlug(db: Database.Database, projectId: string | null): string | null {
  if (!projectId) return null;
  const row = db.prepare("SELECT slug, name FROM projects WHERE id = ? LIMIT 1").get(projectId) as { slug: string | null; name: string } | undefined;
  return row ? slugifyMemoryPathPart(row.slug || row.name, "project") : null;
}

function resolveAgentSlug(db: Database.Database, agentId: string | null): string | null {
  if (!agentId) return null;
  const row = db.prepare("SELECT slug, name FROM agents WHERE id = ? LIMIT 1").get(agentId) as { slug: string | null; name: string } | undefined;
  return row ? slugifyMemoryPathPart(row.slug || row.name, "agent") : null;
}

function uniqueFilePath(dir: string, title: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const base = slugifyMemoryPathPart(title, "memory-note");
  let candidate = path.join(dir, `${base}.md`);
  for (let i = 2; fs.existsSync(candidate); i += 1) {
    candidate = path.join(dir, `${base}-${i}.md`);
  }
  return candidate;
}

function candidateTitle(candidate: MemoryCandidate): string {
  const raw = candidate.body.replace(/\s+/g, " ").trim();
  const prefix = candidate.category ? `${candidate.category}: ` : "";
  return `${prefix}${raw.slice(0, Math.max(20, 90 - prefix.length))}${raw.length > 90 ? "..." : ""}`;
}

function categoryToKind(category: string | null): CompanyMemoryKind {
  switch (category?.toLowerCase()) {
    case "legal":
    case "financial":
      return "domain_constraint";
    case "decision":
      return "decision";
    case "preference":
      return "preference";
    case "architecture":
      return "architecture";
    case "workflow":
      return "workflow_note";
    case "skill":
      return "skill_evidence";
    default:
      return "fact";
  }
}

function rowToApprovedCandidate(row: ApprovedCandidateBackfillRow): MemoryCandidate {
  return {
    id: row.id,
    companyId: row.company_id,
    body: row.body,
    type: row.type,
    tags: row.tags,
    category: row.category,
    status: row.status,
    scope: row.scope,
    proposedByAgent: row.proposed_by_agent,
    sourceTaskId: row.source_task_id,
    sourceTaskKey: row.source_task_key,
    sourceRunId: row.source_run_id,
    proposedAt: row.proposed_at,
    routingTarget: row.routing_target,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    targetSourceFile: row.target_source_file,
  };
}

function candidateTargetDir(input: {
  db: Database.Database;
  vaultRoot: string;
  scope: string;
  sourceTaskId: string | null;
}): string {
  if (input.scope === "company") return path.join(input.vaultRoot, "company");
  const task = input.sourceTaskId
    ? input.db.prepare("SELECT project_id, assignee_agent_id FROM tasks WHERE id = ? LIMIT 1").get(input.sourceTaskId) as { project_id: string | null; assignee_agent_id: string | null } | undefined
    : undefined;
  const projectSlug = resolveProjectSlug(input.db, task?.project_id ?? null);
  if (projectSlug) return path.join(input.vaultRoot, "projects", projectSlug);
  const agentSlug = resolveAgentSlug(input.db, task?.assignee_agent_id ?? null);
  if (agentSlug) return path.join(input.vaultRoot, "agents", agentSlug);
  return path.join(input.vaultRoot, "inbox");
}

export function writeCandidateToCompanyVault(input: {
  candidate: MemoryCandidate;
  companySlug: string;
  reviewedBy: string;
  db?: Database.Database;
}): { filePath: string; recordId: string; title: string } {
  const db = input.db ?? getOrchestrationDb();
  const { company, settings } = getCompanyMemorySettings(input.companySlug, { persistDefaults: true, db });
  initializeCompanyMemoryVault(company.id, { db });
  const title = candidateTitle(input.candidate);
  const targetDir = candidateTargetDir({
    db,
    vaultRoot: settings.vaultRoot,
    scope: input.candidate.scope === "company" ? "company" : "role_project",
    sourceTaskId: input.candidate.sourceTaskId,
  });
  const filePath = uniqueFilePath(targetDir, title);
  const now = new Date().toISOString();
  const recordId = randomUUID();
  const tags = input.candidate.tags ? parseJsonArray(input.candidate.tags) : [];

  const markdown = serializeMemoryMarkdown({
    frontmatter: {
      id: recordId,
      title,
      type: input.candidate.type ?? input.candidate.category ?? "fact",
      layer: path.relative(settings.vaultRoot, targetDir).split(path.sep)[0] === "projects" ? "project" : "company",
      company: company.slug,
      source_task_key: input.candidate.sourceTaskKey ?? "",
      source_run_id: input.candidate.sourceRunId ?? "",
      status: "active",
      tags,
      created: now,
      updated: now,
      proposed_by: input.candidate.proposedByAgent ?? "",
      approved_by: input.reviewedBy,
    },
    body: input.candidate.body,
  });

  try {
    fs.writeFileSync(filePath, markdown, "utf-8");
    indexMarkdownFile({ db, companyId: company.id, root: settings.vaultRoot, sourceId: "company-vault", filePath });
    const writebackHash = createHash("sha256").update(markdown).digest("hex");
    if (tableIdIsInteger(db, "memory_writeback_log")) {
      db.prepare(
        `INSERT INTO memory_writeback_log
           (company_id, candidate_id, record_id, source_path, action, after_snapshot, written_at, attribution)
         VALUES (?, ?, ?, ?, 'create', ?, ?, ?)`,
      ).run(company.id, input.candidate.id, recordId, filePath, writebackHash, now, input.reviewedBy);
    } else {
      db.prepare(
        `INSERT INTO memory_writeback_log
           (id, company_id, candidate_id, record_id, source_path, action, after_snapshot, written_at, attribution)
         VALUES (?, ?, ?, ?, ?, 'create', ?, ?, ?)`,
      ).run(randomUUID(), company.id, input.candidate.id, recordId, filePath, writebackHash, now, input.reviewedBy);
    }
  } catch (error) {
    try {
      db.prepare("DELETE FROM memory_source_index WHERE record_id = ? OR source_path = ?").run(recordId, filePath);
    } catch {
      // Best-effort cleanup: preserve the original writeback error.
    }
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // Best-effort cleanup: preserve the original writeback error.
    }
    throw error;
  }

  return { filePath, recordId, title };
}

export function backfillActiveMemoryRecordsToVault(input: {
  companySlug: string;
  apply?: boolean;
  db?: Database.Database;
}): {
  dryRun: boolean;
  planned: Array<{ id: string; title: string; filePath: string; source: "company_memory_record" }>;
  candidatePlanned: Array<{ id: string; title: string; filePath: string; source: "memory_candidate" }>;
  written: number;
  candidatesWritten: number;
  errors: Array<{ id: string; source: "company_memory_record" | "memory_candidate"; error: string }>;
} {
  const db = input.db ?? getOrchestrationDb();
  const company = resolveCompany(input.companySlug, db);
  const { settings } = getCompanyMemorySettings(company.id, { persistDefaults: true, db });
  initializeCompanyMemoryVault(company.id, { db });
  const rows = db.prepare(`
    SELECT id, title, body, kind, scope, project_id, agent_id, task_id, execution_run_id, metadata_json, created_at, updated_at
    FROM company_memory_records
    WHERE company_id = ?
      AND status = 'active'
      AND archived_at IS NULL
  `).all(company.id) as Array<CompanyMemoryRecord & {
    project_id: string | null;
    agent_id: string | null;
    task_id: string | null;
    execution_run_id: string | null;
    metadata_json: string;
    created_at: string;
    updated_at: string;
  }>;

  const planned: Array<{ id: string; title: string; filePath: string; source: "company_memory_record" }> = [];
  const candidatePlanned: Array<{ id: string; title: string; filePath: string; source: "memory_candidate" }> = [];
  const errors: Array<{ id: string; source: "company_memory_record" | "memory_candidate"; error: string }> = [];
  let written = 0;
  for (const row of rows) {
    const metadata = parseJsonObject(row.metadata_json);
    if (typeof metadata.sourcePath === "string" && metadata.sourcePath.trim()) continue;
    const dir = row.scope === "project"
      ? path.join(settings.vaultRoot, "projects", resolveProjectSlug(db, row.project_id) ?? "unknown-project")
      : row.scope === "agent"
        ? path.join(settings.vaultRoot, "agents", resolveAgentSlug(db, row.agent_id) ?? "unknown-agent")
        : path.join(settings.vaultRoot, "company");
    const filePath = uniqueFilePath(dir, row.title);
    planned.push({ id: row.id, title: row.title, filePath, source: "company_memory_record" });
    if (!input.apply) continue;
    try {
      const markdown = serializeMemoryMarkdown({
        frontmatter: {
          id: row.id,
          title: row.title,
          type: row.kind,
          layer: row.scope,
          status: "active",
          created: row.created_at,
          updated: row.updated_at,
        },
        body: row.body,
      });
      fs.writeFileSync(filePath, markdown, "utf-8");
      indexMarkdownFile({ db, companyId: company.id, root: settings.vaultRoot, sourceId: "company-vault", filePath });
      db.prepare("UPDATE company_memory_records SET metadata_json = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify({ ...metadata, sourcePath: filePath, canonical: "company_vault" }),
        new Date().toISOString(),
        row.id,
      );
      written += 1;
    } catch (error) {
      errors.push({ id: row.id, source: "company_memory_record", error: error instanceof Error ? error.message : String(error) });
    }
  }

  const candidateRows = db.prepare(`
    SELECT
      mc.id, mc.company_id, mc.body, mc.type, mc.tags, mc.category, mc.status, mc.scope,
      mc.proposed_by_agent, mc.source_task_id, t.task_key AS source_task_key, mc.source_run_id,
      mc.proposed_at, mc.routing_target, mc.reviewed_by, mc.reviewed_at, mc.target_source_file
    FROM memory_candidates mc
    LEFT JOIN tasks t ON t.id = mc.source_task_id
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE mc.status = 'approved'
      AND (mc.company_id = ? OR (mc.company_id IS NULL AND p.company_id = ?))
      AND mc.target_source_file IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM memory_writeback_log mwl
        WHERE mwl.candidate_id = mc.id AND mwl.error IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM company_memory_records cmr
        WHERE cmr.company_id = ?
          AND cmr.metadata_json LIKE '%' || mc.id || '%'
      )
    ORDER BY mc.reviewed_at DESC, mc.proposed_at DESC
  `).all(company.id, company.id, company.id) as ApprovedCandidateBackfillRow[];

  let candidatesWritten = 0;
  for (const row of candidateRows) {
    const candidate = rowToApprovedCandidate(row);
    const reviewedBy = candidate.reviewedBy ?? "backfill";
    const targetDir = candidateTargetDir({
      db,
      vaultRoot: settings.vaultRoot,
      scope: candidate.scope === "company" ? "company" : "role_project",
      sourceTaskId: candidate.sourceTaskId,
    });
    const title = candidateTitle(candidate);
    const filePath = uniqueFilePath(targetDir, title);
    candidatePlanned.push({ id: candidate.id, title, filePath, source: "memory_candidate" });
    if (!input.apply) continue;
    try {
      const write = writeCandidateToCompanyVault({ candidate, companySlug: company.id, reviewedBy, db });
      createCompanyMemoryRecord(company.id, {
        title: write.title,
        body: candidate.body,
        kind: categoryToKind(candidate.category),
        scope: "company",
        status: "active",
        source: "task",
        confidence: 0.8,
        reviewRequired: false,
        reviewState: "approved",
        taskId: candidate.sourceTaskId ?? undefined,
        metadata: {
          candidateId: candidate.id,
          canonical: "company_vault",
          vaultRecordId: write.recordId,
          sourcePath: write.filePath,
          proposedByAgent: candidate.proposedByAgent ?? null,
          approvedBy: reviewedBy,
          targetSourceFile: candidate.targetSourceFile ?? null,
          tags: candidate.tags ?? null,
          backfilledAt: new Date().toISOString(),
        },
      });
      candidatesWritten += 1;
    } catch (error) {
      errors.push({ id: candidate.id, source: "memory_candidate", error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { dryRun: !input.apply, planned, candidatePlanned, written, candidatesWritten, errors };
}
