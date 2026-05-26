export type VoiceUsageProvider = "gemini-live" | "openai-realtime-2";

export interface VoiceUsageTelemetry {
  provider: VoiceUsageProvider;
  model: string;
  responseCount: number;
  transcriptionCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  inputTextTokens: number;
  inputAudioTokens: number;
  outputTextTokens: number;
  outputAudioTokens: number;
  cachedTextTokens: number;
  cachedAudioTokens: number;
  transcriptionInputTokens: number;
  transcriptionOutputTokens: number;
  rawEventCount: number;
  source: "reported" | "estimated";
}

type MutableVoiceUsageTelemetry = VoiceUsageTelemetry;

export function createVoiceUsageTelemetry(provider: VoiceUsageProvider, model: string): VoiceUsageTelemetry {
  return {
    provider,
    model,
    responseCount: 0,
    transcriptionCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    inputTextTokens: 0,
    inputAudioTokens: 0,
    outputTextTokens: 0,
    outputAudioTokens: 0,
    cachedTextTokens: 0,
    cachedAudioTokens: 0,
    transcriptionInputTokens: 0,
    transcriptionOutputTokens: 0,
    rawEventCount: 0,
    source: "reported",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberFromRecord(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function detailRecord(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) return value;
  }
  return {};
}

function modalityTokenCount(details: unknown, modality: "TEXT" | "AUDIO"): number {
  if (!Array.isArray(details)) return 0;

  return details.reduce((total, entry) => {
    if (!isRecord(entry)) return total;
    const rawModality = typeof entry.modality === "string" ? entry.modality.toUpperCase() : "";
    if (rawModality !== modality) return total;
    return total + numberFromRecord(entry, ["tokenCount", "token_count"]);
  }, 0);
}

function addUsage(target: MutableVoiceUsageTelemetry, usage: Partial<VoiceUsageTelemetry>) {
  target.responseCount += usage.responseCount ?? 0;
  target.transcriptionCount += usage.transcriptionCount ?? 0;
  target.inputTokens += usage.inputTokens ?? 0;
  target.outputTokens += usage.outputTokens ?? 0;
  target.cacheReadTokens += usage.cacheReadTokens ?? 0;
  target.totalTokens += usage.totalTokens ?? 0;
  target.inputTextTokens += usage.inputTextTokens ?? 0;
  target.inputAudioTokens += usage.inputAudioTokens ?? 0;
  target.outputTextTokens += usage.outputTextTokens ?? 0;
  target.outputAudioTokens += usage.outputAudioTokens ?? 0;
  target.cachedTextTokens += usage.cachedTextTokens ?? 0;
  target.cachedAudioTokens += usage.cachedAudioTokens ?? 0;
  target.transcriptionInputTokens += usage.transcriptionInputTokens ?? 0;
  target.transcriptionOutputTokens += usage.transcriptionOutputTokens ?? 0;
  target.rawEventCount += usage.rawEventCount ?? 0;
}

export function mergeOpenAiRealtimeUsage(
  target: MutableVoiceUsageTelemetry,
  rawUsage: unknown,
  kind: "response" | "transcription" = "response",
) {
  if (!isRecord(rawUsage)) return;

  const inputDetails = detailRecord(rawUsage, ["input_token_details", "inputTokenDetails"]);
  const outputDetails = detailRecord(rawUsage, ["output_token_details", "outputTokenDetails"]);
  const cachedDetails = detailRecord(inputDetails, ["cached_tokens_details", "cachedTokensDetails"]);

  const inputTextTokens = numberFromRecord(inputDetails, ["text_tokens", "textTokens"]);
  const inputAudioTokens = numberFromRecord(inputDetails, ["audio_tokens", "audioTokens"]);
  const outputTextTokens = numberFromRecord(outputDetails, ["text_tokens", "textTokens"]);
  const outputAudioTokens = numberFromRecord(outputDetails, ["audio_tokens", "audioTokens"]);
  const cacheReadTokens = numberFromRecord(inputDetails, ["cached_tokens", "cachedTokens"]);
  const cachedTextTokens = numberFromRecord(cachedDetails, ["text_tokens", "textTokens"]);
  const cachedAudioTokens = numberFromRecord(cachedDetails, ["audio_tokens", "audioTokens"]);

  const inputTokens = numberFromRecord(rawUsage, ["input_tokens", "inputTokens"]);
  const outputTokens = numberFromRecord(rawUsage, ["output_tokens", "outputTokens"]);
  const totalTokens = numberFromRecord(rawUsage, ["total_tokens", "totalTokens"]) || inputTokens + outputTokens;

  addUsage(target, {
    responseCount: kind === "response" ? 1 : 0,
    transcriptionCount: kind === "transcription" ? 1 : 0,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    totalTokens,
    inputTextTokens,
    inputAudioTokens,
    outputTextTokens,
    outputAudioTokens,
    cachedTextTokens,
    cachedAudioTokens,
    transcriptionInputTokens: kind === "transcription" ? inputTokens : 0,
    transcriptionOutputTokens: kind === "transcription" ? outputTokens : 0,
    rawEventCount: 1,
  });

}

export function mergeGeminiLiveUsage(target: MutableVoiceUsageTelemetry, rawUsage: unknown) {
  if (!isRecord(rawUsage)) return;

  const inputTokens = numberFromRecord(rawUsage, ["promptTokenCount", "prompt_token_count", "inputTokens", "input_tokens"]);
  const outputTokens = numberFromRecord(rawUsage, ["candidatesTokenCount", "candidates_token_count", "outputTokens", "output_tokens"]);
  const cacheReadTokens = numberFromRecord(rawUsage, ["cachedContentTokenCount", "cached_content_token_count", "cacheReadTokens"]);
  const totalTokens =
    numberFromRecord(rawUsage, ["totalTokenCount", "total_token_count", "totalTokens", "total_tokens"])
    || inputTokens + outputTokens + cacheReadTokens;

  const promptDetails = rawUsage.promptTokensDetails ?? rawUsage.prompt_tokens_details;
  const responseDetails = rawUsage.responseTokensDetails
    ?? rawUsage.response_tokens_details
    ?? rawUsage.candidatesTokensDetails
    ?? rawUsage.candidates_tokens_details;

  const inputAudioTokens = modalityTokenCount(promptDetails, "AUDIO");
  const inputTextTokens = modalityTokenCount(promptDetails, "TEXT");
  const outputAudioTokens = modalityTokenCount(responseDetails, "AUDIO");
  const outputTextTokens = modalityTokenCount(responseDetails, "TEXT");

  addUsage(target, {
    responseCount: 1,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    totalTokens,
    inputAudioTokens,
    inputTextTokens,
    outputAudioTokens,
    outputTextTokens,
    rawEventCount: 1,
  });
}

export function hasVoiceUsage(usage: VoiceUsageTelemetry | null | undefined): usage is VoiceUsageTelemetry {
  if (!usage) return false;
  return usage.inputTokens > 0
    || usage.outputTokens > 0
    || usage.inputAudioTokens > 0
    || usage.outputAudioTokens > 0
    || usage.totalTokens > 0
    || usage.transcriptionInputTokens > 0
    || usage.transcriptionOutputTokens > 0;
}
