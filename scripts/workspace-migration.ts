import fs from "fs";
import path from "path";

import {
  buildWorkspaceMigrationBackupPlan,
  readWorkspaceMigrationInventory,
  verifyWorkspaceMigrationCompatibility,
  writeWorkspaceMigrationBackupSnapshot,
  type WorkspaceMigrationBackupPlan,
  type WorkspaceMigrationInventory,
  type WorkspaceMigrationVerificationReport,
} from "@/lib/workspaces/migration";
import { closeOrchestrationDb } from "@/lib/orchestration/db";

type Command = "inventory" | "dry-run" | "snapshot" | "verify";
type Format = "text" | "json" | "markdown";

type ParsedArgs = {
  command: Command;
  format: Format;
  outputPath: string | null;
  write: boolean;
  copyWorkspaces: boolean;
  includeOrphanedDirectories: boolean;
};

type DryRunPayload = {
  inventory: WorkspaceMigrationInventory;
  snapshot: WorkspaceMigrationBackupPlan;
};

function parseArgs(argv: string[]): ParsedArgs {
  const [firstArg, ...rest] = argv;
  const command = (firstArg ?? "dry-run") as Command;
  if (!["inventory", "dry-run", "snapshot", "verify"].includes(command)) {
    throw new Error(
      "Usage: npx tsx scripts/workspace-migration.ts <inventory|dry-run|snapshot|verify> [--format text|json|markdown] [--output <path>] [--write] [--copy-workspaces] [--include-orphaned-directories]",
    );
  }

  let format: Format = "text";
  let outputPath: string | null = null;
  let write = false;
  let copyWorkspaces = false;
  let includeOrphanedDirectories = false;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--format") {
      const next = rest[index + 1] as Format | undefined;
      if (!next || !["text", "json", "markdown"].includes(next)) {
        throw new Error("--format requires one of: text, json, markdown");
      }
      format = next;
      index += 1;
      continue;
    }
    if (arg === "--output") {
      const next = rest[index + 1];
      if (!next) {
        throw new Error("--output requires a path");
      }
      outputPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--copy-workspaces") {
      copyWorkspaces = true;
      continue;
    }
    if (arg === "--include-orphaned-directories") {
      includeOrphanedDirectories = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    command,
    format,
    outputPath,
    write,
    copyWorkspaces,
    includeOrphanedDirectories,
  };
}

function writeOutput(outputPath: string | null, content: string): void {
  if (!outputPath) {
    process.stdout.write(`${content}\n`);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content);
  process.stdout.write(`[workspace-migration] wrote ${outputPath}\n`);
}

function renderInventoryText(inventory: WorkspaceMigrationInventory): string {
  const lines: string[] = [];
  lines.push("Workspace Migration Inventory");
  lines.push("");
  lines.push(`Generated: ${inventory.generatedAt}`);
  lines.push(`Lane: ${inventory.environment.lane}`);
  lines.push(`DB: ${inventory.environment.orchestrationDbPath}`);
  lines.push(`MC_WORKSPACE_ROOT: ${inventory.environment.hiveRunnerWorkspaceRoot}`);
  lines.push(`OPENCLAW_DIR: ${inventory.environment.openClawDir}`);
  lines.push("");
  lines.push(
    `Summary: companies=${inventory.summary.companyCount}, safe=${inventory.summary.safeAutoMigrate}, manual=${inventory.summary.manualReview}, blocked=${inventory.summary.blocked}, orphaned=${inventory.summary.orphanedDirectoryCount}, legacyAgents=${inventory.summary.legacyAgentDirectoryCount}`,
  );
  lines.push("");
  lines.push("Companies:");
  for (const company of inventory.companies) {
    lines.push(
      `- ${company.companySlug} (${company.companyId}) -> ${company.classification}`,
    );
    lines.push(`  workspace_slug: ${company.workspaceSlug}`);
    lines.push(`  current: ${company.resolvedCurrentWorkspaceRoot}`);
    lines.push(`  proposed: ${company.proposedWorkspaceRoot}`);
    lines.push(`  canonical: ${company.plannedWorkspaceRoot}`);
    lines.push(
      `  exists: source=${company.sourceExists ? "yes" : "no"}, destination=${company.destinationExists ? "yes" : "no"}`,
    );
    lines.push(
      `  source: ${company.sourceLocationKind}, workspace_source=${company.workspaceSource ?? "null"}, mode=${company.resolutionMode}`,
    );
    if (company.reasons.length > 0) {
      lines.push(`  reasons: ${company.reasons.join(", ")}`);
    }
    if (company.collisions.length > 0) {
      lines.push(`  collisions: ${company.collisions.join(", ")}`);
    }
    if (company.unsafeConditions.length > 0) {
      lines.push(`  unsafe: ${company.unsafeConditions.join(", ")}`);
    }
  }

  if (inventory.orphanedDirectories.length > 0) {
    lines.push("");
    lines.push("Orphaned directories:");
    for (const orphan of inventory.orphanedDirectories) {
      lines.push(`- ${orphan.path} -> ${orphan.classification} (${orphan.reasons.join(", ")})`);
    }
  }

  if (inventory.legacyAgentDirectories.length > 0) {
    lines.push("");
    lines.push("Legacy agent directories:");
    for (const legacy of inventory.legacyAgentDirectories) {
      lines.push(
        `- ${legacy.path} -> ${legacy.classification} (${legacy.reasons.join(", ") || "matched"})`,
      );
    }
  }

  return lines.join("\n");
}

function renderInventoryMarkdown(inventory: WorkspaceMigrationInventory): string {
  const lines: string[] = [];
  lines.push("# Workspace Migration Inventory");
  lines.push("");
  lines.push(`- Generated: ${inventory.generatedAt}`);
  lines.push(`- Lane: ${inventory.environment.lane}`);
  lines.push(`- DB: \`${inventory.environment.orchestrationDbPath}\``);
  lines.push(`- MC workspace root: \`${inventory.environment.hiveRunnerWorkspaceRoot}\``);
  lines.push(`- OpenClaw dir: \`${inventory.environment.openClawDir}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Companies: ${inventory.summary.companyCount}`);
  lines.push(`- Safe auto-migrate: ${inventory.summary.safeAutoMigrate}`);
  lines.push(`- Manual review: ${inventory.summary.manualReview}`);
  lines.push(`- Blocked: ${inventory.summary.blocked}`);
  lines.push(`- Orphaned directories: ${inventory.summary.orphanedDirectoryCount}`);
  lines.push(`- Legacy agent directories: ${inventory.summary.legacyAgentDirectoryCount}`);
  lines.push("");
  lines.push("## Companies");
  lines.push("");
  lines.push("| Company | Classification | Current workspace_root | Proposed destination | Source exists | Destination exists | Notes |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const company of inventory.companies) {
    const notes = [...company.reasons, ...company.collisions, ...company.unsafeConditions].join(", ");
    lines.push(
      `| ${company.companySlug} | ${company.classification} | \`${company.resolvedCurrentWorkspaceRoot}\` | \`${company.proposedWorkspaceRoot}\` | ${company.sourceExists ? "yes" : "no"} | ${company.destinationExists ? "yes" : "no"} | ${notes || "none"} |`,
    );
  }

  lines.push("");
  lines.push("## Orphaned Directories");
  lines.push("");
  if (inventory.orphanedDirectories.length === 0) {
    lines.push("- None");
  } else {
    for (const orphan of inventory.orphanedDirectories) {
      lines.push(`- \`${orphan.path}\``);
      lines.push(`  classification: ${orphan.classification}`);
      lines.push(`  reasons: ${orphan.reasons.join(", ")}`);
    }
  }

  lines.push("");
  lines.push("## Legacy Agent Directories");
  lines.push("");
  if (inventory.legacyAgentDirectories.length === 0) {
    lines.push("- None");
  } else {
    for (const legacy of inventory.legacyAgentDirectories) {
      lines.push(`- \`${legacy.path}\``);
      lines.push(`  classification: ${legacy.classification}`);
      lines.push(
        `  reasons: ${legacy.reasons.length > 0 ? legacy.reasons.join(", ") : "matched agent row"}`,
      );
    }
  }

  return lines.join("\n");
}

function renderDryRunText(payload: DryRunPayload): string {
  const inventoryText = renderInventoryText(payload.inventory);
  const snapshotText = renderSnapshotText(payload.snapshot, false);
  return `${inventoryText}\n\n${snapshotText}`;
}

function renderDryRunMarkdown(payload: DryRunPayload): string {
  const inventory = payload.inventory;
  const lines: string[] = [];
  lines.push("# Workspace Migration Dry Run");
  lines.push("");
  lines.push(`- Generated: ${inventory.generatedAt}`);
  lines.push(`- Mode: dry-run only`);
  lines.push(`- Snapshot output root: \`${payload.snapshot.outputRoot}\``);
  lines.push(`- Snapshot DB rows: companies=${payload.snapshot.rows.companies.length}, projects=${payload.snapshot.rows.projects.length}, agents=${payload.snapshot.rows.agents.length}`);
  lines.push(`- Snapshot directory sources: ${payload.snapshot.directorySources.length}`);
  lines.push(`- Lane: ${inventory.environment.lane}`);
  lines.push(`- DB: \`${inventory.environment.orchestrationDbPath}\``);
  lines.push(`- MC workspace root: \`${inventory.environment.hiveRunnerWorkspaceRoot}\``);
  lines.push(`- OpenClaw dir: \`${inventory.environment.openClawDir}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Companies: ${inventory.summary.companyCount}`);
  lines.push(`- Safe auto-migrate: ${inventory.summary.safeAutoMigrate}`);
  lines.push(`- Manual review: ${inventory.summary.manualReview}`);
  lines.push(`- Blocked: ${inventory.summary.blocked}`);
  lines.push(`- Orphaned directories: ${inventory.summary.orphanedDirectoryCount}`);
  lines.push(`- Legacy agent directories: ${inventory.summary.legacyAgentDirectoryCount}`);
  lines.push("");
  lines.push("## Companies");
  lines.push("");
  lines.push("| Company | Classification | Current workspace_root | Proposed destination | Source exists | Destination exists | Notes |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const company of inventory.companies) {
    const notes = [...company.reasons, ...company.collisions, ...company.unsafeConditions].join(", ");
    lines.push(
      `| ${company.companySlug} | ${company.classification} | \`${company.resolvedCurrentWorkspaceRoot}\` | \`${company.proposedWorkspaceRoot}\` | ${company.sourceExists ? "yes" : "no"} | ${company.destinationExists ? "yes" : "no"} | ${notes || "none"} |`,
    );
  }
  lines.push("");
  lines.push("## Orphaned Directories");
  lines.push("");
  if (inventory.orphanedDirectories.length === 0) {
    lines.push("- None");
  } else {
    for (const orphan of inventory.orphanedDirectories) {
      lines.push(`- \`${orphan.path}\``);
      lines.push(`  classification: ${orphan.classification}`);
      lines.push(`  reasons: ${orphan.reasons.join(", ")}`);
    }
  }
  lines.push("");
  lines.push("## Legacy Agent Directories");
  lines.push("");
  if (inventory.legacyAgentDirectories.length === 0) {
    lines.push("- None");
  } else {
    for (const legacy of inventory.legacyAgentDirectories) {
      lines.push(`- \`${legacy.path}\``);
      lines.push(`  classification: ${legacy.classification}`);
      lines.push(
        `  reasons: ${legacy.reasons.length > 0 ? legacy.reasons.join(", ") : "matched agent row"}`,
      );
    }
  }
  lines.push("");
  lines.push("## Snapshot Preflight");
  lines.push("");
  for (const directorySource of payload.snapshot.directorySources) {
    lines.push(`- \`${directorySource.sourcePath}\``);
    lines.push(`  company: ${directorySource.companySlug ?? "(orphan)"}`);
    lines.push(`  exists: ${directorySource.exists ? "yes" : "no"}`);
    lines.push(`  classification: ${directorySource.classification}`);
    lines.push(`  reasons: ${directorySource.reasons.join(", ") || "none"}`);
  }
  return lines.join("\n");
}

function renderSnapshotText(plan: WorkspaceMigrationBackupPlan, willWrite: boolean): string {
  const lines: string[] = [];
  lines.push("Workspace Migration Snapshot Plan");
  lines.push("");
  lines.push(`Generated: ${plan.generatedAt}`);
  lines.push(`Snapshot ID: ${plan.snapshotId}`);
  lines.push(`Output root: ${plan.outputRoot}`);
  lines.push(`Mode: ${willWrite ? "write" : "dry-run"}`);
  lines.push(
    `Rows: companies=${plan.rows.companies.length}, projects=${plan.rows.projects.length}, agents=${plan.rows.agents.length}`,
  );
  lines.push(`Directory sources: ${plan.directorySources.length}`);
  lines.push("");
  for (const directorySource of plan.directorySources) {
    lines.push(
      `- ${directorySource.sourcePath} -> ${directorySource.classification} (${directorySource.exists ? "exists" : "missing"})`,
    );
    if (directorySource.reasons.length > 0) {
      lines.push(`  reasons: ${directorySource.reasons.join(", ")}`);
    }
  }
  return lines.join("\n");
}

function renderSnapshotMarkdown(plan: WorkspaceMigrationBackupPlan, willWrite: boolean): string {
  const lines: string[] = [];
  lines.push("# Workspace Migration Snapshot Plan");
  lines.push("");
  lines.push(`- Generated: ${plan.generatedAt}`);
  lines.push(`- Snapshot ID: \`${plan.snapshotId}\``);
  lines.push(`- Output root: \`${plan.outputRoot}\``);
  lines.push(`- Mode: ${willWrite ? "write" : "dry-run"}`);
  lines.push(`- Company rows: ${plan.rows.companies.length}`);
  lines.push(`- Project rows: ${plan.rows.projects.length}`);
  lines.push(`- Agent rows: ${plan.rows.agents.length}`);
  lines.push(`- Directory sources: ${plan.directorySources.length}`);
  lines.push("");
  lines.push("| Source path | Company | Exists | Classification | Reasons |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const directorySource of plan.directorySources) {
    lines.push(
      `| \`${directorySource.sourcePath}\` | ${directorySource.companySlug ?? "(orphan)"} | ${directorySource.exists ? "yes" : "no"} | ${directorySource.classification} | ${directorySource.reasons.join(", ") || "none"} |`,
    );
  }
  return lines.join("\n");
}

function renderVerificationText(report: WorkspaceMigrationVerificationReport): string {
  const lines: string[] = [];
  lines.push("Workspace Migration Verification");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Lane: ${report.environment.lane}`);
  lines.push(`Summary: ok=${report.summary.ok}, warning=${report.summary.warning}, blocked=${report.summary.blocked}`);
  lines.push("");
  lines.push("Warnings and blocked items:");

  const sections = [
    ...report.companyResolution.map((item) => ({
      label: `company ${item.companySlug}`,
      status: item.status,
      messages: item.messages,
    })),
    ...report.projectResolution.map((item) => ({
      label: `project ${item.projectSlug}`,
      status: item.status,
      messages: item.messages,
    })),
    ...report.agentResolution.map((item) => ({
      label: `agent ${item.agentName}`,
      status: item.status,
      messages: item.messages,
    })),
    ...report.deletionSafety.map((item) => ({
      label: `delete-safety ${item.companySlug}`,
      status: item.status,
      messages: item.messages,
    })),
    ...report.legacyCompatibility.map((item) => ({
      label: item.check,
      status: item.status,
      messages: [item.message],
    })),
  ].filter((item) => item.status !== "ok");

  if (sections.length === 0) {
    lines.push("- none");
  } else {
    for (const item of sections) {
      lines.push(`- ${item.label} -> ${item.status}: ${item.messages.join("; ")}`);
    }
  }

  return lines.join("\n");
}

function renderVerificationMarkdown(report: WorkspaceMigrationVerificationReport): string {
  const lines: string[] = [];
  lines.push("# Workspace Migration Verification");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Lane: ${report.environment.lane}`);
  lines.push(`- Ok: ${report.summary.ok}`);
  lines.push(`- Warning: ${report.summary.warning}`);
  lines.push(`- Blocked: ${report.summary.blocked}`);
  lines.push("");
  lines.push("## Non-OK Checks");
  lines.push("");

  const items = [
    ...report.companyResolution.map((item) => ({
      label: `company ${item.companySlug}`,
      status: item.status,
      messages: item.messages,
    })),
    ...report.projectResolution.map((item) => ({
      label: `project ${item.projectSlug}`,
      status: item.status,
      messages: item.messages,
    })),
    ...report.agentResolution.map((item) => ({
      label: `agent ${item.agentName}`,
      status: item.status,
      messages: item.messages,
    })),
    ...report.deletionSafety.map((item) => ({
      label: `delete-safety ${item.companySlug}`,
      status: item.status,
      messages: item.messages,
    })),
    ...report.legacyCompatibility.map((item) => ({
      label: item.check,
      status: item.status,
      messages: [item.message],
    })),
  ].filter((item) => item.status !== "ok");

  if (items.length === 0) {
    lines.push("- None");
  } else {
    for (const item of items) {
      lines.push(`- ${item.label}: ${item.status}`);
      lines.push(`  details: ${item.messages.join("; ")}`);
    }
  }

  return lines.join("\n");
}

function render(command: Command, format: Format, payload: unknown, write = false): string {
  if (format === "json") {
    return JSON.stringify(payload, null, 2);
  }

  if (command === "dry-run") {
    const dryRunPayload = payload as DryRunPayload;
    return format === "markdown"
      ? renderDryRunMarkdown(dryRunPayload)
      : renderDryRunText(dryRunPayload);
  }

  if (command === "inventory") {
    const inventory = payload as WorkspaceMigrationInventory;
    return format === "markdown"
      ? renderInventoryMarkdown(inventory)
      : renderInventoryText(inventory);
  }

  if (command === "snapshot") {
    const plan = payload as WorkspaceMigrationBackupPlan;
    return format === "markdown"
      ? renderSnapshotMarkdown(plan, write)
      : renderSnapshotText(plan, write);
  }

  const report = payload as WorkspaceMigrationVerificationReport;
  return format === "markdown"
    ? renderVerificationMarkdown(report)
    : renderVerificationText(report);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "inventory" || args.command === "dry-run") {
    const inventory = readWorkspaceMigrationInventory();
    if (args.command === "inventory") {
      writeOutput(args.outputPath, render(args.command, args.format, inventory));
      return;
    }
    const snapshot = buildWorkspaceMigrationBackupPlan({ inventory });
    writeOutput(
      args.outputPath,
      render(args.command, args.format, {
        inventory,
        snapshot,
      } satisfies DryRunPayload),
    );
    return;
  }

  if (args.command === "snapshot") {
    const plan = buildWorkspaceMigrationBackupPlan({
      includeOrphanedDirectories: args.includeOrphanedDirectories,
    });
    if (args.write) {
      const result = writeWorkspaceMigrationBackupSnapshot(plan, {
        writeManifest: true,
        copyWorkspaces: args.copyWorkspaces,
      });
      process.stdout.write(
        `[workspace-migration] snapshot manifest ${result.manifestPath} copiedDirectories=${result.copiedDirectoryCount}\n`,
      );
    }
    writeOutput(args.outputPath, render(args.command, args.format, plan, args.write));
    return;
  }

  const report = verifyWorkspaceMigrationCompatibility();
  writeOutput(args.outputPath, render(args.command, args.format, report));
}

try {
  main();
} finally {
  closeOrchestrationDb();
}
