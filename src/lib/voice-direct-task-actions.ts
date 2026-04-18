import type { HenryActionIntent } from "@/lib/voice-action-intent";

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[“”]/g, '"').replace(/[^a-z0-9'"\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function detectRequestedStatus(userText: string): string | null {
  const normalized = normalizeText(userText);
  const hasActionVerb = /\b(?:change|move|set|mark|put|switch)\b/.test(normalized);
  if (!hasActionVerb) {
    return null;
  }

  if (/\b(?:done|complete|completed|closed)\b/.test(normalized)) return "done";
  if (/\b(?:to do|to-do|todo|on deck)\b/.test(normalized)) return "on-deck";
  if (/\b(?:in progress|in-progress|active|working)\b/.test(normalized)) return "in-progress";
  if (/\bblocked\b|\bwaiting\b/.test(normalized)) return "blocked";
  if (/\breview\b/.test(normalized)) return "review";
  return null;
}

function extractQuotedCommentBody(userText: string): string | null {
  const match = userText.replace(/[“”]/g, '"').match(/"([^"]{2,})"/);
  return match?.[1]?.trim() || null;
}

function extractImplicitCommentBody(userText: string): string | null {
  const normalized = userText.replace(/[\n\r]+/g, ' ').trim();
  const lower = normalized.toLowerCase();
  const thatIdx = lower.indexOf(' that ');
  if (thatIdx >= 0) {
    const raw = normalized.slice(thatIdx + 6).trim();
    return raw.replace(/^(says?|said)\s+/i, '').replace(/[?!.]\s*$/, '').replace(/,?\s*(okay|ok|please|can you do that|can you do it|for me)\s*$/i, '').trim() || null;
  }
  const sayIdx = lower.indexOf('say ');
  if (sayIdx >= 0) {
    const raw = normalized.slice(sayIdx + 4).trim();
    return raw.replace(/^(something like\s+)/i, '').replace(/[?!.]\s*$/, '').trim() || null;
  }
  return null;
}

function wantsComment(userText: string): boolean {
  const normalized = normalizeText(userText);
  return /\b(?:comment|note|notes)\b/.test(normalized) && /\b(?:leave|add|post|put|update|write|say)\b/.test(normalized);
}

function buildSyntheticIntent(turnId: string, now: number, index: number, tool: string, params: Record<string, unknown>): HenryActionIntent {
  return {
    id: `${turnId}:synthetic:${index}`,
    name: "tool.request",
    createdAt: now,
    confidence: 0.95,
    payload: { tool, params },
    sourceText: "<synthetic_direct_task_action>",
    status: "proposed",
  };
}

export function synthesizeDirectTaskActionIntents(
  userText: string,
  turnId: string,
  now: number,
  existingIntents: HenryActionIntent[],
): HenryActionIntent[] {
  const results: HenryActionIntent[] = [];
  const existingTools = new Set(
    existingIntents
      .filter((intent) => intent.name === "tool.request")
      .map((intent) => String(intent.payload.tool ?? "").trim())
      .filter(Boolean),
  );

  const status = detectRequestedStatus(userText);
  if (status && !existingTools.has("move_task_status")) {
    results.push(buildSyntheticIntent(turnId, now, results.length, "move_task_status", { status }));
  }

  if (wantsComment(userText) && !existingTools.has("add_task_comment")) {
    const body = extractQuotedCommentBody(userText) ?? extractImplicitCommentBody(userText);
    if (body) {
      results.push(buildSyntheticIntent(turnId, now, results.length, "add_task_comment", { body }));
    }
  }

  return results;
}
