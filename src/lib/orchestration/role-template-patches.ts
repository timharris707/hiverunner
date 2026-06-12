import { createHash, randomUUID } from "crypto";

import type Database from "better-sqlite3";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { OrchestrationApiError } from "@/lib/orchestration/api";
import {
  resolveOnboardingAssetBucket,
  type OnboardingBucket,
} from "@/lib/orchestration/engine/onboarding-bucket";
import { recordImproveActivity } from "@/lib/orchestration/service/improvement-provenance";

/**
 * H4 — Improve → template compounding.
 *
 * Approved improvement recommendations stop being a terminus: agent-scoped
 * recommendations resolve to the originating role's onboarding-asset bucket
 * and land as additive playbook patches that prompt assembly appends to the
 * bucket's assets at load time (loadOnboardingAssets). Base assets in source
 * control stay immutable — a patch is data with an audit trail (row +
 * approval_id + improve activity event), a rollback path (status flip), and
 * dedupe (unique active content hash per company/bucket/file).
 *
 * Scope note: only `agent`-scoped recommendations auto-apply today (the live
 * slow_expensive_run trigger is agent-scoped). Other scopes keep the
 * pre-H4 behavior — approved but not auto-applied — and are reported as
 * `skipped` so callers can see exactly what the engine declined to touch.
 */

const VALID_TARGET_FILES = new Set(["AGENTS.md", "HEARTBEAT.md", "SOUL.md"]);
const PATCH_SECTION_HEADING = "## Learned Playbook Updates (operator-approved via Improve)";

export type RoleTemplatePatchRow = {
  id: string;
  company_id: string;
  role_bucket: OnboardingBucket;
  target_file: string;
  recommendation_id: string | null;
  approval_id: string | null;
  title: string;
  content: string;
  content_hash: string;
  status: "active" | "rolled_back";
  applied_by_user_id: string | null;
  rolled_back_at: string | null;
  rolled_back_by_user_id: string | null;
  rollback_reason: string | null;
  created_at: string;
  updated_at: string;
};

export function hashPatchContent(content: string): string {
  return createHash("sha256").update(content.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex");
}

export function listRoleTemplatePatches(
  db: Database.Database,
  input: { companyId: string; bucket?: OnboardingBucket; includeRolledBack?: boolean },
): RoleTemplatePatchRow[] {
  const clauses = ["company_id = ?"];
  const params: unknown[] = [input.companyId];
  if (input.bucket) {
    clauses.push("role_bucket = ?");
    params.push(input.bucket);
  }
  if (!input.includeRolledBack) {
    clauses.push("status = 'active'");
  }
  return db
    .prepare(
      `SELECT * FROM role_template_patches
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at ASC, id ASC`,
    )
    .all(...params) as RoleTemplatePatchRow[];
}

/**
 * Render active patches as a markdown block appended to a bucket asset file.
 * Returns null when no active patches target the file.
 */
export function buildRoleTemplatePatchBlock(
  db: Database.Database,
  input: { companyId: string; bucket: OnboardingBucket; targetFile: string },
): string | null {
  const patches = listRoleTemplatePatches(db, {
    companyId: input.companyId,
    bucket: input.bucket,
  }).filter((patch) => patch.target_file === input.targetFile);
  if (patches.length === 0) return null;

  const blocks = patches.map((patch) => {
    const provenance = `_(Improve recommendation ${patch.recommendation_id?.slice(0, 8) ?? "?"}, approved ${patch.created_at.slice(0, 10)})_`;
    return `### ${patch.title}\n${patch.content}\n${provenance}`;
  });
  return ["", "---", PATCH_SECTION_HEADING, "These rules were learned from real run evidence and approved by the operator. Treat them with the same weight as the playbook above.", ...blocks].join("\n\n");
}

type ApplyOutcome =
  | { recommendationId: string; outcome: "applied"; patchId: string; bucket: OnboardingBucket }
  | { recommendationId: string; outcome: "applied_duplicate"; existingPatchId: string; bucket: OnboardingBucket }
  | { recommendationId: string; outcome: "skipped"; reason: string };

type RecommendationRow = {
  id: string;
  company_id: string;
  scope_type: string;
  scope_key: string;
  title: string;
  rationale: string;
  proposed_change: string;
  severity: string;
  confidence: string;
  status: string;
  current_recommendation_json: string;
  trigger_key: string;
};

function resolveBucketForRecommendation(
  db: Database.Database,
  row: RecommendationRow,
): { bucket: OnboardingBucket; agentId: string } | { skipReason: string } {
  if (row.scope_type !== "agent") {
    return { skipReason: `scope_type_${row.scope_type}_not_auto_applied` };
  }
  const agent = db
    .prepare("SELECT id, role, company_id FROM agents WHERE id = ? AND company_id = ? LIMIT 1")
    .get(row.scope_key, row.company_id) as { id: string; role: string; company_id: string } | undefined;
  if (!agent) {
    return { skipReason: "scope_agent_not_found" };
  }
  return {
    bucket: resolveOnboardingAssetBucket(agent.role, {
      db,
      companyId: agent.company_id,
      agentId: agent.id,
    }),
    agentId: agent.id,
  };
}

function patchContentForRecommendation(row: RecommendationRow): string | null {
  const proposed = row.proposed_change?.trim();
  if (proposed) return proposed;
  const rationale = row.rationale?.trim();
  return rationale || null;
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function resolveProjectForActivity(db: Database.Database, companyId: string, agentId: string | null): string | null {
  if (agentId) {
    const agent = db
      .prepare("SELECT project_id FROM agents WHERE id = ? AND company_id = ? LIMIT 1")
      .get(agentId, companyId) as { project_id: string | null } | undefined;
    if (agent?.project_id) return agent.project_id;
  }
  const fallback = db
    .prepare(
      `SELECT id FROM projects
       WHERE company_id = ? AND archived_at IS NULL
       ORDER BY created_at ASC, id ASC LIMIT 1`,
    )
    .get(companyId) as { id: string } | undefined;
  return fallback?.id ?? null;
}

/**
 * Apply every recommendation linked to an approved Improve approval package.
 * Idempotent: re-running dedupes on content hash and skips already-applied
 * recommendations. Never throws for per-recommendation problems — returns
 * the outcome list so callers can log/inspect.
 */
export function applyTemplatePatchesForApprovedRecommendations(input: {
  approvalId: string;
  actorUserId?: string | null;
  db?: Database.Database;
}): ApplyOutcome[] {
  const db = input.db ?? getOrchestrationDb();
  const now = new Date().toISOString();

  const rows = db
    .prepare(
      `SELECT r.id, r.company_id, r.scope_type, r.scope_key, r.title, r.rationale,
              r.proposed_change, r.severity, r.confidence, r.status,
              r.current_recommendation_json, r.trigger_key
       FROM improvement_recommendation_approval_links l
       INNER JOIN improvement_recommendations r ON r.id = l.recommendation_id
       WHERE l.approval_id = ?`,
    )
    .all(input.approvalId) as RecommendationRow[];

  const outcomes: ApplyOutcome[] = [];

  for (const row of rows) {
    if (row.status === "applied") {
      outcomes.push({ recommendationId: row.id, outcome: "skipped", reason: "already_applied" });
      continue;
    }
    if (["dismissed", "superseded"].includes(row.status)) {
      outcomes.push({ recommendationId: row.id, outcome: "skipped", reason: `status_${row.status}` });
      continue;
    }

    const resolved = resolveBucketForRecommendation(db, row);
    if ("skipReason" in resolved) {
      outcomes.push({ recommendationId: row.id, outcome: "skipped", reason: resolved.skipReason });
      continue;
    }

    const content = patchContentForRecommendation(row);
    if (!content) {
      outcomes.push({ recommendationId: row.id, outcome: "skipped", reason: "empty_proposed_change" });
      continue;
    }

    const targetFile = "AGENTS.md";
    const contentHash = hashPatchContent(content);
    const existing = db
      .prepare(
        `SELECT id FROM role_template_patches
         WHERE company_id = ? AND role_bucket = ? AND target_file = ?
           AND content_hash = ? AND status = 'active'
         LIMIT 1`,
      )
      .get(row.company_id, resolved.bucket, targetFile, contentHash) as { id: string } | undefined;

    const markApplied = (patchId: string, duplicateOfPatchId?: string) => {
      const current = {
        ...parseJsonObject(row.current_recommendation_json),
        appliedAt: now,
        appliedPatchId: patchId,
        appliedBucket: resolved.bucket,
        appliedTargetFile: targetFile,
        ...(duplicateOfPatchId ? { appliedAsDuplicateOf: duplicateOfPatchId } : {}),
      };
      db.prepare(
        `UPDATE improvement_recommendations
         SET status = 'applied', current_recommendation_json = ?, updated_at = ?
         WHERE id = ?`,
      ).run(JSON.stringify(current), now, row.id);
    };

    if (existing) {
      markApplied(existing.id, existing.id);
      outcomes.push({
        recommendationId: row.id,
        outcome: "applied_duplicate",
        existingPatchId: existing.id,
        bucket: resolved.bucket,
      });
    } else {
      const patchId = randomUUID();
      db.prepare(
        `INSERT INTO role_template_patches
           (id, company_id, role_bucket, target_file, recommendation_id, approval_id,
            title, content, content_hash, status, applied_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      ).run(
        patchId,
        row.company_id,
        resolved.bucket,
        targetFile,
        row.id,
        input.approvalId,
        row.title,
        content,
        contentHash,
        input.actorUserId ?? null,
        now,
        now,
      );
      markApplied(patchId);
      outcomes.push({ recommendationId: row.id, outcome: "applied", patchId, bucket: resolved.bucket });
    }

    try {
      const company = db
        .prepare("SELECT company_code FROM companies WHERE id = ? LIMIT 1")
        .get(row.company_id) as { company_code: string | null } | undefined;
      const projectId = resolveProjectForActivity(db, row.company_id, resolved.agentId);
      if (projectId) {
        recordImproveActivity({
          companyId: row.company_id,
          companyCode: company?.company_code ?? null,
          eventType: "improve.recommendation_applied",
          actorUserId: input.actorUserId ?? null,
          source: {
            recommendationId: row.id,
            recommendationStatus: "applied",
            recommendationType: row.trigger_key,
            severity: row.severity,
            projectId,
            agentId: resolved.agentId,
            approvalId: input.approvalId,
            summary: `Template patch (${resolved.bucket}/${targetFile}): ${row.title}`,
          },
        }, db);
      }
    } catch {
      // Activity logging is advisory; the patch + status update already landed.
    }
  }

  return outcomes;
}

export function rollbackRoleTemplatePatch(input: {
  companyId: string;
  patchId: string;
  reason?: string | null;
  actorUserId?: string | null;
  db?: Database.Database;
}): RoleTemplatePatchRow {
  const db = input.db ?? getOrchestrationDb();
  const row = db
    .prepare("SELECT * FROM role_template_patches WHERE id = ? AND company_id = ? LIMIT 1")
    .get(input.patchId, input.companyId) as RoleTemplatePatchRow | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "template_patch_not_found", "Role template patch not found");
  }
  if (row.status === "rolled_back") {
    return row;
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE role_template_patches
     SET status = 'rolled_back', rolled_back_at = ?, rolled_back_by_user_id = ?,
         rollback_reason = ?, updated_at = ?
     WHERE id = ?`,
  ).run(now, input.actorUserId ?? null, input.reason?.trim() || null, now, input.patchId);

  if (row.recommendation_id) {
    const rec = db
      .prepare("SELECT current_recommendation_json FROM improvement_recommendations WHERE id = ? LIMIT 1")
      .get(row.recommendation_id) as { current_recommendation_json: string } | undefined;
    if (rec) {
      const current = {
        ...parseJsonObject(rec.current_recommendation_json),
        patchRolledBackAt: now,
        patchRollbackReason: input.reason?.trim() || null,
      };
      db.prepare(
        "UPDATE improvement_recommendations SET current_recommendation_json = ?, updated_at = ? WHERE id = ?",
      ).run(JSON.stringify(current), now, row.recommendation_id);
    }
  }

  return db
    .prepare("SELECT * FROM role_template_patches WHERE id = ? LIMIT 1")
    .get(input.patchId) as RoleTemplatePatchRow;
}

export function isValidPatchTargetFile(file: string): boolean {
  return VALID_TARGET_FILES.has(file);
}
