import type { VoiceActionIntent } from "@/lib/voice-action-intent";

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
  if (/\b(?:to do|to-do|todo|on deck)\b/.test(normalized)) return "to-do";
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

function wantsStartWork(userText: string): boolean {
  const normalized = normalizeText(userText);
  return (
    /\b(?:start|begin|work|run|execute|pick up|pickup|take|handle)\b/.test(normalized) &&
    /\b(?:this|it|task|working|work|execution)\b/.test(normalized) &&
    !/\b(?:stop|pause|don't|do not|not)\b/.test(normalized)
  );
}

function detectRequestedPriority(userText: string): string | null {
  const normalized = normalizeText(userText);
  const hasPriorityWord = /\bpriority\b|\bpriorit(?:ize|ise)\b/.test(normalized);
  const hasActionVerb = /\b(?:set|make|change|move|bump|raise|lower|mark|put|switch)\b/.test(normalized);

  const pCodeMatch = normalized.match(/\bp[\s-]?([0-3])\b/);
  if (pCodeMatch && (hasPriorityWord || hasActionVerb)) {
    return `P${pCodeMatch[1]}`;
  }

  if (!hasPriorityWord && !hasActionVerb) return null;

  if (/\b(?:urgent|critical|highest)\b/.test(normalized)) return "P0";
  if (hasPriorityWord && /\bhigh\b/.test(normalized)) return "P1";
  if (hasPriorityWord && /\b(?:medium|med|normal)\b/.test(normalized)) return "P2";
  if (hasPriorityWord && /\b(?:low|lowest)\b/.test(normalized)) return "P3";
  return null;
}

function detectReassignAssignee(userText: string): string | null {
  const cleaned = userText.replace(/[“”]/g, '"').replace(/[\n\r]+/g, ' ').trim();
  const lower = cleaned.toLowerCase();
  if (!/\b(?:reassign|re-assign|assign|give|hand(?:\s+(?:this|it|task))?\s+(?:over|off)?\s*(?:to)?)\b/.test(lower)) {
    return null;
  }

  const patterns = [
    /\b(?:reassign|re-assign)\s+(?:this\s+|task\s+|it\s+)?(?:to\s+)?([a-z][a-z0-9 .'_-]{0,40})/i,
    /\bassign\s+(?:this\s+|task\s+|it\s+)?to\s+([a-z][a-z0-9 .'_-]{0,40})/i,
    /\bgive\s+(?:this|it|task)\s+to\s+([a-z][a-z0-9 .'_-]{0,40})/i,
    /\bhand\s+(?:this|it|task)\s+(?:over|off)?\s*to\s+([a-z][a-z0-9 .'_-]{0,40})/i,
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) {
      const raw = match[1]
        .replace(/[?!.,]+\s*$/, '')
        .replace(/\b(?:please|instead|now|for me|okay|ok)\b.*$/i, '')
        .trim();
      const firstWord = raw.split(/\s+/)[0];
      if (firstWord && firstWord.length >= 2) return firstWord;
    }
  }
  return null;
}

function buildSyntheticIntent(turnId: string, now: number, index: number, tool: string, params: Record<string, unknown>): VoiceActionIntent {
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
  existingIntents: VoiceActionIntent[],
): VoiceActionIntent[] {
  const results: VoiceActionIntent[] = [];
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

  if (wantsStartWork(userText) && !existingTools.has("start_task_work") && !existingTools.has("move_task_status")) {
    results.push(buildSyntheticIntent(turnId, now, results.length, "start_task_work", {}));
  }

  if (wantsComment(userText) && !existingTools.has("add_task_comment")) {
    const body = extractQuotedCommentBody(userText) ?? extractImplicitCommentBody(userText);
    if (body) {
      results.push(buildSyntheticIntent(turnId, now, results.length, "add_task_comment", { body }));
    }
  }

  const priority = detectRequestedPriority(userText);
  if (priority && !existingTools.has("set_task_priority")) {
    results.push(buildSyntheticIntent(turnId, now, results.length, "set_task_priority", { priority }));
  }

  const assignee = detectReassignAssignee(userText);
  if (assignee && !existingTools.has("reassign_task")) {
    results.push(buildSyntheticIntent(turnId, now, results.length, "reassign_task", { assignee }));
  }

  return results;
}
