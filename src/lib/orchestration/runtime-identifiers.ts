import { createHash } from "crypto";

import type Database from "better-sqlite3";

const DEFAULT_COMPANY_RUNTIME_SLUG_MAX = 80;
const DEFAULT_AGENT_RUNTIME_SLUG_MAX = 80;
export const OPENCLAW_RUNTIME_ID_MAX_LENGTH = 120;
const OPENCLAW_RUNTIME_HASH_LENGTHS = [8, 12, 16] as const;
const OPENCLAW_RUNTIME_PREFIX = "mc";
const MIN_SEGMENT_LENGTH = 12;

function normalizeRuntimeSlug(
  value: string,
  input?: {
    fallback?: string;
    maxLength?: number;
  },
): string {
  const fallback = input?.fallback ?? "runtime";
  const maxLength = Math.max(8, input?.maxLength ?? DEFAULT_AGENT_RUNTIME_SLUG_MAX);
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return normalized || fallback;
}

function ensureUniqueSlug(
  db: Database.Database,
  query: string,
  paramsFor: (candidate: string) => unknown[],
  desired: string,
  maxLength: number,
): string {
  const base = desired || "runtime";
  let candidate = base;
  let n = 2;
  const stmt = db.prepare(query);

  while (stmt.get(...paramsFor(candidate))) {
    const suffix = `-${n}`;
    candidate = `${base.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`;
    n += 1;
  }

  return candidate;
}

export function normalizeCompanyRuntimeSlug(value: string): string {
  return normalizeRuntimeSlug(value, {
    fallback: "company",
    maxLength: DEFAULT_COMPANY_RUNTIME_SLUG_MAX,
  });
}

export function normalizeAgentRuntimeSlug(value: string): string {
  return normalizeRuntimeSlug(value, {
    fallback: "agent",
    maxLength: DEFAULT_AGENT_RUNTIME_SLUG_MAX,
  });
}

export function ensureUniqueCompanyRuntimeSlug(
  db: Database.Database,
  desiredValue: string,
  input?: {
    excludeCompanyId?: string;
  },
): string {
  const desired = normalizeCompanyRuntimeSlug(desiredValue);
  const excludeCompanyId = input?.excludeCompanyId ?? null;
  const query = excludeCompanyId
    ? `SELECT 1
       FROM companies
       WHERE runtime_slug = ?
         AND id != ?
       LIMIT 1`
    : `SELECT 1
       FROM companies
       WHERE runtime_slug = ?
       LIMIT 1`;

  return ensureUniqueSlug(
    db,
    query,
    (candidate) => (excludeCompanyId ? [candidate, excludeCompanyId] : [candidate]),
    desired,
    DEFAULT_COMPANY_RUNTIME_SLUG_MAX,
  );
}

export function ensureUniqueAgentRuntimeSlug(
  db: Database.Database,
  companyId: string,
  desiredValue: string,
  input?: {
    excludeAgentId?: string;
  },
): string {
  const desired = normalizeAgentRuntimeSlug(desiredValue);
  const excludeAgentId = input?.excludeAgentId ?? null;
  const query = excludeAgentId
    ? `SELECT 1
       FROM agents
       WHERE company_id = ?
         AND runtime_slug = ?
         AND id != ?
       LIMIT 1`
    : `SELECT 1
       FROM agents
       WHERE company_id = ?
         AND runtime_slug = ?
       LIMIT 1`;

  return ensureUniqueSlug(
    db,
    query,
    (candidate) => (excludeAgentId ? [companyId, candidate, excludeAgentId] : [companyId, candidate]),
    desired,
    DEFAULT_AGENT_RUNTIME_SLUG_MAX,
  );
}

function runtimeHash(input: string, length: number): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

function truncateSegment(value: string, length: number, fallback: string): string {
  const trimmed = value.slice(0, Math.max(1, length)).replace(/-+$/g, "");
  return trimmed || fallback;
}

function allocateSegmentBudgets(companySlug: string, agentSlug: string, total: number): {
  companyBudget: number;
  agentBudget: number;
} {
  const companyWeight = Math.max(companySlug.length, 1);
  const agentWeight = Math.max(agentSlug.length, 1);
  const sum = companyWeight + agentWeight;

  let companyBudget = Math.max(
    MIN_SEGMENT_LENGTH,
    Math.floor((total * companyWeight) / sum),
  );
  let agentBudget = Math.max(MIN_SEGMENT_LENGTH, total - companyBudget);

  if (companyBudget + agentBudget > total) {
    if (companyBudget >= agentBudget) {
      companyBudget = total - agentBudget;
    } else {
      agentBudget = total - companyBudget;
    }
  }

  if (companyBudget < MIN_SEGMENT_LENGTH) {
    companyBudget = MIN_SEGMENT_LENGTH;
    agentBudget = total - companyBudget;
  }
  if (agentBudget < MIN_SEGMENT_LENGTH) {
    agentBudget = MIN_SEGMENT_LENGTH;
    companyBudget = total - agentBudget;
  }

  return { companyBudget, agentBudget };
}

function buildOpenClawRuntimeIdWithHash(
  companyRuntimeSlug: string,
  agentRuntimeSlug: string,
  hash: string,
): string {
  const reserved =
    `${OPENCLAW_RUNTIME_PREFIX}---${hash}`.length;
  const segmentBudget = OPENCLAW_RUNTIME_ID_MAX_LENGTH - reserved;
  const { companyBudget, agentBudget } = allocateSegmentBudgets(
    companyRuntimeSlug,
    agentRuntimeSlug,
    segmentBudget,
  );

  return [
    OPENCLAW_RUNTIME_PREFIX,
    truncateSegment(companyRuntimeSlug, companyBudget, "company"),
    truncateSegment(agentRuntimeSlug, agentBudget, "agent"),
    hash,
  ].join("-");
}

function isOpenClawRuntimeIdTaken(
  db: Database.Database,
  openclawRuntimeId: string,
  input?: {
    excludeAgentId?: string;
  },
): boolean {
  const excludeAgentId = input?.excludeAgentId ?? null;
  const query = excludeAgentId
    ? `SELECT id
       FROM agents
       WHERE openclaw_agent_id = ?
         AND id != ?
       LIMIT 1`
    : `SELECT id
       FROM agents
       WHERE openclaw_agent_id = ?
       LIMIT 1`;

  const row = excludeAgentId
    ? db.prepare(query).get(openclawRuntimeId, excludeAgentId)
    : db.prepare(query).get(openclawRuntimeId);
  return Boolean(row);
}

export function buildOpenClawRuntimeId(input: {
  companyId: string;
  companyRuntimeSlug: string;
  agentId: string;
  agentRuntimeSlug: string;
  db?: Database.Database;
  excludeAgentId?: string;
}): string {
  const companyRuntimeSlug = normalizeCompanyRuntimeSlug(input.companyRuntimeSlug);
  const agentRuntimeSlug = normalizeAgentRuntimeSlug(input.agentRuntimeSlug);
  const base = [OPENCLAW_RUNTIME_PREFIX, companyRuntimeSlug, agentRuntimeSlug].join("-");

  if (
    base.length <= OPENCLAW_RUNTIME_ID_MAX_LENGTH &&
    (!input.db || !isOpenClawRuntimeIdTaken(input.db, base, { excludeAgentId: input.excludeAgentId }))
  ) {
    return base;
  }

  const hashInput = `${input.companyId}:${input.agentId}:${companyRuntimeSlug}:${agentRuntimeSlug}`;

  for (const hashLength of OPENCLAW_RUNTIME_HASH_LENGTHS) {
    const hash = runtimeHash(hashInput, hashLength);
    const hashed = buildOpenClawRuntimeIdWithHash(companyRuntimeSlug, agentRuntimeSlug, hash);

    if (hashed.length > OPENCLAW_RUNTIME_ID_MAX_LENGTH) {
      throw new Error(`OpenClaw runtime id exceeds ${OPENCLAW_RUNTIME_ID_MAX_LENGTH} characters after truncation.`);
    }

    if (!input.db || !isOpenClawRuntimeIdTaken(input.db, hashed, { excludeAgentId: input.excludeAgentId })) {
      return hashed;
    }
  }

  throw new Error(`OpenClaw runtime id collision after deterministic hash fallback for ${base}`);
}

export function resolveProvisionedOpenClawAgentId(
  output: string,
  requestedRuntimeId: string,
): string {
  const trimmed = output.trim();
  if (!trimmed) return requestedRuntimeId;

  try {
    const parsed = JSON.parse(trimmed) as {
      agentId?: unknown;
      id?: unknown;
      agent_id?: unknown;
    };
    for (const candidate of [parsed.agentId, parsed.id, parsed.agent_id]) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  } catch {
    // fall through to requested runtime id
  }

  return requestedRuntimeId;
}
