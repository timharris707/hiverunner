import { createHash } from "crypto";

export type MemoryReceiptDisposition = "used" | "ignored" | "irrelevant";

export type MemoryReceiptClaimInput =
  | string
  | {
      recordId?: unknown;
      evidenceEnvelopeId?: unknown;
      envelopeId?: unknown;
      reason?: unknown;
      quote?: unknown;
    };

export type MemoryReceiptAction = {
  action: "memory_receipt";
  taskKey?: string;
  used?: MemoryReceiptClaimInput[];
  ignored?: MemoryReceiptClaimInput[];
  irrelevant?: MemoryReceiptClaimInput[];
  note?: string;
};

export type MemoryUtilizationClaim = {
  disposition: MemoryReceiptDisposition;
  availableInInjection: boolean;
  recordId?: string;
  evidenceEnvelopeId?: string;
  title?: string;
  sourcePath?: string | null;
  layer?: string;
  reason?: string;
  quote?: string;
};

export type MemoryUtilizationReceipt = {
  id: string;
  version: 1;
  schema: "hiverunner.memory_utilization_receipt.v1";
  source: "agent_claim";
  truthStatus: "agent_claim_unverified";
  runId: string;
  heartbeatRunId: string;
  taskKey: string | null;
  agentId: string;
  agentName: string;
  recordedAt: string;
  injectedMemorySha256: string | null;
  note?: string;
  claims: Record<MemoryReceiptDisposition, MemoryUtilizationClaim[]>;
  summary: Record<MemoryReceiptDisposition, number> & {
    total: number;
    unknownToInjection: number;
  };
};

export type MemoryUtilizationReceiptsMetadata = {
  version: 1;
  schema: "hiverunner.memory_utilization_receipts.v1";
  receipts: MemoryUtilizationReceipt[];
};

export type MemoryUtilizationMatchedUseMetadata = {
  version: 1;
  schema: "hiverunner.memory_utilization_matched_use.v1";
  status: "not_evaluated" | "evaluated";
  evaluator?: "deterministic_source_span_v1";
  evaluatedAt?: string;
  outputSha256?: string;
  summary?: {
    totalInjected: number;
    matched: number;
    weak: number;
    absent: number;
    hallucinated: number;
  };
  matches: MemoryUtilizationMatchedUseMatch[];
};

export type MemoryUtilizationMatchedUseClassification =
  | "matched"
  | "weak"
  | "absent"
  | "hallucinated";

export type MemoryUtilizationMatchedUseOutputDocument = {
  id?: string;
  kind?: string;
  text: string;
};

export type MemoryUtilizationMatchedUseSpan = {
  outputId: string;
  outputKind: string;
  start: number;
  end: number;
  text: string;
  strategy:
    | "record_id"
    | "evidence_envelope_id"
    | "source_path"
    | "source_basename"
    | "title"
    | "title_token"
    | "hallucinated_identifier"
    | "hallucinated_memory_path";
};

export type MemoryUtilizationMatchedUseMatch = {
  status: MemoryUtilizationMatchedUseClassification;
  recordId?: string;
  evidenceEnvelopeId?: string | null;
  title?: string;
  sourcePath?: string | null;
  claimedIdentifier?: string;
  identifierType?: "record_id" | "evidence_envelope_id" | "memory_path";
  spans: MemoryUtilizationMatchedUseSpan[];
};

type InjectedEvidenceRecord = {
  recordId: string;
  evidenceEnvelopeId: string | null;
  title?: string;
  sourcePath?: string | null;
  layer?: string;
};

const DISPOSITIONS: MemoryReceiptDisposition[] = ["used", "ignored", "irrelevant"];
const RECEIPT_HISTORY_LIMIT = 50;

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function claimArray(value: unknown): MemoryReceiptClaimInput[] {
  return Array.isArray(value) ? value as MemoryReceiptClaimInput[] : [];
}

function evidenceEnvelopeId(record: Record<string, unknown>): string | null {
  const envelope = objectValue(record.evidenceEnvelope);
  return stringValue(envelope?.envelopeId) ?? stringValue(envelope?.id);
}

function sourceBasename(sourcePath: string | null | undefined): string | null {
  if (!sourcePath) return null;
  const normalized = sourcePath.replace(/\\/g, "/");
  const basename = normalized.split("/").filter(Boolean).pop();
  return basename && basename.length >= 4 ? basename : null;
}

function injectedEvidenceMaps(metadata: Record<string, unknown>): {
  byRecordId: Map<string, InjectedEvidenceRecord>;
  byEnvelopeId: Map<string, InjectedEvidenceRecord>;
} {
  const byRecordId = new Map<string, InjectedEvidenceRecord>();
  const byEnvelopeId = new Map<string, InjectedEvidenceRecord>();
  const evidence = objectValue(metadata.injectedMemoryEvidence);
  const records = Array.isArray(evidence?.records) ? evidence.records : [];

  for (const rawRecord of records) {
    const record = objectValue(rawRecord);
    if (!record) continue;
    const recordId = stringValue(record.recordId);
    if (!recordId) continue;
    const injected: InjectedEvidenceRecord = {
      recordId,
      evidenceEnvelopeId: evidenceEnvelopeId(record),
      title: stringValue(record.title) ?? undefined,
      sourcePath: stringValue(record.sourcePath),
      layer: stringValue(record.layer) ?? undefined,
    };
    byRecordId.set(recordId, injected);
    if (injected.evidenceEnvelopeId) {
      byEnvelopeId.set(injected.evidenceEnvelopeId, injected);
    }
  }

  return { byRecordId, byEnvelopeId };
}

function normalizeClaim(input: {
  value: MemoryReceiptClaimInput;
  disposition: MemoryReceiptDisposition;
  byRecordId: Map<string, InjectedEvidenceRecord>;
  byEnvelopeId: Map<string, InjectedEvidenceRecord>;
}): MemoryUtilizationClaim | null {
  const object = objectValue(input.value);
  const recordId = typeof input.value === "string"
    ? stringValue(input.value)
    : stringValue(object?.recordId);
  const providedEnvelopeId = stringValue(object?.evidenceEnvelopeId) ?? stringValue(object?.envelopeId);
  const injected = (recordId ? input.byRecordId.get(recordId) : undefined) ??
    (providedEnvelopeId ? input.byEnvelopeId.get(providedEnvelopeId) : undefined);
  const resolvedRecordId = recordId ?? injected?.recordId ?? null;
  const resolvedEnvelopeId = providedEnvelopeId ?? injected?.evidenceEnvelopeId ?? null;
  if (!resolvedRecordId && !resolvedEnvelopeId) return null;

  const claim: MemoryUtilizationClaim = {
    disposition: input.disposition,
    availableInInjection: Boolean(injected),
  };
  if (resolvedRecordId) claim.recordId = resolvedRecordId;
  if (resolvedEnvelopeId) claim.evidenceEnvelopeId = resolvedEnvelopeId;
  if (injected?.title) claim.title = injected.title;
  if (injected?.sourcePath !== undefined) claim.sourcePath = injected.sourcePath;
  if (injected?.layer) claim.layer = injected.layer;
  const reason = stringValue(object?.reason);
  if (reason) claim.reason = reason.slice(0, 500);
  const quote = stringValue(object?.quote);
  if (quote) claim.quote = quote.slice(0, 500);
  return claim;
}

function normalizeClaims(input: {
  action: MemoryReceiptAction;
  metadata: Record<string, unknown>;
}): Record<MemoryReceiptDisposition, MemoryUtilizationClaim[]> {
  const { byRecordId, byEnvelopeId } = injectedEvidenceMaps(input.metadata);
  const claims = {
    used: [] as MemoryUtilizationClaim[],
    ignored: [] as MemoryUtilizationClaim[],
    irrelevant: [] as MemoryUtilizationClaim[],
  };

  for (const disposition of DISPOSITIONS) {
    for (const value of claimArray(input.action[disposition])) {
      const claim = normalizeClaim({ value, disposition, byRecordId, byEnvelopeId });
      if (claim) claims[disposition].push(claim);
    }
  }

  return claims;
}

export function validateMemoryReceiptActionFields(parsed: Record<string, unknown>): string | null {
  if (parsed.taskKey !== undefined && typeof parsed.taskKey !== "string") {
    return "memory_receipt: 'taskKey' must be a string";
  }
  if (parsed.note !== undefined && typeof parsed.note !== "string") {
    return "memory_receipt: 'note' must be a string";
  }

  let claimCount = 0;
  for (const field of DISPOSITIONS) {
    const value = parsed[field];
    if (value === undefined) continue;
    if (!Array.isArray(value)) return `memory_receipt: '${field}' must be an array`;
    for (const entry of value) {
      if (typeof entry === "string") {
        if (!entry.trim()) return `memory_receipt: '${field}' entries cannot be blank`;
        claimCount += 1;
        continue;
      }
      const object = objectValue(entry);
      if (!object) return `memory_receipt: '${field}' entries must be strings or objects`;
      if (
        !stringValue(object.recordId) &&
        !stringValue(object.evidenceEnvelopeId) &&
        !stringValue(object.envelopeId)
      ) {
        return `memory_receipt: '${field}' entries require recordId or evidenceEnvelopeId`;
      }
      if (object.reason !== undefined && typeof object.reason !== "string") {
        return `memory_receipt: '${field}.reason' must be a string`;
      }
      if (object.quote !== undefined && typeof object.quote !== "string") {
        return `memory_receipt: '${field}.quote' must be a string`;
      }
      claimCount += 1;
    }
  }

  if (claimCount === 0) {
    return "memory_receipt: provide at least one claim in 'used', 'ignored', or 'irrelevant'";
  }
  return null;
}

export function normalizeMemoryUtilizationReceiptsMetadata(value: unknown): MemoryUtilizationReceiptsMetadata | null {
  const object = objectValue(value);
  if (!object) return null;
  const receipts = Array.isArray(object.receipts)
    ? object.receipts.filter((receipt) => objectValue(receipt)) as MemoryUtilizationReceipt[]
    : [];
  return {
    version: 1,
    schema: "hiverunner.memory_utilization_receipts.v1",
    receipts,
  };
}

export function normalizeMemoryUtilizationMatchedUseMetadata(value: unknown): MemoryUtilizationMatchedUseMetadata | null {
  const object = objectValue(value);
  if (!object) return null;
  const status = object.status === "evaluated" ? "evaluated" : "not_evaluated";
  const matches = Array.isArray(object.matches)
    ? object.matches.filter((match) => objectValue(match)) as MemoryUtilizationMatchedUseMatch[]
    : [];
  const summary = objectValue(object.summary) as MemoryUtilizationMatchedUseMetadata["summary"] | null;
  return {
    version: 1,
    schema: "hiverunner.memory_utilization_matched_use.v1",
    status,
    ...(object.evaluator === "deterministic_source_span_v1" ? { evaluator: object.evaluator } : {}),
    ...(typeof object.evaluatedAt === "string" ? { evaluatedAt: object.evaluatedAt } : {}),
    ...(typeof object.outputSha256 === "string" ? { outputSha256: object.outputSha256 } : {}),
    ...(summary ? { summary } : {}),
    matches,
  };
}

const TITLE_TOKEN_STOPWORDS = new Set([
  "about", "after", "agent", "against", "company", "context", "evidence",
  "from", "into", "local", "memory", "note", "record", "source", "task",
  "that", "this", "utilization", "with",
]);

function normalizeNeedle(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length >= 4 ? normalized : null;
}

function outputHash(outputs: MemoryUtilizationMatchedUseOutputDocument[]): string {
  return createHash("sha256")
    .update(outputs.map((output, index) => `${index}:${output.kind ?? "output"}:${output.text}`).join("\n---matched-use-output---\n"))
    .digest("hex");
}

function titleTokens(title: string | undefined): string[] {
  if (!title) return [];
  const tokens = new Set<string>();
  for (const token of title.toLowerCase().split(/[^a-z0-9-]+/)) {
    if (token.length < 4) continue;
    if (TITLE_TOKEN_STOPWORDS.has(token)) continue;
    tokens.add(token);
  }
  return [...tokens].slice(0, 8);
}

function findSpans(input: {
  outputs: MemoryUtilizationMatchedUseOutputDocument[];
  needle: string | null;
  strategy: MemoryUtilizationMatchedUseSpan["strategy"];
}): MemoryUtilizationMatchedUseSpan[] {
  const normalizedNeedle = normalizeNeedle(input.needle);
  if (!normalizedNeedle) return [];
  const spans: MemoryUtilizationMatchedUseSpan[] = [];

  for (const [index, output] of input.outputs.entries()) {
    const text = output.text;
    const haystack = text.toLowerCase();
    let start = haystack.indexOf(normalizedNeedle);
    while (start >= 0) {
      const end = start + normalizedNeedle.length;
      spans.push({
        outputId: output.id ?? `output-${index + 1}`,
        outputKind: output.kind ?? "assistant_output",
        start,
        end,
        text: text.slice(start, end),
        strategy: input.strategy,
      });
      start = haystack.indexOf(normalizedNeedle, end);
    }
  }

  return spans;
}

function dedupeSpans(spans: MemoryUtilizationMatchedUseSpan[]): MemoryUtilizationMatchedUseSpan[] {
  const seen = new Set<string>();
  const deduped: MemoryUtilizationMatchedUseSpan[] = [];
  for (const span of spans) {
    const key = `${span.outputId}:${span.start}:${span.end}:${span.strategy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(span);
  }
  return deduped;
}

function injectedRecords(metadata: Record<string, unknown>): InjectedEvidenceRecord[] {
  const { byRecordId } = injectedEvidenceMaps(metadata);
  return [...byRecordId.values()];
}

function hallucinatedIdentifierMatches(input: {
  outputs: MemoryUtilizationMatchedUseOutputDocument[];
  injected: InjectedEvidenceRecord[];
}): MemoryUtilizationMatchedUseMatch[] {
  const knownRecordIds = new Set(input.injected.map((record) => record.recordId.toLowerCase()));
  const knownEnvelopeIds = new Set(
    input.injected
      .map((record) => record.evidenceEnvelopeId?.toLowerCase())
      .filter(Boolean) as string[],
  );
  const knownSourcePaths = new Set(
    input.injected
      .map((record) => record.sourcePath?.toLowerCase())
      .filter(Boolean) as string[],
  );
  const matches: MemoryUtilizationMatchedUseMatch[] = [];
  const seen = new Set<string>();
  const identifierPattern = /\b(record\s*id|recordId|evidence\s+envelope\s+id|evidenceEnvelopeId|envelope\s*id|envelopeId)\s*[:=]\s*`?([A-Za-z0-9][A-Za-z0-9_.:/-]{5,127})`?/gi;
  const memoryPathPattern = /`?(\/[^\s`]*memor(?:y|ies)[^\s`]*\.md)`?/gi;

  for (const [index, output] of input.outputs.entries()) {
    for (const match of output.text.matchAll(identifierPattern)) {
      const label = match[1].toLowerCase();
      const claimedIdentifier = match[2];
      const normalized = claimedIdentifier.toLowerCase();
      const identifierType = label.includes("envelope")
        ? "evidence_envelope_id" as const
        : "record_id" as const;
      const known = identifierType === "record_id"
        ? knownRecordIds.has(normalized)
        : knownEnvelopeIds.has(normalized);
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const key = `${identifierType}:${normalized}:${start}:${end}`;
      if (known || seen.has(key)) continue;
      seen.add(key);
      matches.push({
        status: "hallucinated",
        claimedIdentifier,
        identifierType,
        spans: [{
          outputId: output.id ?? `output-${index + 1}`,
          outputKind: output.kind ?? "assistant_output",
          start,
          end,
          text: output.text.slice(start, end),
          strategy: "hallucinated_identifier",
        }],
      });
    }

    for (const match of output.text.matchAll(memoryPathPattern)) {
      const claimedIdentifier = match[1];
      const normalized = claimedIdentifier.toLowerCase();
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const key = `memory_path:${normalized}:${start}:${end}`;
      if (knownSourcePaths.has(normalized) || seen.has(key)) continue;
      seen.add(key);
      matches.push({
        status: "hallucinated",
        claimedIdentifier,
        identifierType: "memory_path",
        spans: [{
          outputId: output.id ?? `output-${index + 1}`,
          outputKind: output.kind ?? "assistant_output",
          start,
          end,
          text: output.text.slice(start, end),
          strategy: "hallucinated_memory_path",
        }],
      });
    }
  }

  return matches;
}

export function evaluateMemoryUtilizationMatchedUse(input: {
  metadata: Record<string, unknown>;
  outputs: MemoryUtilizationMatchedUseOutputDocument[];
  evaluatedAt: string;
}): MemoryUtilizationMatchedUseMetadata {
  const outputs = input.outputs
    .map((output) => ({ ...output, text: output.text.trim() }))
    .filter((output) => output.text.length > 0);
  const injected = injectedRecords(input.metadata);
  const matches: MemoryUtilizationMatchedUseMatch[] = [];

  for (const record of injected) {
    const strongSpans = dedupeSpans([
      ...findSpans({ outputs, needle: record.recordId, strategy: "record_id" }),
      ...findSpans({ outputs, needle: record.evidenceEnvelopeId, strategy: "evidence_envelope_id" }),
      ...findSpans({ outputs, needle: record.sourcePath ?? null, strategy: "source_path" }),
      ...findSpans({ outputs, needle: record.title ?? null, strategy: "title" }),
    ]);
    const weakSpans = strongSpans.length > 0
      ? []
      : dedupeSpans([
          ...findSpans({ outputs, needle: sourceBasename(record.sourcePath), strategy: "source_basename" }),
          ...titleTokens(record.title).flatMap((token) => findSpans({ outputs, needle: token, strategy: "title_token" })),
        ]);
    const spans = strongSpans.length > 0 ? strongSpans : weakSpans;
    matches.push({
      status: strongSpans.length > 0 ? "matched" : weakSpans.length > 0 ? "weak" : "absent",
      recordId: record.recordId,
      evidenceEnvelopeId: record.evidenceEnvelopeId,
      ...(record.title ? { title: record.title } : {}),
      ...(record.sourcePath !== undefined ? { sourcePath: record.sourcePath } : {}),
      spans,
    });
  }

  matches.push(...hallucinatedIdentifierMatches({ outputs, injected }));

  const summary = {
    totalInjected: injected.length,
    matched: matches.filter((match) => match.status === "matched").length,
    weak: matches.filter((match) => match.status === "weak").length,
    absent: matches.filter((match) => match.status === "absent").length,
    hallucinated: matches.filter((match) => match.status === "hallucinated").length,
  };

  return {
    version: 1,
    schema: "hiverunner.memory_utilization_matched_use.v1",
    status: "evaluated",
    evaluator: "deterministic_source_span_v1",
    evaluatedAt: input.evaluatedAt,
    outputSha256: outputHash(outputs),
    summary,
    matches,
  };
}

export function buildMemoryUtilizationMatchedUseMetadataPatch(input: {
  metadata: Record<string, unknown>;
  outputs: MemoryUtilizationMatchedUseOutputDocument[];
  evaluatedAt: string;
}): { patch: Record<string, unknown>; evaluated: MemoryUtilizationMatchedUseMetadata } {
  const evaluated = evaluateMemoryUtilizationMatchedUse(input);
  return {
    patch: {
      memoryUtilizationMatchedUse: evaluated,
    },
    evaluated,
  };
}

export function buildMemoryUtilizationReceiptMetadataPatch(input: {
  action: MemoryReceiptAction;
  metadata: Record<string, unknown>;
  executionRunId: string;
  heartbeatRunId: string;
  taskKey: string | null;
  agentId: string;
  agentName: string;
  recordedAt: string;
  receiptId: string;
}): { patch: Record<string, unknown>; claimCount: number } {
  const claims = normalizeClaims({ action: input.action, metadata: input.metadata });
  const total = DISPOSITIONS.reduce((sum, disposition) => sum + claims[disposition].length, 0);
  const unknownToInjection = DISPOSITIONS.reduce(
    (sum, disposition) => sum + claims[disposition].filter((claim) => !claim.availableInInjection).length,
    0,
  );
  const injectedMemorySha256 = stringValue(input.metadata.injected_memory_sha256);
  const note = stringValue(input.action.note);
  const receipt: MemoryUtilizationReceipt = {
    id: input.receiptId,
    version: 1,
    schema: "hiverunner.memory_utilization_receipt.v1",
    source: "agent_claim",
    truthStatus: "agent_claim_unverified",
    runId: input.executionRunId,
    heartbeatRunId: input.heartbeatRunId,
    taskKey: input.taskKey,
    agentId: input.agentId,
    agentName: input.agentName,
    recordedAt: input.recordedAt,
    injectedMemorySha256,
    claims,
    summary: {
      used: claims.used.length,
      ignored: claims.ignored.length,
      irrelevant: claims.irrelevant.length,
      total,
      unknownToInjection,
    },
    ...(note ? { note: note.slice(0, 500) } : {}),
  };

  const previous = normalizeMemoryUtilizationReceiptsMetadata(input.metadata.memoryUtilizationReceipts) ?? {
    version: 1 as const,
    schema: "hiverunner.memory_utilization_receipts.v1" as const,
    receipts: [],
  };
  const matchedUse = normalizeMemoryUtilizationMatchedUseMetadata(input.metadata.memoryUtilizationMatchedUse) ?? {
    version: 1 as const,
    schema: "hiverunner.memory_utilization_matched_use.v1" as const,
    status: "not_evaluated" as const,
    matches: [],
  };

  return {
    patch: {
      memoryUtilizationReceipts: {
        ...previous,
        receipts: [...previous.receipts, receipt].slice(-RECEIPT_HISTORY_LIMIT),
      },
      memoryUtilizationMatchedUse: matchedUse,
    },
    claimCount: total,
  };
}
