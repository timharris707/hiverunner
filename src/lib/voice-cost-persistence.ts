import { getOrchestrationDb } from "@/lib/orchestration/db";
import { recordCostEventForExecution } from "@/lib/orchestration/cost-ledger";
import type { ResolvedVoiceBinding } from "@/lib/voice-binding";
import { hasVoiceUsage, type VoiceUsageTelemetry } from "@/lib/voice-usage-telemetry";

type VoiceUsagePayload = VoiceUsageTelemetry & {
  sessionId?: string;
};

type CompanyRow = { id: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUsagePayload(value: unknown): VoiceUsagePayload | null {
  if (!isRecord(value)) return null;
  const provider = value.provider === "openai-realtime-2" || value.provider === "gemini-live"
    ? value.provider
    : null;
  const model = typeof value.model === "string" && value.model.trim() ? value.model.trim() : null;
  if (!provider || !model) return null;

  const numberField = (key: keyof VoiceUsageTelemetry): number => {
    const raw = value[key];
    return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;
  };

  const usage: VoiceUsagePayload = {
    provider,
    model,
    sessionId: typeof value.sessionId === "string" && value.sessionId.trim() ? value.sessionId.trim() : undefined,
    responseCount: numberField("responseCount"),
    transcriptionCount: numberField("transcriptionCount"),
    inputTokens: numberField("inputTokens"),
    outputTokens: numberField("outputTokens"),
    cacheReadTokens: numberField("cacheReadTokens"),
    totalTokens: numberField("totalTokens"),
    inputTextTokens: numberField("inputTextTokens"),
    inputAudioTokens: numberField("inputAudioTokens"),
    outputTextTokens: numberField("outputTextTokens"),
    outputAudioTokens: numberField("outputAudioTokens"),
    cachedTextTokens: numberField("cachedTextTokens"),
    cachedAudioTokens: numberField("cachedAudioTokens"),
    transcriptionInputTokens: numberField("transcriptionInputTokens"),
    transcriptionOutputTokens: numberField("transcriptionOutputTokens"),
    rawEventCount: numberField("rawEventCount"),
    source: value.source === "estimated" ? "estimated" : "reported",
  };

  return hasVoiceUsage(usage) ? usage : null;
}

function resolveCompanyId(binding: ResolvedVoiceBinding): string | null {
  const db = getOrchestrationDb();

  if (binding.companySlug) {
    const company = db.prepare("SELECT id FROM companies WHERE slug = ?").get(binding.companySlug) as CompanyRow | undefined;
    if (company?.id) return company.id;
  }

  if (binding.projectId) {
    const project = db.prepare("SELECT company_id AS id FROM projects WHERE id = ?").get(binding.projectId) as CompanyRow | undefined;
    if (project?.id) return project.id;
  }

  if (binding.taskId) {
    const task = db
      .prepare(
        `SELECT p.company_id AS id
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         WHERE t.id = ?`,
      )
      .get(binding.taskId) as CompanyRow | undefined;
    if (task?.id) return task.id;
  }

  return null;
}

function costCentsFromUsd(usd: number): number {
  return Math.max(0, usd * 100);
}

function perMillion(tokens: number, usdPerMillion: number): number {
  return (Math.max(0, tokens) / 1_000_000) * usdPerMillion;
}

function estimateOpenAiRealtimeCostUsd(usage: VoiceUsagePayload): number {
  const uncachedInputText = Math.max(0, usage.inputTextTokens - usage.cachedTextTokens);
  const uncachedInputAudio = Math.max(0, usage.inputAudioTokens - usage.cachedAudioTokens);

  return perMillion(uncachedInputAudio, 32)
    + perMillion(usage.cachedAudioTokens, 0.40)
    + perMillion(uncachedInputText, 4)
    + perMillion(usage.cachedTextTokens, 0.40)
    + perMillion(usage.outputAudioTokens, 64)
    + perMillion(usage.outputTextTokens, 24);
}

function estimateGeminiLiveCostUsd(usage: VoiceUsagePayload): number {
  if (usage.model === "gemini-3.1-flash-live-preview") {
    return perMillion(usage.inputAudioTokens, 3)
      + perMillion(usage.outputAudioTokens, 12)
      + perMillion(usage.inputTextTokens || Math.max(0, usage.inputTokens - usage.inputAudioTokens), 0.75)
      + perMillion(usage.outputTextTokens || Math.max(0, usage.outputTokens - usage.outputAudioTokens), 4.5);
  }

  return 0;
}

function estimateCostCents(usage: VoiceUsagePayload): number {
  if (usage.provider === "openai-realtime-2") {
    return costCentsFromUsd(estimateOpenAiRealtimeCostUsd(usage));
  }

  if (usage.provider === "gemini-live") {
    return costCentsFromUsd(estimateGeminiLiveCostUsd(usage));
  }

  return 0;
}

function providerForUsage(usage: VoiceUsagePayload): string {
  return usage.provider === "openai-realtime-2" ? "openai" : "gemini";
}

export function persistVoiceCostEvent(input: {
  sessionId?: string | null;
  binding?: ResolvedVoiceBinding;
  usage?: unknown;
  durationSeconds?: number;
  messages?: number;
}): string | null {
  if (!input.binding) return null;

  const usage = parseUsagePayload(input.usage);
  if (!usage) return null;

  const companyId = resolveCompanyId(input.binding);
  if (!companyId) return null;

  const sessionId = usage.sessionId || input.sessionId || "unknown";
  return recordCostEventForExecution({
    eventId: `voice:${sessionId}:${usage.provider}:${usage.model}`,
    companyId,
    agentId: input.binding.agentId ?? null,
    taskId: input.binding.taskId ?? null,
    projectId: input.binding.projectId ?? null,
    provider: providerForUsage(usage),
    usage: {
      provider: providerForUsage(usage),
      runtimeProvider: providerForUsage(usage),
      model: usage.model,
      billingType: "metered_api",
      billingProvider: providerForUsage(usage) === "openai" ? "openai" : "google",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      totalCostCents: estimateCostCents(usage),
      voiceProvider: usage.provider,
      voiceSessionId: sessionId,
      voiceDurationSeconds: input.durationSeconds,
      voiceMessages: input.messages,
      voiceUsage: usage,
      costEstimateSource: usage.provider === "openai-realtime-2"
        ? "openai_realtime_pricing_2026_05"
        : "google_gemini_3_1_flash_live_pricing_2026_05",
    },
  });
}
