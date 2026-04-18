/**
 * Curated Gemini Live prebuilt voices surfaced in the Avatar Wizard.
 * voiceId matches the `prebuiltVoiceConfig.voiceName` Gemini expects at session setup.
 *
 * Google does not publish perceived gender for these voices — tags below are
 * best-effort from descriptor + community-observed audio. Operators can
 * preview each one before committing, and we can re-tag if any sound wrong.
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
  // ── Feminine-perceived ──
  {
    id: "Aoede",
    name: "Aoede",
    perceivedGender: "female",
    descriptor: "Breezy — warm, light on its feet.",
    sampleLine: "Hi, I'm Aoede. Let's get some good work done today.",
  },
  {
    id: "Kore",
    name: "Kore",
    perceivedGender: "female",
    descriptor: "Firm — grounded, clear, no-nonsense.",
    sampleLine: "Kore here. Tell me what you need and I'll get moving.",
  },
  {
    id: "Leda",
    name: "Leda",
    perceivedGender: "female",
    descriptor: "Youthful — bright, a little eager.",
    sampleLine: "I'm Leda. Ready to dig into this with you.",
  },
  {
    id: "Zephyr",
    name: "Zephyr",
    perceivedGender: "female",
    descriptor: "Bright — crisp, energetic.",
    sampleLine: "Zephyr checking in. Where do you want to start?",
  },
  {
    id: "Autonoe",
    name: "Autonoe",
    perceivedGender: "female",
    descriptor: "Bright — polished and lifted.",
    sampleLine: "Autonoe here. Give me the shortlist and I'll take it from there.",
  },
  {
    id: "Callirrhoe",
    name: "Callirrhoe",
    perceivedGender: "female",
    descriptor: "Easy-going — relaxed, unhurried.",
    sampleLine: "Hey, I'm Callirrhoe. No rush — walk me through it.",
  },
  {
    id: "Despina",
    name: "Despina",
    perceivedGender: "female",
    descriptor: "Smooth — soft edges, even tone.",
    sampleLine: "Despina. Happy to talk this through at whatever pace you want.",
  },
  {
    id: "Erinome",
    name: "Erinome",
    perceivedGender: "female",
    descriptor: "Clear — articulate and precise.",
    sampleLine: "I'm Erinome. Tell me the problem and I'll help you frame it.",
  },
  {
    id: "Laomedeia",
    name: "Laomedeia",
    perceivedGender: "female",
    descriptor: "Upbeat — warm and engaged.",
    sampleLine: "Laomedeia here. Let's dig in — what are we working on?",
  },
  {
    id: "Achernar",
    name: "Achernar",
    perceivedGender: "female",
    descriptor: "Soft — gentle, considered delivery.",
    sampleLine: "Achernar. I'll take my time and get this right with you.",
  },
  {
    id: "Pulcherrima",
    name: "Pulcherrima",
    perceivedGender: "female",
    descriptor: "Forward — direct, leans in.",
    sampleLine: "Pulcherrima. Tell me the target and I'll push us toward it.",
  },
  {
    id: "Vindemiatrix",
    name: "Vindemiatrix",
    perceivedGender: "female",
    descriptor: "Gentle — calming, patient.",
    sampleLine: "I'm Vindemiatrix. Take your time — I'm listening.",
  },
  {
    id: "Sulafat",
    name: "Sulafat",
    perceivedGender: "female",
    descriptor: "Warm — welcoming, steady.",
    sampleLine: "Sulafat here. Happy to help — where are we starting?",
  },

  // ── Masculine-perceived ──
  {
    id: "Charon",
    name: "Charon",
    perceivedGender: "male",
    descriptor: "Informative — steady, trustworthy baritone.",
    sampleLine: "Charon here. I've got the details. Where do we start?",
  },
  {
    id: "Fenrir",
    name: "Fenrir",
    perceivedGender: "male",
    descriptor: "Excitable — gravelly, leaves an impression.",
    sampleLine: "Fenrir. I'll keep this direct and to the point.",
  },
  {
    id: "Orus",
    name: "Orus",
    perceivedGender: "male",
    descriptor: "Firm — polished briefing tone.",
    sampleLine: "Orus speaking. Ready for a focused session.",
  },
  {
    id: "Enceladus",
    name: "Enceladus",
    perceivedGender: "male",
    descriptor: "Breathy — measured, close-mic warmth.",
    sampleLine: "Enceladus. Let me know what we're working with.",
  },
  {
    id: "Iapetus",
    name: "Iapetus",
    perceivedGender: "male",
    descriptor: "Clear — precise, documentary feel.",
    sampleLine: "I'm Iapetus. I'll keep the thread tight while we work.",
  },
  {
    id: "Umbriel",
    name: "Umbriel",
    perceivedGender: "male",
    descriptor: "Easy-going — laid-back, conversational.",
    sampleLine: "Umbriel. Take it from the top when you're ready.",
  },
  {
    id: "Algieba",
    name: "Algieba",
    perceivedGender: "male",
    descriptor: "Smooth — even, narrative cadence.",
    sampleLine: "Algieba here. Happy to walk through this with you.",
  },
  {
    id: "Algenib",
    name: "Algenib",
    perceivedGender: "male",
    descriptor: "Gravelly — lived-in, distinctive.",
    sampleLine: "Algenib. Give me the short version and I'll dig from there.",
  },
  {
    id: "Rasalgethi",
    name: "Rasalgethi",
    perceivedGender: "male",
    descriptor: "Informative — briefing-room tone.",
    sampleLine: "Rasalgethi. I'll lay out what I know and we'll go from there.",
  },
  {
    id: "Alnilam",
    name: "Alnilam",
    perceivedGender: "male",
    descriptor: "Firm — confident, grounded.",
    sampleLine: "Alnilam here. Set the priority and I'll move on it.",
  },
  {
    id: "Achird",
    name: "Achird",
    perceivedGender: "male",
    descriptor: "Friendly — approachable, warm baritone.",
    sampleLine: "Hey, I'm Achird. Where can I help?",
  },
  {
    id: "Zubenelgenubi",
    name: "Zubenelgenubi",
    perceivedGender: "male",
    descriptor: "Casual — off-the-cuff, unfussy.",
    sampleLine: "Zubenelgenubi. Toss me whatever you've got and we'll figure it out.",
  },
  {
    id: "Sadaltager",
    name: "Sadaltager",
    perceivedGender: "male",
    descriptor: "Knowledgeable — deliberate, thoughtful.",
    sampleLine: "Sadaltager. Give me the context and I'll reason through it with you.",
  },

  // ── Androgynous / harder to place ──
  {
    id: "Puck",
    name: "Puck",
    perceivedGender: "androgynous",
    descriptor: "Upbeat — light, quick, a little cheeky.",
    sampleLine: "Puck reporting in — let's figure this out.",
  },
  {
    id: "Schedar",
    name: "Schedar",
    perceivedGender: "androgynous",
    descriptor: "Even — balanced, neutral delivery.",
    sampleLine: "Schedar. Calm and steady — where do we start?",
  },
  {
    id: "Gacrux",
    name: "Gacrux",
    perceivedGender: "androgynous",
    descriptor: "Mature — weathered, seasoned.",
    sampleLine: "Gacrux. I've seen a few loops like this. Let's unwind it.",
  },
  {
    id: "Sadachbia",
    name: "Sadachbia",
    perceivedGender: "androgynous",
    descriptor: "Lively — animated, dynamic range.",
    sampleLine: "Sadachbia here — let's get into it.",
  },
];

export function voicePresetById(id: string | null | undefined): VoicePreset | undefined {
  if (!id) return undefined;
  return VOICE_CATALOG.find((v) => v.id === id);
}

/**
 * Voices to surface in the wizard for a given agent gender. Strict filter:
 * female agents see only feminine-perceived voices, male only masculine.
 * Androgynous agents see everything so the "genderless" bucket is still usable.
 */
export function voicesForGender(
  gender: "female" | "male" | "androgynous" | undefined
): readonly VoicePreset[] {
  if (!gender || gender === "androgynous") return VOICE_CATALOG;
  return VOICE_CATALOG.filter((v) => v.perceivedGender === gender);
}
