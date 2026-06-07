import { createHash } from "crypto";

export const BUILT_IN_RECOMMENDATION_TRIGGER_SOURCE_IDS = [
  "missing_skill",
  "missing_tool_runtime",
  "suggested_new_agent_role",
  "bench_or_exclude_agent",
  "template_capability_slot_change",
  "reviewer_notes",
] as const;

export const MAX_RECOMMENDATION_EVIDENCE_ITEMS = 5;

const MAX_RECOMMENDATIONS_PER_BATCH = 50;
const MAX_EVIDENCE_SUMMARY_LENGTH = 320;
const MAX_METADATA_KEYS = 12;
const MAX_METADATA_ARRAY_ITEMS = 8;
const MAX_SURFACES = 6;

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/gi,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
];

export type BuiltInRecommendationTriggerSourceId = typeof BUILT_IN_RECOMMENDATION_TRIGGER_SOURCE_IDS[number];

export type ImprovementRecommendationTriggerClass =
  | "missing_capability"
  | "missing_tool_runtime"
  | "repeated_review_return"
  | "template_drift"
  | "reviewer_request";

export type ImprovementRecommendationType =
  | "add_missing_skill"
  | "configure_missing_tool_runtime"
  | "suggest_new_agent_role"
  | "bench_or_exclude_agent"
  | "change_template_capability_slot"
  | "add_reviewer_notes";

export type ImprovementRecommendationSeverity = "low" | "medium" | "high" | "critical";
export type ImprovementRecommendationConfidence = "low" | "medium" | "high";

type ImprovementRecommendationEvidenceInput = {
  id?: string | null;
  source: string;
  summary: string;
  occurredAt?: string | null;
  route?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ImprovementRecommendationEvidence = {
  id: string;
  source: string;
  summary: string;
  occurredAt: string | null;
  route?: string;
  metadata?: Record<string, unknown>;
};

export type ImprovementAffectedSurface = {
  kind:
    | "company"
    | "agent"
    | "skill"
    | "tool_runtime"
    | "new_agent_role"
    | "task_type"
    | "template"
    | "template_slot"
    | "eval_case";
  id?: string;
  label: string;
};

type BaseBuiltInTriggerInput = {
  companyId: string;
  evidence: ImprovementRecommendationEvidenceInput[];
};

export type MissingSkillTriggerInput = BaseBuiltInTriggerInput & {
  source: "missing_skill";
  agent: { id: string; name: string; role: string };
  skill: { name: string; reason?: string | null };
  taskType?: string | null;
};

export type MissingToolRuntimeTriggerInput = BaseBuiltInTriggerInput & {
  source: "missing_tool_runtime";
  subject: { kind: "company" | "agent" | "task"; id?: string | null; label: string };
  requirement: { kind: "tool" | "runtime" | "cli" | "environment"; name: string; reason?: string | null };
};

export type SuggestedNewAgentRoleTriggerInput = BaseBuiltInTriggerInput & {
  source: "suggested_new_agent_role";
  role: { name: string; capabilities: string[]; reason?: string | null };
  scope?: { kind: "template" | "task_type" | "company"; id?: string | null; label: string } | null;
};

export type BenchOrExcludeAgentTriggerInput = BaseBuiltInTriggerInput & {
  source: "bench_or_exclude_agent";
  agent: { id: string; name: string; role: string };
  action: "bench" | "exclude";
  scope: { kind: "template" | "task_type"; id?: string | null; label: string };
  reason?: string | null;
};

export type TemplateCapabilitySlotChangeTriggerInput = BaseBuiltInTriggerInput & {
  source: "template_capability_slot_change";
  template: { id: string; name: string };
  slot: { id: string; label: string };
  change: {
    action: "add" | "remove" | "rename" | "move_lane" | "adjust_description";
    fromLane?: "required" | "useful" | "later" | null;
    toLane?: "required" | "useful" | "later" | null;
    reason?: string | null;
  };
};

export type ReviewerNotesTriggerInput = BaseBuiltInTriggerInput & {
  source: "reviewer_notes";
  target: { kind: "eval_case" | "template"; id: string; label: string };
  reviewer?: { id?: string | null; name?: string | null } | null;
  notes: string;
};

export type BuiltInImprovementTriggerInput =
  | MissingSkillTriggerInput
  | MissingToolRuntimeTriggerInput
  | SuggestedNewAgentRoleTriggerInput
  | BenchOrExcludeAgentTriggerInput
  | TemplateCapabilitySlotChangeTriggerInput
  | ReviewerNotesTriggerInput;

export type BuiltInImprovementRecommendationSuppression = {
  id: string;
  dedupeKey: string;
  evidenceFingerprint?: string | null;
  active?: boolean;
  suppressedAt?: string | null;
  reason?: string | null;
};

export type BuiltInImprovementRecommendationDraft = {
  schema: "hiverunner.improvement_recommendation_draft.v1";
  companyId: string;
  status: "suggested";
  triggerSource: BuiltInRecommendationTriggerSourceId;
  triggerClass: ImprovementRecommendationTriggerClass;
  recommendationType: ImprovementRecommendationType;
  severity: ImprovementRecommendationSeverity;
  confidence: ImprovementRecommendationConfidence;
  title: string;
  rationale: string;
  proposedChange: string;
  rollbackNotes: string;
  affectedSurfaces: ImprovementAffectedSurface[];
  evidence: ImprovementRecommendationEvidence[];
  evidenceCount: number;
  totalEvidenceCount: number;
  dedupeKey: string;
  evidenceFingerprint: string;
  originalGeneratedText: string;
  supersedesSuppressionIds?: string[];
  newEvidenceSinceSuppression?: boolean;
};

export type SuppressedBuiltInImprovementRecommendation = {
  triggerSource: BuiltInRecommendationTriggerSourceId;
  dedupeKey: string;
  evidenceFingerprint: string;
  suppressionId: string;
  reason: "suppressed_without_new_evidence";
};

export type SkippedBuiltInImprovementTrigger = {
  triggerSource: BuiltInRecommendationTriggerSourceId;
  reason: "missing_evidence" | "recommendation_limit_reached";
  dedupeKey?: string;
};

export type BuildBuiltInImprovementRecommendationsResult = {
  recommendations: BuiltInImprovementRecommendationDraft[];
  suppressed: SuppressedBuiltInImprovementRecommendation[];
  skipped: SkippedBuiltInImprovementTrigger[];
};

function redactText(value: string): string {
  return SECRET_PATTERNS.reduce((next, pattern) => next.replace(pattern, "[redacted]"), value);
}

function compactText(value: string | null | undefined): string {
  return redactText(String(value ?? "").replace(/\s+/g, " ").trim());
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function boundedText(value: string | null | undefined, maxLength = MAX_EVIDENCE_SUMMARY_LENGTH): string {
  return truncateText(compactText(value), maxLength);
}

function normalizeKey(value: string | null | undefined): string {
  return compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "unknown";
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function boundedScalar(value: unknown): unknown {
  if (typeof value === "string") return boundedText(value, 180);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return undefined;
}

function boundedMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, MAX_METADATA_KEYS);
  const result: Record<string, unknown> = {};
  for (const [key, rawValue] of entries) {
    const value = Array.isArray(rawValue)
      ? rawValue.slice(0, MAX_METADATA_ARRAY_ITEMS).map(boundedScalar).filter((item) => item !== undefined)
      : boundedScalar(rawValue);
    if (value !== undefined) {
      result[normalizeKey(key)] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function citeableEvidence(input: readonly ImprovementRecommendationEvidenceInput[]): ImprovementRecommendationEvidence[] {
  return input
    .map((item, index) => {
      const summary = boundedText(item.summary);
      const source = boundedText(item.source, 80) || "unknown";
      if (!summary) return null;
      const metadata = boundedMetadata(item.metadata);
      return {
        id: boundedText(item.id ?? `${source}-${index + 1}`, 120) || `${source}-${index + 1}`,
        source,
        summary,
        occurredAt: boundedText(item.occurredAt, 80) || null,
        ...(item.route ? { route: boundedText(item.route, 180) } : {}),
        ...(metadata ? { metadata } : {}),
      };
    })
    .filter((item): item is ImprovementRecommendationEvidence => Boolean(item));
}

function evidenceFingerprint(evidence: readonly ImprovementRecommendationEvidence[]): string {
  return sha256(
    evidence
      .map((item) => ({
        id: item.id,
        source: item.source,
        summary: item.summary,
        occurredAt: item.occurredAt,
      }))
      .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right))),
  );
}

function evidenceRationale(evidence: readonly ImprovementRecommendationEvidence[], detail: string): string {
  const cited = evidence
    .slice(0, MAX_RECOMMENDATION_EVIDENCE_ITEMS)
    .map((item) => `${item.source}:${item.id} - ${item.summary}`)
    .join(" ");
  return `${boundedText(detail, 700)} Evidence: ${cited}`;
}

function confidenceFor(totalEvidenceCount: number): ImprovementRecommendationConfidence {
  if (totalEvidenceCount >= 3) return "high";
  if (totalEvidenceCount >= 2) return "medium";
  return "low";
}

function withSurfaceLimit(surfaces: ImprovementAffectedSurface[]): ImprovementAffectedSurface[] {
  return surfaces
    .filter((surface) => surface.label.trim())
    .slice(0, MAX_SURFACES)
    .map((surface) => ({
      ...surface,
      label: boundedText(surface.label, 160),
      ...(surface.id ? { id: boundedText(surface.id, 120) } : {}),
    }));
}

function originalGeneratedText(input: {
  title: string;
  rationale: string;
  proposedChange: string;
  rollbackNotes: string;
}): string {
  return [
    `Recommendation: ${input.title}`,
    `Rationale: ${input.rationale}`,
    `Proposed change: ${input.proposedChange}`,
    `Correction notes: ${input.rollbackNotes}`,
  ].join("\n\n");
}

function buildDraft(input: {
  companyId: string;
  triggerSource: BuiltInRecommendationTriggerSourceId;
  triggerClass: ImprovementRecommendationTriggerClass;
  recommendationType: ImprovementRecommendationType;
  severity: ImprovementRecommendationSeverity;
  title: string;
  rationaleDetail: string;
  proposedChange: string;
  rollbackNotes: string;
  affectedSurfaces: ImprovementAffectedSurface[];
  dedupeParts: string[];
  evidence: ImprovementRecommendationEvidenceInput[];
}): BuiltInImprovementRecommendationDraft | null {
  const allEvidence = citeableEvidence(input.evidence);
  if (allEvidence.length === 0) return null;

  const evidence = allEvidence.slice(0, MAX_RECOMMENDATION_EVIDENCE_ITEMS);
  const title = boundedText(input.title, 180);
  const rationale = evidenceRationale(evidence, input.rationaleDetail);
  const proposedChange = boundedText(input.proposedChange, 700);
  const rollbackNotes = boundedText(input.rollbackNotes, 500);
  const draft = {
    schema: "hiverunner.improvement_recommendation_draft.v1" as const,
    companyId: input.companyId,
    status: "suggested" as const,
    triggerSource: input.triggerSource,
    triggerClass: input.triggerClass,
    recommendationType: input.recommendationType,
    severity: input.severity,
    confidence: confidenceFor(allEvidence.length),
    title,
    rationale,
    proposedChange,
    rollbackNotes,
    affectedSurfaces: withSurfaceLimit(input.affectedSurfaces),
    evidence,
    evidenceCount: evidence.length,
    totalEvidenceCount: allEvidence.length,
    dedupeKey: `built_in:${input.companyId}:${input.triggerSource}:${input.dedupeParts.map(normalizeKey).join(":")}`,
    evidenceFingerprint: evidenceFingerprint(allEvidence),
    originalGeneratedText: "",
  };
  return {
    ...draft,
    originalGeneratedText: originalGeneratedText(draft),
  };
}

function formatSlotChange(input: TemplateCapabilitySlotChangeTriggerInput): string {
  switch (input.change.action) {
    case "move_lane":
      return `move from ${input.change.fromLane ?? "current lane"} to ${input.change.toLane ?? "target lane"}`;
    case "adjust_description":
      return "adjust the slot description";
    case "rename":
      return "rename the slot";
    default:
      return `${input.change.action} the slot`;
  }
}

function missingSkillDraft(input: MissingSkillTriggerInput): BuiltInImprovementRecommendationDraft | null {
  return buildDraft({
    companyId: input.companyId,
    triggerSource: input.source,
    triggerClass: "missing_capability",
    recommendationType: "add_missing_skill",
    severity: "medium",
    title: `Add "${input.skill.name}" skill to ${input.agent.name}`,
    rationaleDetail: input.skill.reason ?? `${input.agent.name} is repeatedly asked to cover ${input.skill.name}.`,
    proposedChange: `Add a scoped "${input.skill.name}" skill to ${input.agent.name} so future ${input.taskType ?? "matching"} work has an explicit operating procedure.`,
    rollbackNotes: "If later reviews do not confirm the gap, dismiss this recommendation or remove the proposed skill through normal governed configuration review.",
    affectedSurfaces: [
      { kind: "agent", id: input.agent.id, label: `${input.agent.name} (${input.agent.role})` },
      { kind: "skill", label: input.skill.name },
      ...(input.taskType ? [{ kind: "task_type" as const, id: input.taskType, label: input.taskType }] : []),
    ],
    dedupeParts: ["agent", input.agent.id, "skill", input.skill.name, input.taskType ?? ""],
    evidence: input.evidence,
  });
}

function missingToolRuntimeDraft(input: MissingToolRuntimeTriggerInput): BuiltInImprovementRecommendationDraft | null {
  return buildDraft({
    companyId: input.companyId,
    triggerSource: input.source,
    triggerClass: "missing_tool_runtime",
    recommendationType: "configure_missing_tool_runtime",
    severity: input.requirement.kind === "runtime" ? "high" : "medium",
    title: `Configure ${input.requirement.kind} "${input.requirement.name}" for ${input.subject.label}`,
    rationaleDetail: input.requirement.reason ?? `${input.subject.label} requires ${input.requirement.name} before this work can be verified reliably.`,
    proposedChange: `Add or document the missing ${input.requirement.kind} "${input.requirement.name}" for ${input.subject.label}; keep actual setup behind the existing runtime/tool governance path.`,
    rollbackNotes: "If the requirement was incorrect, dismiss the recommendation; if setup is later removed, preserve the evidence and correction note in Improve.",
    affectedSurfaces: [
      { kind: input.subject.kind === "agent" ? "agent" : "tool_runtime", id: input.subject.id ?? undefined, label: input.subject.label },
      { kind: "tool_runtime", label: `${input.requirement.kind}: ${input.requirement.name}` },
    ],
    dedupeParts: [input.subject.kind, input.subject.id ?? input.subject.label, input.requirement.kind, input.requirement.name],
    evidence: input.evidence,
  });
}

function suggestedNewAgentRoleDraft(input: SuggestedNewAgentRoleTriggerInput): BuiltInImprovementRecommendationDraft | null {
  return buildDraft({
    companyId: input.companyId,
    triggerSource: input.source,
    triggerClass: "missing_capability",
    recommendationType: "suggest_new_agent_role",
    severity: "medium",
    title: `Suggest new agent role: ${input.role.name}`,
    rationaleDetail: input.role.reason ?? `${input.role.name} would cover a recurring capability gap.`,
    proposedChange: `Draft a new "${input.role.name}" agent role with capabilities: ${input.role.capabilities.map((item) => boundedText(item, 120)).join(", ")}. Route any hire through existing agent approval governance.`,
    rollbackNotes: "Do not auto-create the agent from this recommendation. Dismiss or revise it if active crew coverage changes.",
    affectedSurfaces: [
      { kind: "new_agent_role", label: input.role.name },
      ...(input.scope
        ? [{
            kind: input.scope.kind,
            id: input.scope.id ?? undefined,
            label: input.scope.label,
          }]
        : []),
    ],
    dedupeParts: ["role", input.role.name, input.scope?.kind ?? "", input.scope?.id ?? input.scope?.label ?? ""],
    evidence: input.evidence,
  });
}

function benchOrExcludeAgentDraft(input: BenchOrExcludeAgentTriggerInput): BuiltInImprovementRecommendationDraft | null {
  const action = input.action === "bench" ? "Bench" : "Exclude";
  return buildDraft({
    companyId: input.companyId,
    triggerSource: input.source,
    triggerClass: "repeated_review_return",
    recommendationType: "bench_or_exclude_agent",
    severity: "medium",
    title: `${action} ${input.agent.name} for ${input.scope.label}`,
    rationaleDetail: input.reason ?? `${input.agent.name} has repeated review returns for ${input.scope.label}.`,
    proposedChange: `${action} ${input.agent.name} for ${input.scope.kind} "${input.scope.label}" routing only. Do not archive or delete the agent.`,
    rollbackNotes: "Re-enable routing for this scope if later accepted evals or reviews show the agent is reliable for this work again.",
    affectedSurfaces: [
      { kind: "agent", id: input.agent.id, label: `${input.agent.name} (${input.agent.role})` },
      { kind: input.scope.kind === "template" ? "template" : "task_type", id: input.scope.id ?? undefined, label: input.scope.label },
    ],
    dedupeParts: ["agent", input.agent.id, input.action, input.scope.kind, input.scope.id ?? input.scope.label],
    evidence: input.evidence,
  });
}

function templateCapabilitySlotChangeDraft(
  input: TemplateCapabilitySlotChangeTriggerInput,
): BuiltInImprovementRecommendationDraft | null {
  return buildDraft({
    companyId: input.companyId,
    triggerSource: input.source,
    triggerClass: "template_drift",
    recommendationType: "change_template_capability_slot",
    severity: "medium",
    title: `Change ${input.template.name} capability slot "${input.slot.label}"`,
    rationaleDetail: input.change.reason ?? `${input.template.name} appears to need a capability-slot update.`,
    proposedChange: `Create a new immutable version of ${input.template.name} that will ${formatSlotChange(input)} for "${input.slot.label}".`,
    rollbackNotes: "Template versions are immutable; rollback by selecting the prior version or creating a forward correction version.",
    affectedSurfaces: [
      { kind: "template", id: input.template.id, label: input.template.name },
      { kind: "template_slot", id: input.slot.id, label: input.slot.label },
    ],
    dedupeParts: ["template", input.template.id, "slot", input.slot.id, input.change.action, input.change.fromLane ?? "", input.change.toLane ?? ""],
    evidence: input.evidence,
  });
}

function reviewerNotesDraft(input: ReviewerNotesTriggerInput): BuiltInImprovementRecommendationDraft | null {
  return buildDraft({
    companyId: input.companyId,
    triggerSource: input.source,
    triggerClass: "reviewer_request",
    recommendationType: "add_reviewer_notes",
    severity: "low",
    title: `Add reviewer notes to ${input.target.label}`,
    rationaleDetail: `${input.reviewer?.name ?? "Reviewer"} asked to preserve notes for ${input.target.label}.`,
    proposedChange: `Add reviewer note to ${input.target.kind.replace("_", " ")} "${input.target.label}": ${boundedText(input.notes, 360)}`,
    rollbackNotes: "Reviewer notes can be superseded by a later note; preserve the original recommendation and evidence for audit.",
    affectedSurfaces: [
      { kind: input.target.kind === "eval_case" ? "eval_case" : "template", id: input.target.id, label: input.target.label },
    ],
    dedupeParts: [input.target.kind, input.target.id, input.notes],
    evidence: input.evidence,
  });
}

function draftForInput(input: BuiltInImprovementTriggerInput): BuiltInImprovementRecommendationDraft | null {
  switch (input.source) {
    case "missing_skill":
      return missingSkillDraft(input);
    case "missing_tool_runtime":
      return missingToolRuntimeDraft(input);
    case "suggested_new_agent_role":
      return suggestedNewAgentRoleDraft(input);
    case "bench_or_exclude_agent":
      return benchOrExcludeAgentDraft(input);
    case "template_capability_slot_change":
      return templateCapabilitySlotChangeDraft(input);
    case "reviewer_notes":
      return reviewerNotesDraft(input);
  }
}

function activeSuppressionsFor(
  recommendation: BuiltInImprovementRecommendationDraft,
  suppressions: readonly BuiltInImprovementRecommendationSuppression[],
): BuiltInImprovementRecommendationSuppression[] {
  return suppressions.filter((suppression) => {
    if (suppression.active === false) return false;
    return suppression.dedupeKey === recommendation.dedupeKey;
  });
}

function exactSuppressionFor(
  recommendation: BuiltInImprovementRecommendationDraft,
  suppressions: readonly BuiltInImprovementRecommendationSuppression[],
): BuiltInImprovementRecommendationSuppression | null {
  return suppressions.find((suppression) => (
    suppression.evidenceFingerprint === recommendation.evidenceFingerprint
  )) ?? null;
}

export function buildBuiltInImprovementRecommendations(
  inputs: readonly BuiltInImprovementTriggerInput[],
  options: {
    suppressions?: readonly BuiltInImprovementRecommendationSuppression[];
    maxRecommendations?: number;
  } = {},
): BuildBuiltInImprovementRecommendationsResult {
  const maxRecommendations = Math.max(
    1,
    Math.min(MAX_RECOMMENDATIONS_PER_BATCH, Math.trunc(options.maxRecommendations ?? MAX_RECOMMENDATIONS_PER_BATCH)),
  );
  const suppressions = options.suppressions ?? [];
  const recommendations: BuiltInImprovementRecommendationDraft[] = [];
  const suppressed: SuppressedBuiltInImprovementRecommendation[] = [];
  const skipped: SkippedBuiltInImprovementTrigger[] = [];

  for (const input of inputs) {
    const recommendation = draftForInput(input);
    if (!recommendation) {
      skipped.push({ triggerSource: input.source, reason: "missing_evidence" });
      continue;
    }

    const matchingSuppressions = activeSuppressionsFor(recommendation, suppressions);
    const exactSuppression = exactSuppressionFor(recommendation, matchingSuppressions);
    if (exactSuppression) {
      suppressed.push({
        triggerSource: recommendation.triggerSource,
        dedupeKey: recommendation.dedupeKey,
        evidenceFingerprint: recommendation.evidenceFingerprint,
        suppressionId: exactSuppression.id,
        reason: "suppressed_without_new_evidence",
      });
      continue;
    }

    if (recommendations.length >= maxRecommendations) {
      skipped.push({
        triggerSource: recommendation.triggerSource,
        reason: "recommendation_limit_reached",
        dedupeKey: recommendation.dedupeKey,
      });
      continue;
    }

    if (matchingSuppressions.length > 0) {
      recommendations.push({
        ...recommendation,
        newEvidenceSinceSuppression: true,
        supersedesSuppressionIds: matchingSuppressions.map((suppression) => suppression.id),
      });
      continue;
    }

    recommendations.push(recommendation);
  }

  return { recommendations, suppressed, skipped };
}
