/**
 * Curated Gemini Live prebuilt voices surfaced in the Avatar Wizard.
 * voiceId matches the `prebuiltVoiceConfig.voiceName` Gemini expects at session setup.
 */
export type VoicePerceivedGender = "female" | "male" | "androgynous";

export interface VoicePreset {
  id: string;
  name: string;
  perceivedGender: VoicePerceivedGender;
  descriptor: string;
  sampleLine: string;
}

export const VOICE_CATALOG: readonly VoicePreset[] = [
  {
    id: "Aoede",
    name: "Aoede",
    perceivedGender: "female",
    descriptor: "Bright and expressive — warm, a touch theatrical.",
    sampleLine: "Hi — I'm Aoede. Let's get some good work done today.",
  },
  {
    id: "Kore",
    name: "Kore",
    perceivedGender: "female",
    descriptor: "Confident alto — grounded, clear, no-nonsense.",
    sampleLine: "Kore here. Tell me what you need and I'll get moving.",
  },
  {
    id: "Leda",
    name: "Leda",
    perceivedGender: "female",
    descriptor: "Soft and thoughtful — measured, reassuring.",
    sampleLine: "I'm Leda. I'll think this through with you carefully.",
  },
  {
    id: "Puck",
    name: "Puck",
    perceivedGender: "androgynous",
    descriptor: "Playful and youthful — light, quick, a little cheeky.",
    sampleLine: "Puck reporting in — let's figure this out.",
  },
  {
    id: "Charon",
    name: "Charon",
    perceivedGender: "male",
    descriptor: "Deep and authoritative — steady, trustworthy.",
    sampleLine: "Charon here. I've got the details. Where do we start?",
  },
  {
    id: "Fenrir",
    name: "Fenrir",
    perceivedGender: "male",
    descriptor: "Gravelly and commanding — leaves an impression.",
    sampleLine: "Fenrir. I'll keep this direct and to the point.",
  },
  {
    id: "Orus",
    name: "Orus",
    perceivedGender: "male",
    descriptor: "Crisp and professional — polished briefing tone.",
    sampleLine: "Orus speaking. Ready for a focused session.",
  },
  {
    id: "Zephyr",
    name: "Zephyr",
    perceivedGender: "male",
    descriptor: "Smooth and measured — calm, narrative cadence.",
    sampleLine: "I'm Zephyr. Tell me the context and I'll take it from there.",
  },
];

export function voicePresetById(id: string | null | undefined): VoicePreset | undefined {
  if (!id) return undefined;
  return VOICE_CATALOG.find((v) => v.id === id);
}
