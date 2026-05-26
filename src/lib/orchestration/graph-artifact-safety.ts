import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import {
  getCompanyMemorySettings,
  syncCompanyMemoryVault,
} from "@/lib/orchestration/memory-vault";

export const DEFAULT_GRAPH_ARTIFACT_ZONES = ["graph", "maps"] as const;

export type GraphArtifactZone = typeof DEFAULT_GRAPH_ARTIFACT_ZONES[number] | string;

export type GraphArtifactFileSnapshot = {
  relativePath: string;
  zone: string;
  sha256: string;
  sizeBytes: number;
  mtimeMs: number;
  content: string | null;
};

export type GraphArtifactInventory = {
  vaultRoot: string;
  zones: string[];
  capturedAt: string;
  files: GraphArtifactFileSnapshot[];
};

export type GraphArtifactWrite = {
  path: string;
  content: string;
};

export type GraphArtifactInventoryDiff = {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: string[];
};

export type GraphArtifactWriteResult = {
  companyId: string;
  companySlug: string;
  vaultRoot: string;
  zones: string[];
  before: GraphArtifactInventory;
  after: GraphArtifactInventory;
  diff: GraphArtifactInventoryDiff;
  writes: Array<{
    relativePath: string;
    sha256Before: string | null;
    sha256After: string;
    changed: boolean;
  }>;
  rollbackNotes: string;
  sync: {
    filesChecked: number;
    filesReindexed: number;
    filesRemoved: number;
    errors: Array<{ path: string; error: string }>;
  };
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pathIsInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort();
}

function normalizeZones(zones: readonly string[] | undefined): string[] {
  return sortedUnique(zones ?? DEFAULT_GRAPH_ARTIFACT_ZONES);
}

function displayPath(value: string): string {
  return value.split(path.sep).join("/");
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walkFiles(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return files.sort();
}

export function assertGraphArtifactPath(input: {
  vaultRoot: string;
  targetPath: string;
  zones?: readonly string[];
}): { absolutePath: string; relativePath: string; zone: string } {
  const vaultRoot = path.resolve(input.vaultRoot);
  const targetPath = input.targetPath.trim();
  if (!targetPath) {
    throw new OrchestrationApiError(400, "missing_graph_artifact_path", "Graph artifact path is required.");
  }

  const absolutePath = path.resolve(path.isAbsolute(targetPath) ? targetPath : path.join(vaultRoot, targetPath));
  if (!pathIsInside(vaultRoot, absolutePath)) {
    throw new OrchestrationApiError(
      403,
      "graph_artifact_path_outside_vault",
      "Graph artifact write refused: target path is outside the company vault.",
    );
  }

  const relativePath = path.relative(vaultRoot, absolutePath);
  const [zone] = relativePath.split(path.sep);
  const allowedZones = new Set(normalizeZones(input.zones));
  if (!zone || !allowedZones.has(zone)) {
    throw new OrchestrationApiError(
      403,
      "graph_artifact_zone_not_allowed",
      "Graph artifact write refused: target path is not in a declared graph/map zone.",
      { allowedZones: [...allowedZones], relativePath: displayPath(relativePath) },
    );
  }

  if (!/\.(md|markdown|json)$/i.test(absolutePath)) {
    throw new OrchestrationApiError(
      400,
      "invalid_graph_artifact_extension",
      "Graph artifact write refused: target path must be Markdown or JSON.",
    );
  }

  return { absolutePath, relativePath: displayPath(relativePath), zone };
}

export async function snapshotGraphArtifactInventory(input: {
  vaultRoot: string;
  zones?: readonly string[];
  includeContent?: boolean;
}): Promise<GraphArtifactInventory> {
  const vaultRoot = path.resolve(input.vaultRoot);
  const zones = normalizeZones(input.zones);
  const files: GraphArtifactFileSnapshot[] = [];
  for (const zone of zones) {
    const zoneRoot = path.join(vaultRoot, zone);
    for (const filePath of await walkFiles(zoneRoot)) {
      const relativePath = displayPath(path.relative(vaultRoot, filePath));
      const stat = await fs.stat(filePath);
      const content = await fs.readFile(filePath, "utf-8");
      files.push({
        relativePath,
        zone,
        sha256: sha256(content),
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        content: input.includeContent === false ? null : content,
      });
    }
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return {
    vaultRoot,
    zones,
    capturedAt: new Date().toISOString(),
    files,
  };
}

export function diffGraphArtifactInventories(
  before: GraphArtifactInventory,
  after: GraphArtifactInventory,
): GraphArtifactInventoryDiff {
  const beforeByPath = new Map(before.files.map((file) => [file.relativePath, file]));
  const afterByPath = new Map(after.files.map((file) => [file.relativePath, file]));
  const paths = sortedUnique([...beforeByPath.keys(), ...afterByPath.keys()]);
  const diff: GraphArtifactInventoryDiff = { added: [], changed: [], removed: [], unchanged: [] };

  for (const relativePath of paths) {
    const oldFile = beforeByPath.get(relativePath);
    const newFile = afterByPath.get(relativePath);
    if (!oldFile && newFile) diff.added.push(relativePath);
    else if (oldFile && !newFile) diff.removed.push(relativePath);
    else if (oldFile && newFile && oldFile.sha256 !== newFile.sha256) diff.changed.push(relativePath);
    else diff.unchanged.push(relativePath);
  }

  return diff;
}

export async function rollbackGraphArtifactInventory(snapshot: GraphArtifactInventory): Promise<GraphArtifactInventory> {
  if (snapshot.files.some((file) => file.content === null)) {
    throw new OrchestrationApiError(
      400,
      "graph_artifact_snapshot_missing_content",
      "Graph artifact rollback requires a snapshot captured with file content.",
    );
  }

  const current = await snapshotGraphArtifactInventory({
    vaultRoot: snapshot.vaultRoot,
    zones: snapshot.zones,
    includeContent: false,
  });
  const snapshotPaths = new Set(snapshot.files.map((file) => file.relativePath));
  for (const file of current.files) {
    if (!snapshotPaths.has(file.relativePath)) {
      await fs.rm(path.join(snapshot.vaultRoot, file.relativePath), { force: true });
    }
  }
  for (const file of snapshot.files) {
    const destination = path.join(snapshot.vaultRoot, file.relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, file.content ?? "", "utf-8");
  }
  return snapshotGraphArtifactInventory({
    vaultRoot: snapshot.vaultRoot,
    zones: snapshot.zones,
    includeContent: true,
  });
}

export function formatGraphArtifactRollbackNotes(result: Pick<GraphArtifactWriteResult, "vaultRoot" | "zones" | "diff" | "writes">): string {
  const touched = sortedUnique([
    ...result.diff.added,
    ...result.diff.changed,
    ...result.diff.removed,
    ...result.writes.map((write) => write.relativePath),
  ]);
  const lines = [
    "# Graph Artifact Rollback Notes",
    "",
    `Vault root: ${result.vaultRoot}`,
    `Declared zones: ${result.zones.join(", ")}`,
    "",
    "## Rollback Procedure",
    "",
    "1. Stop graph/map generation for the company.",
    "2. Restore the before snapshot captured immediately before generation.",
    "3. Remove files listed as added if no snapshot copy exists.",
    "4. Re-run vault sync/indexing for the company.",
    "5. Re-run graph artifact safety checks; expected diff after rollback is empty.",
    "",
    "## Touched Paths",
    "",
    ...(touched.length > 0 ? touched.map((relativePath) => `- ${relativePath}`) : ["- None"]),
  ];
  return `${lines.join("\n")}\n`;
}

export async function writeGraphArtifactsSafely(
  companyIdOrSlug: string,
  writes: GraphArtifactWrite[],
  options: { zones?: readonly string[] } = {},
): Promise<GraphArtifactWriteResult> {
  if (writes.length === 0) {
    throw new OrchestrationApiError(400, "missing_graph_artifact_writes", "At least one graph artifact write is required.");
  }

  const { company, settings } = getCompanyMemorySettings(companyIdOrSlug, { persistDefaults: true });
  const zones = normalizeZones(options.zones);
  const before = await snapshotGraphArtifactInventory({
    vaultRoot: settings.vaultRoot,
    zones,
    includeContent: true,
  });
  const planned = writes.map((write) => ({
    ...write,
    ...assertGraphArtifactPath({ vaultRoot: settings.vaultRoot, targetPath: write.path, zones }),
  }));

  const results: GraphArtifactWriteResult["writes"] = [];
  for (const write of planned) {
    const beforeFile = before.files.find((file) => file.relativePath === write.relativePath);
    const nextSha = sha256(write.content);
    if (beforeFile?.sha256 === nextSha) {
      results.push({
        relativePath: write.relativePath,
        sha256Before: beforeFile.sha256,
        sha256After: nextSha,
        changed: false,
      });
      continue;
    }

    await fs.mkdir(path.dirname(write.absolutePath), { recursive: true });
    await fs.writeFile(write.absolutePath, write.content, "utf-8");
    results.push({
      relativePath: write.relativePath,
      sha256Before: beforeFile?.sha256 ?? null,
      sha256After: nextSha,
      changed: true,
    });
  }

  const after = await snapshotGraphArtifactInventory({
    vaultRoot: settings.vaultRoot,
    zones,
    includeContent: true,
  });
  const diff = diffGraphArtifactInventories(before, after);
  const sync = syncCompanyMemoryVault(company.id, { includeGlobalWiki: false });
  if (sync.errors.length > 0) {
    await rollbackGraphArtifactInventory(before);
    throw new OrchestrationApiError(
      500,
      "graph_artifact_sync_failed",
      `Graph artifact write rolled back after vault sync failed: ${sync.errors[0].error}`,
      { path: sync.errors[0].path },
    );
  }

  const baseResult = {
    companyId: company.id,
    companySlug: company.slug,
    vaultRoot: settings.vaultRoot,
    zones,
    before,
    after,
    diff,
    writes: results,
    sync,
  };
  return {
    ...baseResult,
    rollbackNotes: formatGraphArtifactRollbackNotes(baseResult),
  };
}
