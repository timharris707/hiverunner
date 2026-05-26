import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  getCompanyMemorySettings,
  serializeMemoryMarkdown,
  slugifyMemoryPathPart,
  syncCompanyMemoryVault,
} from "@/lib/orchestration/memory-vault";
import {
  createWikiWritebackRequest,
  getWikiWritebackRequest,
  updateWikiWritebackApprovalState,
  wikiContentHash,
  type WikiWritebackRequest,
} from "@/lib/orchestration/wiki-writeback-requests";

export type WikiMarkdownWritebackPrepared = {
  request: WikiWritebackRequest;
  generatedMarkdown: string;
  targetFilePath: string;
  previousFileHash: string | null;
  idempotent: boolean;
};

export type WikiMarkdownWritebackResult = {
  request: WikiWritebackRequest;
  status: "written";
  fileWritten: boolean;
  filePath: string;
  fileSha256Before: string | null;
  fileSha256After: string;
  idempotent: boolean;
};

type MemoryRow = {
  id: string;
  slug: string;
  title: string;
  body: string;
  kind: string;
  scope: string;
  status: string;
  review_state: string;
  metadata_json: string | null;
  task_key: string | null;
};

const DEFAULT_WRITABLE_ZONES = new Set(["company", "projects", "agents", "sessions", "inbox"]);
const GENERATED_BLOCK_START_PREFIX = "<!-- hiverunner-wiki-writeback:start";
const GENERATED_BLOCK_END = "<!-- hiverunner-wiki-writeback:end -->";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function sha256OfFile(filePath: string): Promise<string | null> {
  try {
    return sha256(await fs.readFile(filePath, "utf-8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function pathIsInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function firstWritableSegment(vaultRoot: string, filePath: string): string {
  return path.relative(vaultRoot, filePath).split(path.sep)[0] ?? "";
}

async function resolveWritableMarkdownPath(input: {
  vaultRoot: string;
  targetPath: string;
  writableZones?: readonly string[];
}): Promise<{ filePath: string; relativePath: string }> {
  const vaultRoot = path.resolve(input.vaultRoot);
  const target = input.targetPath.trim();
  if (!target) {
    throw new OrchestrationApiError(400, "missing_writeback_target_path", "targetPath is required");
  }

  const filePath = path.resolve(path.isAbsolute(target) ? target : path.join(vaultRoot, target));
  if (!pathIsInside(vaultRoot, filePath)) {
    throw new OrchestrationApiError(403, "path_outside_vault", "Wiki write-back refused: target path is outside the company vault.");
  }

  const writableZones = new Set(input.writableZones ?? [...DEFAULT_WRITABLE_ZONES]);
  const segment = firstWritableSegment(vaultRoot, filePath);
  if (!segment || !writableZones.has(segment)) {
    throw new OrchestrationApiError(403, "read_only_zone", "Wiki write-back refused: target path is not in a declared writable vault zone.");
  }

  if (!/\.(md|markdown)$/i.test(filePath)) {
    throw new OrchestrationApiError(400, "invalid_markdown_path", "Wiki write-back refused: target path must be a Markdown file.");
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      throw new OrchestrationApiError(400, "target_is_directory", "Wiki write-back refused: target path is a directory.");
    }
  } catch (error) {
    if (error instanceof OrchestrationApiError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  return { filePath, relativePath: path.relative(vaultRoot, filePath).split(path.sep).join("/") };
}

function loadApprovedMemoryRows(companyId: string, sourceMemoryIds: readonly string[]): MemoryRow[] {
  const ids = [...new Set(sourceMemoryIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    throw new OrchestrationApiError(400, "missing_source_memory_ids", "sourceMemoryIds must include at least one memory record id");
  }

  const placeholders = ids.map(() => "?").join(", ");
  const rows = getOrchestrationDb().prepare(`
    SELECT cmr.id, cmr.slug, cmr.title, cmr.body, cmr.kind, cmr.scope,
           cmr.status, cmr.review_state, cmr.metadata_json, t.task_key
    FROM company_memory_records cmr
    LEFT JOIN tasks t ON t.id = cmr.task_id
    WHERE cmr.company_id = ?
      AND cmr.id IN (${placeholders})
    ORDER BY cmr.updated_at ASC, cmr.created_at ASC
  `).all(companyId, ...ids) as MemoryRow[];

  const found = new Set(rows.map((row) => row.id));
  const missing = ids.find((id) => !found.has(id));
  if (missing) throw new OrchestrationApiError(404, "memory_not_found", `Company memory record not found: ${missing}`);

  const unapproved = rows.find((row) => row.status !== "active" || row.review_state !== "approved");
  if (unapproved) {
    throw new OrchestrationApiError(
      403,
      "memory_not_approved",
      "Wiki write-back refused: every source memory record must be active and approved.",
    );
  }

  return ids.map((id) => rows.find((row) => row.id === id)!);
}

function markdownList(values: readonly string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}

function renderApprovedMemoryMarkdown(input: {
  companySlug: string;
  targetRelativePath: string;
  sourceRows: readonly MemoryRow[];
  curationActionIds: readonly string[];
}): string {
  const title = input.sourceRows.length === 1 ? input.sourceRows[0].title : "Curated Company Memory";
  const body = [
    `# ${title}`,
    "",
    "## Source Memories",
    "",
    ...input.sourceRows.flatMap((row) => {
      const metadata = parseJsonObject(row.metadata_json);
      const provenance = [
        `memory:${row.id}`,
        row.task_key ? `task:${row.task_key}` : null,
        typeof metadata.sourcePath === "string" ? `source:${metadata.sourcePath}` : null,
      ].filter(Boolean);
      return [
        `### ${row.title}`,
        "",
        row.body.trim(),
        "",
        provenance.length ? `Provenance: ${provenance.join(" | ")}` : `Provenance: memory:${row.id}`,
        "",
      ];
    }),
    "## Curation",
    "",
    input.curationActionIds.length
      ? markdownList(input.curationActionIds.map((id) => `curation-action:${id}`))
      : "- curation-action: none recorded",
  ].join("\n");

  return serializeMemoryMarkdown({
    frontmatter: {
      id: `wiki-${slugifyMemoryPathPart(input.targetRelativePath, randomUUID())}`,
      title,
      layer: input.targetRelativePath.split("/")[0] ?? "company",
      status: "active",
      company: input.companySlug,
      source_memory_ids: input.sourceRows.map((row) => row.id),
      curation_action_ids: input.curationActionIds,
      generated_by: "hiverunner-wiki-writeback",
    },
    body,
  });
}

function generatedBlock(requestId: string, generatedHash: string, markdown: string): string {
  return [
    `${GENERATED_BLOCK_START_PREFIX} request:${requestId} hash:${generatedHash} -->`,
    markdown.trim(),
    GENERATED_BLOCK_END,
  ].join("\n");
}

function mergeGeneratedMarkdown(existing: string | null, requestId: string, generatedHash: string, markdown: string): string {
  if (existing === null) return markdown;
  const block = generatedBlock(requestId, generatedHash, markdown);
  const pattern = new RegExp(
    `${GENERATED_BLOCK_START_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} request:${requestId}[^\\n]*-->[\\s\\S]*?${GENERATED_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "m",
  );
  if (pattern.test(existing)) return existing.replace(pattern, block);
  return `${existing.replace(/\s*$/, "")}\n\n${block}\n`;
}

export async function prepareWikiMarkdownWriteback(companyIdOrSlug: string, input: {
  targetPath: string;
  sourceMemoryIds: readonly string[];
  curationActionIds?: readonly string[];
  idempotencyKey: string;
  requestedBy?: string | null;
  writableZones?: readonly string[];
}): Promise<WikiMarkdownWritebackPrepared> {
  const { company, settings } = getCompanyMemorySettings(companyIdOrSlug, { persistDefaults: true });
  const target = await resolveWritableMarkdownPath({
    vaultRoot: settings.vaultRoot,
    targetPath: input.targetPath,
    writableZones: input.writableZones,
  });
  const sourceRows = loadApprovedMemoryRows(company.id, input.sourceMemoryIds);
  const curationActionIds = [...new Set((input.curationActionIds ?? []).map((id) => id.trim()).filter(Boolean))];
  const generatedMarkdown = renderApprovedMemoryMarkdown({
    companySlug: company.slug,
    targetRelativePath: target.relativePath,
    sourceRows,
    curationActionIds,
  });
  const previousFileHash = await sha256OfFile(target.filePath);
  const created = createWikiWritebackRequest(company.id, {
    targetPath: target.relativePath,
    idempotencyKey: input.idempotencyKey,
    sourceMemoryIds: sourceRows.map((row) => row.id),
    curationActionIds,
    generatedContentHash: wikiContentHash(generatedMarkdown),
    previousFileHash,
    rollback: {
      strategy: previousFileHash ? "restore_previous_hash" : "delete_created_file",
      targetPath: target.relativePath,
      previousFileHash,
    },
    requestedBy: input.requestedBy,
  });

  return {
    request: created.request,
    generatedMarkdown,
    targetFilePath: target.filePath,
    previousFileHash,
    idempotent: created.idempotent,
  };
}

export async function executeApprovedWikiMarkdownWriteback(requestId: string, input: {
  actor?: string | null;
  writableZones?: readonly string[];
} = {}): Promise<WikiMarkdownWritebackResult> {
  const request = getWikiWritebackRequest(requestId);
  if (!request) throw new OrchestrationApiError(404, "wiki_writeback_request_not_found", "Wiki write-back request not found");
  if (request.approvalState === "written") {
    const { settings } = getCompanyMemorySettings(request.companyId, { persistDefaults: true });
    const target = await resolveWritableMarkdownPath({
      vaultRoot: settings.vaultRoot,
      targetPath: request.targetPath,
      writableZones: input.writableZones,
    });
    const afterHash = await sha256OfFile(target.filePath);
    if (!afterHash) throw new OrchestrationApiError(409, "written_file_missing", "Wiki write-back retry refused: written file is missing.");
    return {
      request,
      status: "written",
      fileWritten: false,
      filePath: target.filePath,
      fileSha256Before: request.previousFileHash,
      fileSha256After: afterHash,
      idempotent: true,
    };
  }
  if (request.approvalState !== "approved") {
    throw new OrchestrationApiError(403, "writeback_not_approved", "Wiki write-back refused: request must be approved before writing.");
  }

  const { company, settings } = getCompanyMemorySettings(request.companyId, { persistDefaults: true });
  const target = await resolveWritableMarkdownPath({
    vaultRoot: settings.vaultRoot,
    targetPath: request.targetPath,
    writableZones: input.writableZones,
  });
  const sourceRows = loadApprovedMemoryRows(company.id, request.sourceMemoryIds);
  const generatedMarkdown = renderApprovedMemoryMarkdown({
    companySlug: company.slug,
    targetRelativePath: target.relativePath,
    sourceRows,
    curationActionIds: request.curationActionIds,
  });
  const generatedHash = wikiContentHash(generatedMarkdown);
  if (generatedHash !== request.generatedContentHash) {
    updateWikiWritebackApprovalState(request.id, {
      approvalState: "failed",
      failureReason: "Generated content changed since approval.",
    });
    throw new OrchestrationApiError(409, "generated_content_changed", "Wiki write-back refused: generated content changed since approval.");
  }

  const existing = await fs.readFile(target.filePath, "utf-8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const beforeHash = existing === null ? null : sha256(existing);
  if (beforeHash !== request.previousFileHash) {
    updateWikiWritebackApprovalState(request.id, {
      approvalState: "failed",
      failureReason: "Target file changed since approval preview.",
      previousFileHash: beforeHash,
      rollback: { ...request.rollback, conflictHash: beforeHash },
    });
    throw new OrchestrationApiError(409, "file_hash_conflict", "Wiki write-back refused: target file changed since approval preview.");
  }

  const nextContent = mergeGeneratedMarkdown(existing, request.id, generatedHash, generatedMarkdown);
  const afterHash = sha256(nextContent);
  await fs.mkdir(path.dirname(target.filePath), { recursive: true });
  await fs.writeFile(target.filePath, nextContent, "utf-8");
  const sync = syncCompanyMemoryVault(company.id, { includeGlobalWiki: false });
  if (sync.errors.length > 0) {
    if (existing === null) {
      await fs.rm(target.filePath, { force: true });
    } else {
      await fs.writeFile(target.filePath, existing, "utf-8");
    }
    throw new OrchestrationApiError(500, "memory_vault_sync_failed", `Memory vault sync failed after wiki write-back: ${sync.errors[0].error}`);
  }

  const updated = updateWikiWritebackApprovalState(request.id, {
    approvalState: "written",
    approvedBy: input.actor ?? null,
    previousFileHash: beforeHash,
    rollback: {
      ...request.rollback,
      targetPath: target.relativePath,
      previousFileHash: beforeHash,
      writtenFileHash: afterHash,
    },
  });

  return {
    request: updated,
    status: "written",
    fileWritten: true,
    filePath: target.filePath,
    fileSha256Before: beforeHash,
    fileSha256After: afterHash,
    idempotent: false,
  };
}
