import type { ToolRequest, ToolResult } from "@/lib/voice-tool-dispatch";
import {
  formatOperatorTaskStatusLabel,
  replaceTaskStatusTokensInText,
} from "@/lib/orchestration/status-copy";
import { isVoiceToolName } from "@/lib/voice-tool-manifest";

export interface GeminiLiveFunctionCall {
  id: string;
  name: string;
  args?: Record<string, unknown>;
}

function normalizeArgs(value: unknown): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

export function normalizeLiveFunctionCalls(input: unknown): GeminiLiveFunctionCall[] {
  const functionCalls =
    input && typeof input === "object" && Array.isArray((input as { functionCalls?: unknown[] }).functionCalls)
      ? (input as { functionCalls: unknown[] }).functionCalls
      : Array.isArray(input)
        ? input
        : [];

  return functionCalls.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const raw = entry as { id?: unknown; name?: unknown; args?: unknown };
    if (typeof raw.id !== "string" || typeof raw.name !== "string") {
      return [];
    }

    return [{
      id: raw.id,
      name: raw.name,
      args: normalizeArgs(raw.args),
    }];
  });
}

export function toLiveToolRequest(call: GeminiLiveFunctionCall): ToolRequest | null {
  if (!isVoiceToolName(call.name)) {
    return null;
  }

  return {
    tool: call.name,
    params: call.args,
  };
}

function sanitizeToolResponseOutput(value: unknown): unknown {
  if (typeof value === "string") {
    return replaceTaskStatusTokensInText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolResponseOutput(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
        if (["status", "fromStatus", "toStatus"].includes(key)) {
          return [key, formatOperatorTaskStatusLabel(typeof entry === "string" ? entry : null) ?? sanitizeToolResponseOutput(entry)];
        }
        return [key, sanitizeToolResponseOutput(entry)];
      }),
    );
  }

  return value;
}

export function buildToolResponseMessage(
  responses: Array<{ id: string; name: string; result: ToolResult }>,
) {
  return {
    toolResponse: {
      functionResponses: responses.map(({ id, name, result }) => ({
        id,
        name,
        response: {
          status: result.status,
          output: sanitizeToolResponseOutput(result.output),
        },
      })),
    },
  };
}
