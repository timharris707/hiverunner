import type { ToolResult } from "@/lib/voice-tool-dispatch";
import {
  formatOperatorTaskStatusLabel,
  replaceTaskStatusTokensInText,
} from "@/lib/orchestration/status-copy";

export const OPENAI_REALTIME_MODEL = "gpt-realtime-2";
export const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export type OpenAiRealtimeReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface OpenAiRealtimeFunctionCall {
  callId: string;
  name: string;
  arguments?: Record<string, unknown>;
}

export type OpenAiRealtimeEvent =
  | { type: "session_ready" }
  | { type: "input_speech_started" }
  | { type: "input_speech_stopped" }
  | { type: "input_transcription"; text: string; usage?: Record<string, unknown> }
  | { type: "output_transcription_delta"; text: string }
  | { type: "output_transcription_done"; text: string }
  | { type: "output_text_delta"; text: string }
  | { type: "response_created" }
  | { type: "response_done"; functionCalls: OpenAiRealtimeFunctionCall[]; outputText: string; usage?: Record<string, unknown> }
  | { type: "response_cancelled" }
  | { type: "error"; message: string }
  | { type: "unknown"; raw: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArguments(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (isRecord(value)) return value;
  if (typeof value !== "string") return undefined;

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function usageRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function extractContentText(content: unknown): string {
  if (!Array.isArray(content)) return "";

  return content
    .flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const rawText = entry.text ?? entry.transcript;
      return typeof rawText === "string" ? [rawText] : [];
    })
    .join("")
    .trim();
}

function extractResponseOutputText(output: unknown): string {
  if (!Array.isArray(output)) return "";

  return output
    .flatMap((item) => {
      if (!isRecord(item)) return [];
      if (typeof item.transcript === "string") return [item.transcript];
      if (typeof item.text === "string") return [item.text];
      return [extractContentText(item.content)];
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractFunctionCalls(output: unknown): OpenAiRealtimeFunctionCall[] {
  if (!Array.isArray(output)) return [];

  return output.flatMap((item) => {
    if (!isRecord(item) || item.type !== "function_call") {
      return [];
    }
    if (typeof item.name !== "string" || typeof item.call_id !== "string") {
      return [];
    }
    return [{
      callId: item.call_id,
      name: item.name,
      arguments: parseArguments(item.arguments),
    }];
  });
}

export function parseOpenAiRealtimeEvent(input: unknown): OpenAiRealtimeEvent {
  if (!isRecord(input) || typeof input.type !== "string") {
    return { type: "unknown", raw: input };
  }

  switch (input.type) {
    case "session.created":
    case "session.updated":
      return { type: "session_ready" };
    case "input_audio_buffer.speech_started":
      return { type: "input_speech_started" };
    case "input_audio_buffer.speech_stopped":
      return { type: "input_speech_stopped" };
    case "conversation.item.input_audio_transcription.completed":
      return {
        type: "input_transcription",
        text: typeof input.transcript === "string" ? input.transcript : "",
        usage: usageRecord(input.usage),
      };
    case "response.output_audio_transcript.delta":
      return { type: "output_transcription_delta", text: typeof input.delta === "string" ? input.delta : "" };
    case "response.output_audio_transcript.done":
      return { type: "output_transcription_done", text: typeof input.transcript === "string" ? input.transcript : "" };
    case "response.output_text.delta":
      return { type: "output_text_delta", text: typeof input.delta === "string" ? input.delta : "" };
    case "response.created":
      return { type: "response_created" };
    case "response.cancelled":
      return { type: "response_cancelled" };
    case "response.done": {
      const response = isRecord(input.response) ? input.response : {};
      return {
        type: "response_done",
        functionCalls: extractFunctionCalls(response.output),
        outputText: extractResponseOutputText(response.output),
        usage: usageRecord(response.usage),
      };
    }
    case "error": {
      const error = isRecord(input.error) ? input.error : {};
      const message = typeof error.message === "string"
        ? error.message
        : typeof input.message === "string"
          ? input.message
          : "OpenAI Realtime session error";
      return { type: "error", message };
    }
    default:
      return { type: "unknown", raw: input };
  }
}

export function buildOpenAiTextMessage(text: string) {
  return {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }],
    },
  };
}

export function buildOpenAiResponseCreate() {
  return { type: "response.create" };
}

function sanitizeToolOutput(value: unknown): unknown {
  if (typeof value === "string") {
    return replaceTaskStatusTokensInText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolOutput(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
        if (["status", "fromStatus", "toStatus"].includes(key)) {
          return [key, formatOperatorTaskStatusLabel(typeof entry === "string" ? entry : null) ?? sanitizeToolOutput(entry)];
        }
        return [key, sanitizeToolOutput(entry)];
      }),
    );
  }

  return value;
}

export function buildOpenAiFunctionOutput(callId: string, result: ToolResult | { status: "success"; output: unknown }) {
  return {
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify({
        status: result.status,
        output: sanitizeToolOutput(result.output),
      }),
    },
  };
}
