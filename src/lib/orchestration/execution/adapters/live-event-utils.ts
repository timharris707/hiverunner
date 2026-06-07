import type { ExecutionLiveEventEmitter } from "./types";

const DEFAULT_LIVE_CHUNK_PREVIEW_CHARS = 700;
const DEFAULT_LIVE_CHUNK_MIN_INTERVAL_MS = 500;

function chunkText(chunk: Buffer | string): string {
  return typeof chunk === "string" ? chunk : chunk.toString("utf8");
}

function chunkPreview(chunk: Buffer | string, maxChars: number): string {
  const text = chunkText(chunk);
  const trimmed = text.trim();
  const preview = trimmed || `[${Buffer.byteLength(text)} bytes]`;
  if (preview.length <= maxChars) return preview;
  return preview.slice(-maxChars);
}

export function createAdapterLiveChunkEmitter(
  emitLiveEvent: ExecutionLiveEventEmitter | undefined,
  input: {
    kind: "stdout_chunk" | "stderr_chunk";
    provider: string;
    stream: "stdout" | "stderr";
    summaryPrefix: string;
    startedAt: number;
    providerMeta?: Record<string, unknown>;
    previewChars?: number;
    minIntervalMs?: number;
  },
) {
  const previewChars = input.previewChars ?? DEFAULT_LIVE_CHUNK_PREVIEW_CHARS;
  const minIntervalMs = input.minIntervalMs ?? DEFAULT_LIVE_CHUNK_MIN_INTERVAL_MS;
  let emittedCount = 0;
  let lastEmitAt = 0;
  let pendingChunk: Buffer | string | null = null;
  let pendingSuppressedCount = 0;

  const emitChunk = (chunk: Buffer | string, suppressedCount: number) => {
    const text = chunkText(chunk);
    const byteLength = Buffer.byteLength(text);
    emitLiveEvent?.({
      kind: input.kind,
      summary: `${input.summaryPrefix} ${input.stream} ${byteLength} bytes`,
      provider: input.provider,
      payload: {
        chunk: chunkPreview(chunk, previewChars),
        byteLength,
      },
      providerMeta: {
        ...input.providerMeta,
        stream: input.stream,
        elapsedMs: Date.now() - input.startedAt,
        suppressedChunkCount: suppressedCount,
      },
    });
  };

  return {
    push(chunk: Buffer | string) {
      if (!emitLiveEvent) return;
      const now = Date.now();
      if (emittedCount === 0 || now - lastEmitAt >= minIntervalMs) {
        emitChunk(chunk, pendingSuppressedCount);
        emittedCount += 1;
        lastEmitAt = now;
        pendingChunk = null;
        pendingSuppressedCount = 0;
        return;
      }
      pendingChunk = chunk;
      pendingSuppressedCount += 1;
    },
    flush() {
      if (!emitLiveEvent || pendingChunk === null) return;
      emitChunk(pendingChunk, pendingSuppressedCount);
      pendingChunk = null;
      pendingSuppressedCount = 0;
      emittedCount += 1;
      lastEmitAt = Date.now();
    },
  };
}
