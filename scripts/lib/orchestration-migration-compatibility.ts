import Database from "better-sqlite3";

import {
  checkOrchestrationMigrationCompatibility,
  type OrchestrationMigrationCompatibility,
  type OrchestrationMigrationIssue,
} from "@/lib/orchestration/db";

function formatMigrationIssue(issue: OrchestrationMigrationIssue): string {
  const checksum = issue.actualChecksum ? ` actual=${issue.actualChecksum}` : "";
  return `v${issue.version} ${issue.name} (${issue.reason}${checksum})`;
}

export function formatOrchestrationMigrationCompatibility(
  compatibility: OrchestrationMigrationCompatibility,
): string {
  const latest = compatibility.appliedLatestVersion === null
    ? "none"
    : `v${compatibility.appliedLatestVersion} ${compatibility.appliedLatestName ?? "unknown"}`;
  const incompatible = compatibility.incompatible.length > 0
    ? compatibility.incompatible.map(formatMigrationIssue).join(", ")
    : "none";
  return [
    `expected latest v${compatibility.expectedLatestVersion} ${compatibility.expectedLatestName}`,
    `applied latest ${latest}`,
    `incompatible ${incompatible}`,
    `pending ${compatibility.pending.length}`,
    `legacy extra ${compatibility.legacyExtra.length}`,
  ].join("; ");
}

export function assertOrchestrationMigrationCompatible(input: {
  db: Database.Database;
  dbPath: string;
  label: string;
}): void {
  const compatibility = checkOrchestrationMigrationCompatibility(input.db);
  if (compatibility.ok) return;
  throw new Error(
    `Refusing ${input.label} ${input.dbPath}: ${formatOrchestrationMigrationCompatibility(compatibility)}`,
  );
}

export function assertOrchestrationDbPathMigrationCompatible(input: {
  dbPath: string;
  label: string;
}): void {
  const db = new Database(input.dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma("query_only = ON");
    assertOrchestrationMigrationCompatible({
      db,
      dbPath: input.dbPath,
      label: input.label,
    });
  } finally {
    db.close();
  }
}
