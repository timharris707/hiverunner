export type VoiceActionIntentName = "session.marker" | "tool.request" | "ui.signal";

export interface VoiceActionIntent {
  id: string;
  name: VoiceActionIntentName;
  createdAt: number;
  confidence: number;
  payload: Record<string, unknown>;
  sourceText: string;
  status: "proposed" | "acknowledged" | "rejected";
}

interface RawIntent {
  name?: unknown;
  confidence?: unknown;
  payload?: unknown;
}

const INTENT_TAG_REGEX = /<voice_action>([\s\S]*?)<\/voice_action>/g;
const VALID_INTENTS: VoiceActionIntentName[] = ["session.marker", "tool.request", "ui.signal"];

export function extractActionIntents(text: string, turnId: string, now = Date.now()): {
  cleanedText: string;
  intents: VoiceActionIntent[];
} {
  if (!text.includes("<voice_action>")) {
    return { cleanedText: text, intents: [] };
  }

  const intents: VoiceActionIntent[] = [];
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = INTENT_TAG_REGEX.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as RawIntent;
      if (!VALID_INTENTS.includes(parsed.name as VoiceActionIntentName)) continue;
      intents.push({
        id: `${turnId}:intent:${idx++}`,
        name: parsed.name as VoiceActionIntentName,
        createdAt: now,
        confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
        payload: typeof parsed.payload === "object" && parsed.payload ? (parsed.payload as Record<string, unknown>) : {},
        sourceText: match[0],
        status: "proposed",
      });
    } catch {
      // Ignore malformed tags; they remain in cleaned text only if replacement fails.
    }
  }

  const cleanedText = text.replace(INTENT_TAG_REGEX, "").trim();
  return { cleanedText, intents };
}
