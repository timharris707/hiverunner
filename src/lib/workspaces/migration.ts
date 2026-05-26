import fs from "fs";
import path from "path";

import { MC_DATA_DIR } from "@/lib/data-dir";
import { resolveWorkspaceBase } from "@/lib/files/workspace-resolver";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  resolvePlannedCanonicalCompanyWorkspaceRoot,
  resolveAgentWorkspacePathWithLegacyFallback,
  resolveCanonicalCompanyWorkspaceRoot,
  resolveCompanyProjectWorkspacePath,
  resolveCompanyWorkspaceRoot,
  resolveLegacyOpenClawAgentWorkspacePath,
} from "@/lib/workspaces/company-paths";
import { classifyCompanyWorkspaceRoot } from "@/lib/workspaces/delete-safety";
import {
  resolveHiveRunnerLane,
  resolveHiveRunnerWorkspaceRoot,
  resolveHiveRunnerWorkspaceRootSource,
  resolveOpenClawDir,
  resolveOpenClawWorkspaceRoot,
} from "@/lib/workspaces/root";

const DEFAULT_COMPANY_ID = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
const DIRECTORY_MARKER_NAMES = ["agents", "projects", "memory", "scripts", ".git", ".openclaw"];

type OrchestrationDb = ReturnType<typeof getOrchestrationDb>;

type CompanyInventoryRow = {
  id: string;
  slug: string;
  workspace_slug: string | null;
  name: string;
  status: string;
  archived_at: string | null;
  workspace_root: string | null;
  workspace_source: "openclaw" | "provisioned" | "imported" | "manual" | null;
  project_count: number;
  agent_count: number;
};

type ProjectInventoryRow = {
  id: string;
  slug: string;
  name: string;
  company_id: string;
  company_slug: string;
  company_workspace_slug: string | null;
  company_workspace_root: string | null;
  company_workspace_source: "openclaw" | "provisioned" | "imported" | "manual" | null;
};

type AgentInventoryRow = {
  id: string;
  slug: string | null;
  name: string;
  company_id: string;
  company_slug: string;
  project_id: string | null;
  project_slug: string | null;
  company_workspace_slug: string | null;
  company_workspace_root: string | null;
  company_workspace_source: "openclaw" | "provisioned" | "imported" | "manual" | null;
};

export type WorkspaceInventoryDirectorySummary = {
  exists: boolean;
  kind: "missing" | "file" | "directory";
  realPath: string | null;
  topLevelEntryCount: number;
  sampleEntries: string[];
  markers: string[];
};

export type WorkspaceMigrationLocationKind =
  | "hiverunner-company"
  | "legacy-openclaw-company"
  | "legacy-openclaw-workspaces"
  | "openclaw-default-workspace"
  | "external";

export type WorkspaceMigrationClassification =
  | "safe-auto-migrate"
  | "manual-review"
  | "blocked";

export type WorkspaceMigrationCompanyRecord = {
  companyId: string;
  companySlug: string;
  workspaceSlug: string;
  companyName: string;
  status: string;
  archivedAt: string | null;
  isDefaultCompany: boolean;
  persistedWorkspaceRoot: string | null;
  workspaceSource: "openclaw" | "provisioned" | "imported" | "manual" | null;
  resolvedCurrentWorkspaceRoot: string;
  proposedWorkspaceRoot: string;
  plannedWorkspaceRoot: string;
  sourceLocationKind: WorkspaceMigrationLocationKind;
  sourceSummary: WorkspaceInventoryDirectorySummary;
  destinationSummary: WorkspaceInventoryDirectorySummary;
  sourceExists: boolean;
  destinationExists: boolean;
  projectCount: number;
  agentCount: number;
  classification: WorkspaceMigrationClassification;
  reasons: string[];
  collisions: string[];
  unsafeConditions: string[];
  resolutionMode: "persisted" | "canonical-fallback" | "openclaw-compatibility";
};

export type WorkspaceMigrationOrphanedDirectoryRecord = {
  path: string;
  rootKind:
    | "hiverunner-companies-root"
    | "legacy-openclaw-companies-root"
    | "legacy-openclaw-workspaces-root";
  summary: WorkspaceInventoryDirectorySummary;
  matchedCurrentCompanyIds: string[];
  matchedProposedCompanyIds: string[];
  classification: "manual-review" | "blocked";
  reasons: string[];
};

export type WorkspaceMigrationLegacyAgentDirectoryRecord = {
  path: string;
  agentSlug: string;
  matchedAgentIds: string[];
  matchedCompanyIds: string[];
  summary: WorkspaceInventoryDirectorySummary;
  classification: "legacy-compatible" | "manual-review";
  reasons: string[];
};

export type WorkspaceMigrationEnvironment = {
  lane: "dev" | "stable";
  hiveRunnerWorkspaceRoot: string;
  hiveRunnerWorkspaceRootSource: "MC_WORKSPACE_ROOT" | "default";
  hiveRunnerCompaniesRoot: string;
  openClawDir: string;
  openClawWorkspaceRoot: string;
  openClawCompaniesRoot: string;
  openClawLegacyWorkspacesRoot: string;
  backupRoot: string;
  orchestrationDbPath: string;
};

export type WorkspaceMigrationInventory = {
  generatedAt: string;
  environment: WorkspaceMigrationEnvironment;
  companies: WorkspaceMigrationCompanyRecord[];
  orphanedDirectories: WorkspaceMigrationOrphanedDirectoryRecord[];
  legacyAgentDirectories: WorkspaceMigrationLegacyAgentDirectoryRecord[];
  summary: {
    companyCount: number;
    safeAutoMigrate: number;
    manualReview: number;
    blocked: number;
    orphanedDirectoryCount: number;
    legacyAgentDirectoryCount: number;
  };
};

export type WorkspaceMigrationBackupRowSnapshot = {
  companies: CompanyInventoryRow[];
  projects: ProjectInventoryRow[];
  agents: AgentInventoryRow[];
};

export type WorkspaceMigrationBackupPlan = {
  generatedAt: string;
  snapshotId: string;
  outputRoot: string;
  inventory: WorkspaceMigrationInventory;
  rows: WorkspaceMigrationBackupRowSnapshot;
  directorySources: Array<{
    sourcePath: string;
    companyId: string | null;
    companySlug: string | null;
    exists: boolean;
    classification: WorkspaceMigrationClassification | "manual-review";
    reasons: string[];
  }>;
};

export type WorkspaceMigrationVerificationStatus = "ok" | "warning" | "blocked";

export type WorkspaceMigrationVerificationReport = {
  generatedAt: string;
  environment: WorkspaceMigrationEnvironment;
  companyResolution: Array<{
    companyId: string;
    companySlug: string;
    workspaceId: string;
    resolvedPath: string | null;
    expectedPath: string;
    status: WorkspaceMigrationVerificationStatus;
    messages: string[];
  }>;
  projectResolution: Array<{
    projectId: string;
    projectSlug: string;
    companySlug: string;
    workspaceId: string;
    resolvedPath: string | null;
    expectedPath: string | null;
    exists: boolean;
    status: WorkspaceMigrationVerificationStatus;
    messages: string[];
  }>;
  agentResolution: Array<{
    agentId: string;
    agentName: string;
    agentSlug: string | null;
    companySlug: string;
    resolvedPath: string | null;
    source:
      | "company-convention"
      | "legacy-openclaw-subworkspace"
      | "legacy-openclaw-workspace"
      | "missing-slug";
    exists: boolean;
    status: WorkspaceMigrationVerificationStatus;
    messages: string[];
  }>;
  deletionSafety: Array<{
    companyId: string;
    companySlug: string;
    workspaceRoot: string;
    classification:
      | "hiverunner"
      | "legacy-openclaw-company"
      | "legacy-openclaw-agent-workspace"
      | "default-openclaw-workspace"
      | "external";
    safeToDelete: boolean;
    status: WorkspaceMigrationVerificationStatus;
    messages: string[];
  }>;
  legacyCompatibility: Array<{
    check: string;
    status: WorkspaceMigrationVerificationStatus;
    message: string;
  }>;
  summary: {
    ok: number;
    warning: number;
    blocked: number;
  };
};

function resolveConfiguredDbPath(): string {
  return process.env.ORCHESTRATION_DB_PATH?.trim()
    ? path.resolve(process.env.ORCHESTRATION_DB_PATH)
    : path.join(MC_DATA_DIR, "orchestration.db");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function summarizeDirectory(targetPath: string): WorkspaceInventoryDirectorySummary {
  const resolved = path.resolve(targetPath);
  try {
    const stats = fs.statSync(resolved);
    if (!stats.isDirectory()) {
      return {
        exists: true,
        kind: "file",
        realPath: fs.realpathSync.native(resolved),
        topLevelEntryCount: 0,
        sampleEntries: [],
        markers: [],
      };
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const sampleEntries = entries.slice(0, 12).map((entry) => entry.name);
    const markers = DIRECTORY_MARKER_NAMES.filter((name) => fs.existsSync(path.join(resolved, name)));

    return {
      exists: true,
      kind: "directory",
      realPath: fs.realpathSync.native(resolved),
      topLevelEntryCount: entries.length,
      sampleEntries,
      markers,
    };
  } catch {
    return {
      exists: false,
      kind: "missing",
      realPath: null,
      topLevelEntryCount: 0,
      sampleEntries: [],
      markers: [],
    };
  }
}

function classifyWorkspaceLocationKind(
  workspaceRoot: string,
  environment: WorkspaceMigrationEnvironment,
): WorkspaceMigrationLocationKind {
  const resolved = path.resolve(workspaceRoot);
  const hiveRunnerCompaniesRoot = path.resolve(environment.hiveRunnerCompaniesRoot);
  if (
    resolved !== hiveRunnerCompaniesRoot &&
    resolved.startsWith(`${hiveRunnerCompaniesRoot}${path.sep}`)
  ) {
    return "hiverunner-company";
  }

  const openClawCompaniesRoot = path.resolve(environment.openClawCompaniesRoot);
  if (
    resolved !== openClawCompaniesRoot &&
    resolved.startsWith(`${openClawCompaniesRoot}${path.sep}`)
  ) {
    return "legacy-openclaw-company";
  }

  const openClawLegacyWorkspacesRoot = path.resolve(environment.openClawLegacyWorkspacesRoot);
  if (
    resolved !== openClawLegacyWorkspacesRoot &&
    resolved.startsWith(`${openClawLegacyWorkspacesRoot}${path.sep}`)
  ) {
    return "legacy-openclaw-workspaces";
  }

  if (resolved === path.resolve(environment.openClawWorkspaceRoot)) {
    return "openclaw-default-workspace";
  }

  return "external";
}

function detectResolutionMode(row: CompanyInventoryRow): WorkspaceMigrationCompanyRecord["resolutionMode"] {
  if (row.workspace_root?.trim()) {
    return "persisted";
  }
  if (row.id === DEFAULT_COMPANY_ID || row.workspace_source === "openclaw") {
    return "openclaw-compatibility";
  }
  return "canonical-fallback";
}

function listChildDirectories(
  rootPath: string,
): string[] {
  try {
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(rootPath, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function buildEnvironment(env: NodeJS.ProcessEnv = process.env): WorkspaceMigrationEnvironment {
  const hiveRunnerWorkspaceRoot = resolveHiveRunnerWorkspaceRoot(env);
  const openClawDir = resolveOpenClawDir(env);
  const openClawWorkspaceRoot = resolveOpenClawWorkspaceRoot(env);
  const lane = resolveHiveRunnerLane(env);
  const hiveRunnerRoot = path.dirname(path.dirname(hiveRunnerWorkspaceRoot));

  return {
    lane,
    hiveRunnerWorkspaceRoot,
    hiveRunnerWorkspaceRootSource: resolveHiveRunnerWorkspaceRootSource(env),
    hiveRunnerCompaniesRoot: path.join(hiveRunnerWorkspaceRoot, "companies"),
    openClawDir,
    openClawWorkspaceRoot,
    openClawCompaniesRoot: path.join(openClawWorkspaceRoot, "companies"),
    openClawLegacyWorkspacesRoot: path.join(openClawDir, "workspaces"),
    backupRoot: path.join(hiveRunnerRoot, "backups", "migration", lane),
    orchestrationDbPath: resolveConfiguredDbPath(),
  };
}

function loadCompanyRows(db: OrchestrationDb): CompanyInventoryRow[] {
  return db
    .prepare(
      `SELECT
         c.id,
         c.slug,
         c.workspace_slug,
         c.name,
         c.status,
         c.archived_at,
         c.workspace_root,
         c.workspace_source,
         COUNT(DISTINCT p.id) AS project_count,
         COUNT(DISTINCT a.id) AS agent_count
       FROM companies c
       LEFT JOIN projects p ON p.company_id = c.id AND p.archived_at IS NULL
       LEFT JOIN agents a ON a.company_id = c.id AND a.archived_at IS NULL
       GROUP BY c.id
       ORDER BY c.created_at ASC`
    )
    .all() as CompanyInventoryRow[];
}

function loadProjectRows(db: OrchestrationDb): ProjectInventoryRow[] {
  return db
    .prepare(
      `SELECT
         p.id,
         p.slug,
         p.name,
         p.company_id,
         c.slug AS company_slug,
         c.workspace_slug AS company_workspace_slug,
         c.workspace_root AS company_workspace_root,
         c.workspace_source AS company_workspace_source
       FROM projects p
       INNER JOIN companies c ON c.id = p.company_id
       WHERE p.archived_at IS NULL
       ORDER BY c.slug ASC, p.slug ASC`
    )
    .all() as ProjectInventoryRow[];
}

function loadAgentRows(db: OrchestrationDb): AgentInventoryRow[] {
  return db
    .prepare(
      `SELECT
         a.id,
         a.slug,
         a.name,
         a.company_id,
         c.slug AS company_slug,
         a.project_id,
         p.slug AS project_slug,
         c.workspace_slug AS company_workspace_slug,
         c.workspace_root AS company_workspace_root,
         c.workspace_source AS company_workspace_source
       FROM agents a
       INNER JOIN companies c ON c.id = a.company_id
       LEFT JOIN projects p ON p.id = a.project_id
       WHERE a.archived_at IS NULL
       ORDER BY c.slug ASC, COALESCE(a.slug, a.name) ASC`
    )
    .all() as AgentInventoryRow[];
}

function discoverDirectoryCandidates(
  environment: WorkspaceMigrationEnvironment,
): Array<{
  path: string;
  rootKind:
    | "hiverunner-companies-root"
    | "legacy-openclaw-companies-root"
    | "legacy-openclaw-workspaces-root";
}> {
  return [
    ...listChildDirectories(environment.hiveRunnerCompaniesRoot).map((candidatePath) => ({
      path: candidatePath,
      rootKind: "hiverunner-companies-root" as const,
    })),
    ...listChildDirectories(environment.openClawCompaniesRoot).map((candidatePath) => ({
      path: candidatePath,
      rootKind: "legacy-openclaw-companies-root" as const,
    })),
    ...listChildDirectories(environment.openClawLegacyWorkspacesRoot).map((candidatePath) => ({
      path: candidatePath,
      rootKind: "legacy-openclaw-workspaces-root" as const,
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
}

function discoverLegacyAgentDirectories(
  environment: WorkspaceMigrationEnvironment,
  agents: AgentInventoryRow[],
): WorkspaceMigrationLegacyAgentDirectoryRecord[] {
  return listChildDirectories(environment.openClawDir)
    .filter((candidatePath) => path.basename(candidatePath).startsWith("workspace-"))
    .map((candidatePath) => {
      const agentSlug = path.basename(candidatePath).replace(/^workspace-/, "");
      const matchedAgents = agents.filter((agent) => agent.slug?.trim() === agentSlug);
      const reasons: string[] = [];
      let classification: WorkspaceMigrationLegacyAgentDirectoryRecord["classification"] =
        "legacy-compatible";
      const preferredLegacyWorkspace = resolveLegacyOpenClawAgentWorkspacePath(
        agentSlug,
        {
          ...process.env,
          OPENCLAW_DIR: environment.openClawDir,
          OPENCLAW_WORKSPACE_ROOT: environment.openClawWorkspaceRoot,
        },
      );

      if (matchedAgents.length === 0) {
        classification = "manual-review";
        reasons.push("no_matching_agent_row");
      } else if (matchedAgents.length > 1) {
        classification = "manual-review";
        reasons.push("multiple_matching_agent_rows");
      } else if (preferredLegacyWorkspace.exists && preferredLegacyWorkspace.path !== candidatePath) {
        classification = "manual-review";
        reasons.push("superseded_by_openclaw_subworkspace");
      }

      return {
        path: candidatePath,
        agentSlug,
        matchedAgentIds: matchedAgents.map((agent) => agent.id),
        matchedCompanyIds: uniqueStrings(matchedAgents.map((agent) => agent.company_id)),
        summary: summarizeDirectory(candidatePath),
        classification,
        reasons,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function readWorkspaceMigrationInventory(options?: {
  db?: OrchestrationDb;
  env?: NodeJS.ProcessEnv;
}): WorkspaceMigrationInventory {
  const db = options?.db ?? getOrchestrationDb();
  const environment = buildEnvironment(options?.env);
  const companyRows = loadCompanyRows(db);
  const projectRows = loadProjectRows(db);
  const agentRows = loadAgentRows(db);

  const companies = companyRows.map((row) => {
    const isDefaultCompany = row.id === DEFAULT_COMPANY_ID;
    const workspaceSlug = row.workspace_slug?.trim() || row.slug;
    const resolvedCurrentWorkspaceRoot = resolveCompanyWorkspaceRoot({
      companyId: row.id,
      workspaceSlug,
      workspaceRoot: row.workspace_root,
      workspaceSource: row.workspace_source,
      isDefaultCompany,
      env: options?.env,
    });
    const proposedWorkspaceRoot = resolveCanonicalCompanyWorkspaceRoot(
      row.id,
      workspaceSlug,
      options?.env,
    );
    const plannedWorkspaceRoot = resolvePlannedCanonicalCompanyWorkspaceRoot(
      row.id,
      workspaceSlug,
      options?.env,
    );
    const sourceSummary = summarizeDirectory(resolvedCurrentWorkspaceRoot);
    const destinationSummary = summarizeDirectory(proposedWorkspaceRoot);
    const sourceLocationKind = classifyWorkspaceLocationKind(resolvedCurrentWorkspaceRoot, environment);
    const resolutionMode = detectResolutionMode(row);
    const reasons: string[] = [];
    const collisions: string[] = [];
    const unsafeConditions: string[] = [];
    let classification: WorkspaceMigrationClassification = "safe-auto-migrate";

    if (isDefaultCompany) {
      classification = "blocked";
      reasons.push("default_company_explicit_openclaw_compatibility");
      unsafeConditions.push("default HiveRunner workspace is excluded from auto-migration");
    }

    if (row.archived_at) {
      if (classification !== "blocked") {
        classification = "manual-review";
      }
      reasons.push("company_row_archived");
    }

    if (!sourceSummary.exists) {
      if (classification !== "blocked") {
        classification = "manual-review";
      }
      reasons.push("source_directory_missing");
    }

    if (destinationSummary.exists && path.resolve(proposedWorkspaceRoot) !== path.resolve(resolvedCurrentWorkspaceRoot)) {
      if (classification !== "blocked") {
        classification = "manual-review";
      }
      collisions.push("proposed_destination_already_exists");
    }

    if (
      sourceLocationKind === "external" ||
      sourceLocationKind === "openclaw-default-workspace"
    ) {
      classification = "blocked";
      unsafeConditions.push(`unsafe_source_root:${sourceLocationKind}`);
    }

    if (path.resolve(proposedWorkspaceRoot) === path.resolve(resolvedCurrentWorkspaceRoot)) {
      reasons.push("already_on_canonical_destination");
    } else if (sourceLocationKind === "legacy-openclaw-workspaces") {
      reasons.push("legacy_openclaw_workspaces_source");
    } else if (sourceLocationKind === "legacy-openclaw-company") {
      reasons.push("legacy_openclaw_company_source");
    }

    const sourceDeletionClassification = classifyCompanyWorkspaceRoot(
      resolvedCurrentWorkspaceRoot,
      options?.env,
    );
    if (!sourceDeletionClassification.safeToDelete && !isDefaultCompany) {
      classification = "blocked";
      unsafeConditions.push(
        `delete_safety_rejected:${sourceDeletionClassification.classification}`,
      );
    }

    return {
      companyId: row.id,
      companySlug: row.slug,
      workspaceSlug,
      companyName: row.name,
      status: row.status,
      archivedAt: row.archived_at,
      isDefaultCompany,
      persistedWorkspaceRoot: row.workspace_root?.trim() ? path.resolve(row.workspace_root) : null,
      workspaceSource: row.workspace_source,
      resolvedCurrentWorkspaceRoot,
      proposedWorkspaceRoot,
      plannedWorkspaceRoot,
      sourceLocationKind,
      sourceSummary,
      destinationSummary,
      sourceExists: sourceSummary.exists && sourceSummary.kind === "directory",
      destinationExists: destinationSummary.exists && destinationSummary.kind === "directory",
      projectCount: row.project_count,
      agentCount: row.agent_count,
      classification,
      reasons,
      collisions,
      unsafeConditions,
      resolutionMode,
    } satisfies WorkspaceMigrationCompanyRecord;
  });

  const currentRootOwners = new Map<string, string[]>();
  const proposedRootOwners = new Map<string, string[]>();
  for (const company of companies) {
    const currentRoot = path.resolve(company.resolvedCurrentWorkspaceRoot);
    const proposedRoot = path.resolve(company.proposedWorkspaceRoot);
    currentRootOwners.set(currentRoot, [...(currentRootOwners.get(currentRoot) ?? []), company.companyId]);
    proposedRootOwners.set(proposedRoot, [...(proposedRootOwners.get(proposedRoot) ?? []), company.companyId]);
  }

  for (const company of companies) {
    const proposedRoot = path.resolve(company.proposedWorkspaceRoot);
    const currentOwners = (currentRootOwners.get(proposedRoot) ?? []).filter(
      (owner) => owner !== company.companyId,
    );
    if (currentOwners.length > 0) {
      company.classification = "manual-review";
      company.collisions.push(
        `proposed_destination_matches_current_root_of:${currentOwners.join(",")}`,
      );
    }

    const proposedOwners = (proposedRootOwners.get(proposedRoot) ?? []).filter(
      (owner) => owner !== company.companyId,
    );
    if (proposedOwners.length > 0) {
      company.classification = "blocked";
      company.unsafeConditions.push(
        `duplicate_proposed_destination_with:${proposedOwners.join(",")}`,
      );
    }
  }

  const discoveredDirectories = discoverDirectoryCandidates(environment);
  const orphanedDirectories = discoveredDirectories
    .map((candidate): WorkspaceMigrationOrphanedDirectoryRecord | null => {
      const resolvedCandidate = path.resolve(candidate.path);
      const matchedCurrentCompanyIds = companies
        .filter((company) => path.resolve(company.resolvedCurrentWorkspaceRoot) === resolvedCandidate)
        .map((company) => company.companyId);
      const matchedProposedCompanyIds = companies
        .filter((company) => path.resolve(company.proposedWorkspaceRoot) === resolvedCandidate)
        .map((company) => company.companyId);
      if (matchedCurrentCompanyIds.length > 0 || matchedProposedCompanyIds.length > 0) {
        return null;
      }

      const reasons = ["no_matching_company_row"];
      const classification: WorkspaceMigrationOrphanedDirectoryRecord["classification"] = "manual-review";
      if (candidate.rootKind === "hiverunner-companies-root") {
        reasons.push("unexpected_directory_in_canonical_root");
      }
      if (candidate.rootKind === "legacy-openclaw-companies-root") {
        reasons.push("legacy_openclaw_company_directory_without_db_row");
      }
      if (candidate.rootKind === "legacy-openclaw-workspaces-root") {
        reasons.push("legacy_openclaw_workspace_directory_without_db_row");
      }

      return {
        path: candidate.path,
        rootKind: candidate.rootKind,
        summary: summarizeDirectory(candidate.path),
        matchedCurrentCompanyIds,
        matchedProposedCompanyIds,
        classification,
        reasons,
      } satisfies WorkspaceMigrationOrphanedDirectoryRecord;
    })
    .filter((item): item is WorkspaceMigrationOrphanedDirectoryRecord => item !== null);

  const legacyAgentDirectories = discoverLegacyAgentDirectories(environment, agentRows);

  for (const company of companies) {
    if (
      orphanedDirectories.some(
        (orphan) => path.resolve(orphan.path) === path.resolve(company.proposedWorkspaceRoot),
      )
    ) {
      company.classification = "manual-review";
      company.collisions.push("proposed_destination_occupied_by_orphaned_directory");
    }
  }

  const summary = {
    companyCount: companies.length,
    safeAutoMigrate: companies.filter((company) => company.classification === "safe-auto-migrate").length,
    manualReview: companies.filter((company) => company.classification === "manual-review").length,
    blocked: companies.filter((company) => company.classification === "blocked").length,
    orphanedDirectoryCount: orphanedDirectories.length,
    legacyAgentDirectoryCount: legacyAgentDirectories.length,
  };

  void projectRows;

  return {
    generatedAt: new Date().toISOString(),
    environment,
    companies,
    orphanedDirectories,
    legacyAgentDirectories,
    summary,
  };
}

export function buildWorkspaceMigrationBackupPlan(options?: {
  db?: OrchestrationDb;
  env?: NodeJS.ProcessEnv;
  inventory?: WorkspaceMigrationInventory;
  includeOrphanedDirectories?: boolean;
  snapshotId?: string;
}): WorkspaceMigrationBackupPlan {
  const db = options?.db ?? getOrchestrationDb();
  const inventory = options?.inventory ?? readWorkspaceMigrationInventory({ db, env: options?.env });
  const companyRows = loadCompanyRows(db);
  const projectRows = loadProjectRows(db);
  const agentRows = loadAgentRows(db);
  const snapshotId =
    options?.snapshotId ??
    `workspace-separation-${inventory.environment.lane}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outputRoot = path.join(inventory.environment.backupRoot, snapshotId);

  const directorySources: WorkspaceMigrationBackupPlan["directorySources"] = inventory.companies
    .filter((company) => !company.isDefaultCompany)
    .map((company) => ({
      sourcePath: company.resolvedCurrentWorkspaceRoot,
      companyId: company.companyId,
      companySlug: company.companySlug,
      exists: company.sourceExists,
      classification: company.classification,
      reasons: [
        ...company.reasons,
        ...company.collisions,
        ...company.unsafeConditions,
      ],
    }));

  if (options?.includeOrphanedDirectories) {
    for (const orphan of inventory.orphanedDirectories) {
      directorySources.push({
        sourcePath: orphan.path,
        companyId: null,
        companySlug: null,
        exists: orphan.summary.exists,
        classification: orphan.classification,
        reasons: orphan.reasons.slice(),
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    snapshotId,
    outputRoot,
    inventory,
    rows: {
      companies: companyRows,
      projects: projectRows,
      agents: agentRows,
    },
    directorySources,
  };
}

export function writeWorkspaceMigrationBackupSnapshot(
  plan: WorkspaceMigrationBackupPlan,
  options?: {
    writeManifest?: boolean;
    copyWorkspaces?: boolean;
  },
): { manifestPath: string; copiedDirectoryCount: number } {
  const manifestPath = path.join(plan.outputRoot, "manifest.json");
  fs.mkdirSync(plan.outputRoot, { recursive: true });
  fs.mkdirSync(path.join(plan.outputRoot, "db"), { recursive: true });
  fs.mkdirSync(path.join(plan.outputRoot, "directories"), { recursive: true });

  fs.writeFileSync(
    path.join(plan.outputRoot, "db", "companies.json"),
    JSON.stringify(plan.rows.companies, null, 2),
  );
  fs.writeFileSync(
    path.join(plan.outputRoot, "db", "projects.json"),
    JSON.stringify(plan.rows.projects, null, 2),
  );
  fs.writeFileSync(
    path.join(plan.outputRoot, "db", "agents.json"),
    JSON.stringify(plan.rows.agents, null, 2),
  );

  let copiedDirectoryCount = 0;
  const copiedSources = new Set<string>();
  if (options?.copyWorkspaces) {
    for (const directorySource of plan.directorySources) {
      const resolvedSource = path.resolve(directorySource.sourcePath);
      if (!directorySource.exists || copiedSources.has(resolvedSource)) {
        continue;
      }
      const summary = summarizeDirectory(resolvedSource);
      if (!summary.exists || summary.kind !== "directory") {
        continue;
      }

      copiedSources.add(resolvedSource);
      const targetName = directorySource.companySlug
        ? `${directorySource.companySlug}-${directorySource.companyId}`
        : path.basename(resolvedSource);
      const targetPath = path.join(plan.outputRoot, "directories", targetName);
      fs.cpSync(resolvedSource, targetPath, {
        recursive: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
      });
      copiedDirectoryCount += 1;
    }
  }

  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: plan.generatedAt,
        snapshotId: plan.snapshotId,
        outputRoot: plan.outputRoot,
        copiedDirectoryCount,
        directorySources: plan.directorySources,
        inventorySummary: plan.inventory.summary,
        environment: plan.inventory.environment,
      },
      null,
      2,
    ),
  );

  return { manifestPath, copiedDirectoryCount };
}

export function verifyWorkspaceMigrationCompatibility(options?: {
  db?: OrchestrationDb;
  env?: NodeJS.ProcessEnv;
}): WorkspaceMigrationVerificationReport {
  const db = options?.db ?? getOrchestrationDb();
  const env = options?.env ?? process.env;
  const environment = buildEnvironment(env);
  const inventory = readWorkspaceMigrationInventory({ db, env });
  const projectRows = loadProjectRows(db);
  const agentRows = loadAgentRows(db);

  const companyResolution = inventory.companies.map((company) => {
    const resolvedPath = resolveWorkspaceBase(company.companySlug);
    const messages: string[] = [];
    let status: WorkspaceMigrationVerificationStatus = "ok";

    if (resolvedPath !== company.resolvedCurrentWorkspaceRoot) {
      status = "blocked";
      messages.push("workspace-resolver returned an unexpected company root");
    }
    if (!company.sourceExists && !company.isDefaultCompany) {
      status = status === "blocked" ? status : "warning";
      messages.push("company workspace directory is missing on disk");
    }

    return {
      companyId: company.companyId,
      companySlug: company.companySlug,
      workspaceId: company.companySlug,
      resolvedPath,
      expectedPath: company.resolvedCurrentWorkspaceRoot,
      status,
      messages,
    };
  });

  const projectResolution = projectRows.map((project) => {
    const companyWorkspaceRoot = resolveCompanyWorkspaceRoot({
      companyId: project.company_id,
      workspaceSlug: project.company_workspace_slug,
      workspaceRoot: project.company_workspace_root,
      workspaceSource: project.company_workspace_source,
      isDefaultCompany: project.company_id === DEFAULT_COMPANY_ID,
      env,
    });
    const expected = resolveCompanyProjectWorkspacePath(companyWorkspaceRoot, {
      slug: project.slug,
      name: project.name,
    });
    const resolvedPath = resolveWorkspaceBase(`project-${project.id}`);
    const messages: string[] = [];
    let status: WorkspaceMigrationVerificationStatus = "ok";

    if (resolvedPath !== expected.path) {
      status = "blocked";
      messages.push("workspace-resolver returned an unexpected project path");
    }
    if (!expected.exists) {
      status = status === "blocked" ? status : "warning";
      messages.push("project workspace directory does not currently exist");
    }

    return {
      projectId: project.id,
      projectSlug: project.slug,
      companySlug: project.company_slug,
      workspaceId: `project-${project.id}`,
      resolvedPath,
      expectedPath: expected.path,
      exists: expected.exists,
      status,
      messages,
    };
  });

  const agentResolution = agentRows.map((agent) => {
    if (!agent.slug?.trim()) {
      return {
        agentId: agent.id,
        agentName: agent.name,
        agentSlug: agent.slug,
        companySlug: agent.company_slug,
        resolvedPath: null,
        source: "missing-slug" as const,
        exists: false,
        status: "warning" as const,
        messages: ["agent row has no slug, so compatibility path resolution cannot be audited"],
      };
    }

    const companyWorkspaceRoot = resolveCompanyWorkspaceRoot({
      companyId: agent.company_id,
      workspaceSlug: agent.company_workspace_slug,
      workspaceRoot: agent.company_workspace_root,
      workspaceSource: agent.company_workspace_source,
      isDefaultCompany: agent.company_id === DEFAULT_COMPANY_ID,
      env,
    });
    const resolved = resolveAgentWorkspacePathWithLegacyFallback(
      companyWorkspaceRoot,
      agent.slug,
      env,
    );
    const messages: string[] = [];
    let status: WorkspaceMigrationVerificationStatus = "ok";

    if (!resolved.exists) {
      status = "warning";
      messages.push("no company-scoped or legacy agent workspace directory exists");
    }

    return {
      agentId: agent.id,
      agentName: agent.name,
      agentSlug: agent.slug,
      companySlug: agent.company_slug,
      resolvedPath: resolved.path,
      source: resolved.source,
      exists: resolved.exists,
      status,
      messages,
    };
  });

  const deletionSafety = inventory.companies.map((company) => {
    const deletion = classifyCompanyWorkspaceRoot(company.resolvedCurrentWorkspaceRoot, env);
    const messages: string[] = [];
    let status: WorkspaceMigrationVerificationStatus = "ok";

    if (company.isDefaultCompany) {
      if (deletion.safeToDelete || deletion.classification !== "default-openclaw-workspace") {
        status = "blocked";
        messages.push("default OpenClaw workspace should remain protected");
      }
    } else if (!deletion.safeToDelete) {
      status = "blocked";
      messages.push("company workspace root failed delete-safety classification");
    }

    return {
      companyId: company.companyId,
      companySlug: company.companySlug,
      workspaceRoot: company.resolvedCurrentWorkspaceRoot,
      classification: deletion.classification,
      safeToDelete: deletion.safeToDelete,
      status,
      messages,
    };
  });

  const legacyCompatibility: WorkspaceMigrationVerificationReport["legacyCompatibility"] = [];
  const defaultWorkspaceResolved = resolveWorkspaceBase("workspace");
  if (defaultWorkspaceResolved === environment.openClawWorkspaceRoot) {
    legacyCompatibility.push({
      check: "workspace alias resolves to default OpenClaw workspace",
      status: "ok",
      message: environment.openClawWorkspaceRoot,
    });
  } else {
    legacyCompatibility.push({
      check: "workspace alias resolves to default OpenClaw workspace",
      status: "blocked",
      message: `expected ${environment.openClawWorkspaceRoot}, received ${defaultWorkspaceResolved ?? "null"}`,
    });
  }

  for (const company of inventory.companies.filter((item) => item.persistedWorkspaceRoot)) {
    legacyCompatibility.push({
      check: `persisted workspace_root preserved for ${company.companySlug}`,
      status:
        company.persistedWorkspaceRoot === company.resolvedCurrentWorkspaceRoot ? "ok" : "blocked",
      message:
        company.persistedWorkspaceRoot === company.resolvedCurrentWorkspaceRoot
          ? company.resolvedCurrentWorkspaceRoot
          : `expected ${company.persistedWorkspaceRoot}, received ${company.resolvedCurrentWorkspaceRoot}`,
    });
  }

  for (const legacyDirectory of inventory.legacyAgentDirectories) {
    const workspaceId = path.basename(legacyDirectory.path);
    const resolved = resolveWorkspaceBase(workspaceId);
    const preferredLegacyWorkspace = resolveLegacyOpenClawAgentWorkspacePath(
      legacyDirectory.agentSlug,
      env,
    );
    const aliasRedirectedToPreferredWorkspace =
      preferredLegacyWorkspace.exists &&
      preferredLegacyWorkspace.path !== legacyDirectory.path &&
      resolved === preferredLegacyWorkspace.path;
    legacyCompatibility.push({
      check: `legacy agent workspace alias ${workspaceId}`,
      status:
        resolved === legacyDirectory.path || aliasRedirectedToPreferredWorkspace ? "ok" : "warning",
      message:
        resolved === legacyDirectory.path
          ? legacyDirectory.path
          : aliasRedirectedToPreferredWorkspace
            ? `redirected to preferred legacy workspace ${preferredLegacyWorkspace.path}`
            : `received ${resolved ?? "null"}`,
    });
  }

  const allStatuses = [
    ...companyResolution.map((item) => item.status),
    ...projectResolution.map((item) => item.status),
    ...agentResolution.map((item) => item.status),
    ...deletionSafety.map((item) => item.status),
    ...legacyCompatibility.map((item) => item.status),
  ];

  return {
    generatedAt: new Date().toISOString(),
    environment,
    companyResolution,
    projectResolution,
    agentResolution,
    deletionSafety,
    legacyCompatibility,
    summary: {
      ok: allStatuses.filter((status) => status === "ok").length,
      warning: allStatuses.filter((status) => status === "warning").length,
      blocked: allStatuses.filter((status) => status === "blocked").length,
    },
  };
}
