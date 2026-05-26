import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { createCompanyMemoryRecord, type CompanyMemoryKind } from "@/lib/orchestration/company-memory";
import type { MemoryCandidate } from "@/lib/orchestration/memory-candidates";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  getCompanyMemorySettings,
  serializeMemoryMarkdown,
  slugifyMemoryPathPart,
  syncCompanyMemoryVault,
} from "@/lib/orchestration/memory-vault";

export type WriteBackResult = {
  status: "written";
  fileWritten: boolean;
  filePath: string | null;
  fileSha256Before: string | null;
  fileSha256After: string | null;
  memoryRecordId: string;
  action: "append" | "create" | "append_failed";
  error: string | null;
};

export class MemoryWritebackError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "MemoryWritebackError";
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_WRITABLE_ZONES = new Set(["company", "projects", "agents", "sessions", "inbox"]);

async function sha256OfFile(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
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

function candidateTitle(candidate: MemoryCandidate): string {
  const prefix = candidate.category ? `[${candidate.category}] ` : "";
  const excerpt = candidate.body.slice(0, 80 - prefix.length);
  const ellipsis = candidate.body.length > 80 - prefix.length ? "…" : "";
  return `${prefix}${excerpt}${ellipsis}`.trim() || "Memory note";
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Fall through to whitespace/comma parsing.
  }
  return raw.split(/[,\s]+/).map((tag) => tag.trim()).filter(Boolean);
}

function layerForRelativePath(relativePath: string): string {
  const [first] = relativePath.split(path.sep);
  if (first === "projects") return "project";
  if (first === "agents") return "agent";
  if (first === "sessions") return "session";
  if (first === "inbox") return "inbox";
  return "company";
}

function pathIsInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertWritableMarkdownPath(input: {
  vaultRoot: string;
  filePath: string;
  writableZones?: Set<string>;
}): Promise<string> {
  const vaultRoot = path.resolve(input.vaultRoot);
  const filePath = path.resolve(input.filePath);
  if (!pathIsInside(vaultRoot, filePath)) {
    throw new MemoryWritebackError(
      "path_outside_vault",
      "Memory Markdown writeback refused: target path is outside the company vault.",
      403,
    );
  }

  const relativePath = path.relative(vaultRoot, filePath);
  const firstSegment = relativePath.split(path.sep)[0];
  const writableZones = input.writableZones ?? DEFAULT_WRITABLE_ZONES;
  if (!firstSegment || !writableZones.has(firstSegment)) {
    throw new MemoryWritebackError(
      "read_only_zone",
      "Memory Markdown writeback refused: target path is not in a declared writable vault zone.",
      403,
    );
  }

  if (!/\.(md|markdown)$/i.test(filePath)) {
    throw new MemoryWritebackError(
      "invalid_markdown_path",
      "Memory Markdown writeback refused: target path must be a Markdown file.",
      400,
    );
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      throw new MemoryWritebackError(
        "target_is_directory",
        "Memory Markdown writeback refused: target path is a directory.",
        400,
      );
    }
  } catch (error) {
    if (error instanceof MemoryWritebackError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  return filePath;
}

async function uniqueFilePath(dir: string, title: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const base = slugifyMemoryPathPart(title, "memory-note");
  let candidate = path.join(dir, `${base}.md`);
  for (let i = 2; ; i += 1) {
    try {
      await fs.access(candidate);
      candidate = path.join(dir, `${base}-${i}.md`);
    } catch {
      return candidate;
    }
  }
}

function successfulWritebackForCandidate(candidateId: string): {
  record_id: string | null;
  source_path: string;
  action: "append" | "create";
  before_snapshot: string | null;
  after_snapshot: string | null;
} | null {
  return getOrchestrationDb().prepare(`
    SELECT record_id, source_path, action, before_snapshot, after_snapshot
    FROM memory_writeback_log
    WHERE candidate_id = ?
      AND error IS NULL
      AND action IN ('create','append')
    ORDER BY written_at DESC
    LIMIT 1
  `).get(candidateId) as {
    record_id: string | null;
    source_path: string;
    action: "append" | "create";
    before_snapshot: string | null;
    after_snapshot: string | null;
  } | null;
}

function memoryRecordIdForCandidate(companyId: string, candidateId: string): string | null {
  const row = getOrchestrationDb().prepare(`
    SELECT id
    FROM company_memory_records
    WHERE company_id = ?
      AND metadata_json LIKE ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(companyId, `%"candidateId":"${candidateId}"%`) as { id: string } | undefined;
  return row?.id ?? null;
}

function tableIdIsInteger(tableName: string): boolean {
  const columns = getOrchestrationDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string; type: string }>;
  return columns.some((column) => column.name === "id" && column.type.toUpperCase().includes("INTEGER"));
}

function insertWritebackLog(input: {
  companyId: string;
  candidateId: string;
  recordId: string | null;
  sourcePath: string;
  action: string;
  beforeSnapshot: string | null;
  afterSnapshot: string | null;
  attribution: string;
  error: string | null;
}) {
  const db = getOrchestrationDb();
  const now = new Date().toISOString();
  if (tableIdIsInteger("memory_writeback_log")) {
    db.prepare(
      `INSERT INTO memory_writeback_log
         (company_id, candidate_id, record_id, source_path, action, before_snapshot, after_snapshot, written_at, attribution, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.companyId,
      input.candidateId,
      input.recordId,
      input.sourcePath,
      input.action,
      input.beforeSnapshot,
      input.afterSnapshot,
      now,
      input.attribution,
      input.error,
    );
    return;
  }

  db.prepare(
    `INSERT INTO memory_writeback_log
       (id, company_id, candidate_id, record_id, source_path, action, before_snapshot, after_snapshot, written_at, attribution, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.companyId,
    input.candidateId,
    input.recordId,
    input.sourcePath,
    input.action,
    input.beforeSnapshot,
    input.afterSnapshot,
    now,
    input.attribution,
    input.error,
  );
}

/**
 * Called after an operator approves a memory candidate (final approval, not specialist pre-approval).
 *
 * Steps:
 *   1. Write the approved candidate into the company's canonical Markdown vault.
 *   2. Create an active company_memory_record as an index/workflow overlay.
 *
 * target_source_file is honored only when it already sits inside the company vault.
 * HiveRunner never writes to the global wiki implicitly.
 */
export async function writeBackApprovedCandidate(
  candidate: MemoryCandidate,
  companySlug: string,
  reviewedBy: string,
  options: { expectedFileSha256?: string | null; writableZones?: string[] } = {},
): Promise<WriteBackResult> {
  let fileWritten = false;
  let filePath: string | null = null;
  let sha256Before: string | null = null;
  let sha256After: string | null = null;
  let vaultRecordId: string | null = null;
  let vaultTitle: string | null = null;
  let action: WriteBackResult["action"] = "create";
  let error: string | null = null;

  const { company, settings } = getCompanyMemorySettings(companySlug, { persistDefaults: true });
  if (candidate.status !== "approved") {
    throw new MemoryWritebackError(
      "candidate_not_approved",
      "Memory Markdown writeback refused: candidate must be approved before writing to the vault.",
      403,
    );
  }

  const previousWrite = successfulWritebackForCandidate(candidate.id);
  if (previousWrite) {
    return {
      status: "written",
      fileWritten: false,
      filePath: previousWrite.source_path,
      fileSha256Before: previousWrite.before_snapshot,
      fileSha256After: await sha256OfFile(previousWrite.source_path) ?? previousWrite.after_snapshot,
      memoryRecordId: memoryRecordIdForCandidate(company.id, candidate.id) ?? previousWrite.record_id ?? candidate.id,
      action: previousWrite.action,
      error: null,
    };
  }

  const vaultRoot = path.resolve(settings.vaultRoot);
  const writableZones = options.writableZones ? new Set(options.writableZones) : DEFAULT_WRITABLE_ZONES;
  const targetPath = candidate.targetSourceFile ? path.resolve(candidate.targetSourceFile) : null;

  if (targetPath) {
    filePath = await assertWritableMarkdownPath({ vaultRoot, filePath: targetPath, writableZones });
    sha256Before = await sha256OfFile(targetPath);
    if (options.expectedFileSha256 && sha256Before !== options.expectedFileSha256) {
      throw new MemoryWritebackError(
        "file_hash_conflict",
        "Memory Markdown writeback refused: target file changed since preview.",
        409,
      );
    }

    const timestamp = new Date().toISOString();
    const markerStart = `<!-- memory-writeback id:${candidate.id}`;
    const existing = sha256Before === null ? "" : await fs.readFile(targetPath, "utf-8");
    if (existing.includes(markerStart)) {
      sha256After = sha256Before;
      fileWritten = false;
      action = "append";
    } else {
    const block = [
      "",
      `<!-- memory-writeback id:${candidate.id} approved:${timestamp} by:${reviewedBy} -->`,
      candidate.body,
      `<!-- /memory-writeback -->`,
      "",
    ].join("\n");

    try {
      await fs.appendFile(targetPath, block, "utf-8");
      sha256After = await sha256OfFile(targetPath);
      fileWritten = true;
      action = "append";
    } catch (writeError) {
      action = "append_failed";
      error = writeError instanceof Error ? writeError.message : String(writeError);
      throw new Error(error);
    }
    }

    try {
      const sync = syncCompanyMemoryVault(companySlug, { includeGlobalWiki: false });
      if (sync.errors.length > 0) {
        throw new Error(`Memory vault sync failed after append: ${sync.errors[0].error}`);
      }
      const indexed = getOrchestrationDb()
        .prepare("SELECT record_id FROM memory_source_index WHERE company_id = ? AND source_path = ? LIMIT 1")
        .get(company.id, targetPath) as { record_id: string } | undefined;
      insertWritebackLog({
        companyId: company.id,
        candidateId: candidate.id,
        recordId: indexed?.record_id ?? null,
        sourcePath: targetPath,
        action,
        beforeSnapshot: sha256Before,
        afterSnapshot: sha256After,
        attribution: reviewedBy,
        error: null,
      });
    } catch (writeError) {
      action = "append_failed";
      error = writeError instanceof Error ? writeError.message : String(writeError);
      if (fileWritten && sha256Before !== null) {
        await fs.writeFile(targetPath, existing, "utf-8");
      }
      insertWritebackLog({
        companyId: company.id,
        candidateId: candidate.id,
        recordId: null,
        sourcePath: targetPath,
        action,
        beforeSnapshot: sha256Before,
        afterSnapshot: sha256After,
        attribution: reviewedBy,
        error,
      });
      throw new Error(`Memory Markdown writeback failed: ${error}`);
    }
  } else {
    const targetDir = candidate.scope === "company"
      ? path.join(vaultRoot, "company")
      : path.join(vaultRoot, "projects", slugifyMemoryPathPart(candidate.sourceTaskKey ?? candidate.sourceTaskId ?? "memory", "memory"));
    vaultTitle = candidateTitle(candidate);
    filePath = await uniqueFilePath(targetDir, vaultTitle);
    filePath = await assertWritableMarkdownPath({ vaultRoot, filePath, writableZones });
    vaultRecordId = randomUUID();
    const now = new Date().toISOString();
    const relativePath = path.relative(vaultRoot, filePath);
    const markdown = serializeMemoryMarkdown({
      frontmatter: {
        id: vaultRecordId,
        title: vaultTitle,
        type: candidate.type ?? candidate.category ?? "fact",
        layer: layerForRelativePath(relativePath),
        company: company.slug,
        source_task_key: candidate.sourceTaskKey ?? "",
        source_run_id: candidate.sourceRunId ?? "",
        status: "active",
        tags: parseTags(candidate.tags),
        created: now,
        updated: now,
        proposed_by: candidate.proposedByAgent ?? "",
        approved_by: reviewedBy,
        writeback_candidate_id: candidate.id,
      },
      body: candidate.body,
    });
    sha256Before = null;
    sha256After = createHash("sha256").update(markdown).digest("hex");
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, markdown, "utf-8");
      fileWritten = true;
      action = "create";
      const sync = syncCompanyMemoryVault(companySlug, { includeGlobalWiki: false });
      if (sync.errors.length > 0) {
        throw new Error(`Memory vault sync failed after create: ${sync.errors[0].error}`);
      }
      insertWritebackLog({
        companyId: company.id,
        candidateId: candidate.id,
        recordId: vaultRecordId,
        sourcePath: filePath,
        action,
        beforeSnapshot: null,
        afterSnapshot: sha256After,
        attribution: reviewedBy,
        error: null,
      });
    } catch (writeError) {
      error = writeError instanceof Error ? writeError.message : String(writeError);
      try {
        await fs.rm(filePath, { force: true });
      } catch {
        // Preserve the original writeback error.
      }
      try {
        getOrchestrationDb().prepare("DELETE FROM memory_source_index WHERE record_id = ? OR source_path = ?").run(vaultRecordId, filePath);
      } catch {
        // Preserve the original writeback error.
      }
      throw new Error(`Memory Markdown writeback failed: ${error}`);
    }
  }

  const { memory } = createCompanyMemoryRecord(company.id, {
    title: vaultTitle ?? candidateTitle(candidate),
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
      vaultRecordId,
      sourcePath: filePath,
      proposedByAgent: candidate.proposedByAgent ?? null,
      approvedBy: reviewedBy,
      targetSourceFile: candidate.targetSourceFile ?? null,
      fileSha256Before: sha256Before,
      fileSha256After: sha256After,
      writebackAction: action,
      writebackError: error,
      tags: candidate.tags ?? null,
    },
  });

  return {
    status: "written",
    fileWritten,
    filePath,
    fileSha256Before: sha256Before,
    fileSha256After: sha256After,
    memoryRecordId: memory.id,
    action,
    error,
  };
}
