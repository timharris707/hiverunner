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
  style: string;
  pace: string;
  accent: string;
  directorNote: string;
}

interface BaseVoicePreset {
  id: string;
  name: string;
  perceivedGender: VoicePerceivedGender;
  descriptor: string;
  sampleLine: string;
}

const BASE_VOICE_CATALOG = [
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
    sampleLine: "I'm Erinome. Tell me the problem; I'll frame it clearly.",
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
] satisfies readonly BaseVoicePreset[];

type VoiceDirectorProfile = Pick<VoicePreset, "style" | "pace" | "accent" | "directorNote">;

const VOICE_DIRECTOR_PROFILES: Record<string, VoiceDirectorProfile> = {
  Aoede: {
    style: "Warm guide",
    pace: "Natural",
    accent: "General American",
    directorNote: "Warm, lightly animated, friendly, and conversational. Keep vowels bright and pauses short.",
  },
  Kore: {
    style: "Executive brief",
    pace: "Measured",
    accent: "General American",
    directorNote: "Grounded, decisive, and concise. Use a low-distraction briefing cadence with clean sentence endings.",
  },
  Leda: {
    style: "Bright teammate",
    pace: "Quick",
    accent: "General American",
    directorNote: "Youthful, curious, and upbeat. Speak a little faster than neutral without sounding rushed.",
  },
  Zephyr: {
    style: "Crisp operator",
    pace: "Rapid",
    accent: "General American",
    directorNote: "Crisp, energetic, and airy. Use tight turns, little dead air, and a lightly lifted tone.",
  },
  Autonoe: {
    style: "Polished analyst",
    pace: "Natural",
    accent: "Transatlantic-light",
    directorNote: "Polished, clear, and composed. Slightly formal diction, smooth transitions, and controlled warmth.",
  },
  Callirrhoe: {
    style: "Relaxed coach",
    pace: "Natural",
    accent: "Soft West Coast",
    directorNote: "Relaxed and reassuring. Keep sentences clear, conversational, and easygoing without dragging.",
  },
  Despina: {
    style: "Calm facilitator",
    pace: "Natural",
    accent: "General American",
    directorNote: "Soft-edged and steady. Use gentle emphasis, medium-low energy, and clean sentence endings.",
  },
  Erinome: {
    style: "Precise specialist",
    pace: "Measured",
    accent: "Neutral international",
    directorNote: "Articulate, precise, and low-drama. Make lists sound clean and technical language easy to follow.",
  },
  Laomedeia: {
    style: "Engaged producer",
    pace: "Quick",
    accent: "General American",
    directorNote: "Warm, engaged, and productive. Keep momentum high, with a small smile in the voice.",
  },
  Achernar: {
    style: "Soft counselor",
    pace: "Natural",
    accent: "Soft British",
    directorNote: "Gentle, intimate, and considered. Use quieter delivery, rounded phrasing, and a natural cadence.",
  },
  Pulcherrima: {
    style: "Direct lead",
    pace: "Rapid",
    accent: "General American",
    directorNote: "Forward, practical, and action-oriented. Clip filler, drive toward next steps, and sound confident.",
  },
  Vindemiatrix: {
    style: "Patient guide",
    pace: "Natural",
    accent: "General American",
    directorNote: "Gentle and patient. Soften transitions, keep explanations clear, and avoid sounding procedural.",
  },
  Sulafat: {
    style: "Warm host",
    pace: "Natural",
    accent: "Southern-light",
    directorNote: "Welcoming, steady, and warm. Use a mild regional softness without caricature.",
  },
  Charon: {
    style: "News desk",
    pace: "Measured",
    accent: "General American",
    directorNote: "Informative, steady, and trustworthy. Sound like a calm news analyst giving a concise live update.",
  },
  Fenrir: {
    style: "High-energy field lead",
    pace: "Rapid",
    accent: "General American",
    directorNote: "Energetic, gravelly, and memorable. Keep responses short, punchy, and high-commitment.",
  },
  Orus: {
    style: "Formal commander",
    pace: "Measured",
    accent: "Neutral international",
    directorNote: "Firm, polished, and authoritative. Use clear command presence and avoid casual filler.",
  },
  Enceladus: {
    style: "Late-night analyst",
    pace: "Measured",
    accent: "General American",
    directorNote: "Breathy, close-mic, and reflective. Keep complex thoughts composed without dragging the pace.",
  },
  Iapetus: {
    style: "Documentary narrator",
    pace: "Natural",
    accent: "General American",
    directorNote: "Clear, documentary-like, and precise. Make evidence and chronology easy to track.",
  },
  Umbriel: {
    style: "Laid-back partner",
    pace: "Natural",
    accent: "West Coast casual",
    directorNote: "Easy-going and conversational. Sound relaxed, informal, and useful without drifting.",
  },
  Algieba: {
    style: "Smooth narrator",
    pace: "Natural",
    accent: "Soft British",
    directorNote: "Smooth, narrative, and even. Use rounded phrasing and relaxed transitions at a normal pace.",
  },
  Algenib: {
    style: "Gravelly veteran",
    pace: "Staccato",
    accent: "General American",
    directorNote: "Gravelly, lived-in, and direct. Use shorter phrases and distinct pauses between points.",
  },
  Rasalgethi: {
    style: "Briefing-room analyst",
    pace: "Measured",
    accent: "Neutral international",
    directorNote: "Knowledgeable and composed. Sound like a senior analyst summarizing a complex brief.",
  },
  Alnilam: {
    style: "Grounded operator",
    pace: "Staccato",
    accent: "General American",
    directorNote: "Firm and grounded. Use concise sentences, practical framing, and strong endings.",
  },
  Achird: {
    style: "Friendly neighbor",
    pace: "Natural",
    accent: "Midwest-light",
    directorNote: "Friendly, approachable, and warm. Keep it plainspoken and easy to talk to.",
  },
  Zubenelgenubi: {
    style: "Casual collaborator",
    pace: "Natural",
    accent: "General American",
    directorNote: "Casual and off-the-cuff. Use natural contractions and avoid polished corporate cadence.",
  },
  Sadaltager: {
    style: "Thoughtful expert",
    pace: "Measured",
    accent: "Neutral international",
    directorNote: "Deliberate, thoughtful, and knowledgeable. Sound careful with nuance while keeping momentum.",
  },
  Puck: {
    style: "Playful teammate",
    pace: "Rapid",
    accent: "General American",
    directorNote: "Upbeat, quick, and slightly playful. Keep the energy light without becoming silly.",
  },
  Schedar: {
    style: "Neutral coordinator",
    pace: "Measured",
    accent: "Neutral international",
    directorNote: "Balanced, even, and calm. Keep the voice neutral, readable, and reliable.",
  },
  Gacrux: {
    style: "Seasoned mentor",
    pace: "Measured",
    accent: "General American",
    directorNote: "Mature, weathered, and seasoned. Sound like someone who has seen the pattern before, without slowing down.",
  },
  Sadachbia: {
    style: "Animated facilitator",
    pace: "Quick",
    accent: "General American",
    directorNote: "Lively, animated, and expressive. Use more dynamic range while staying concise.",
  },
};

function withDirectorProfile(preset: BaseVoicePreset): VoicePreset {
  const profile = VOICE_DIRECTOR_PROFILES[preset.id];
  return {
    ...preset,
    style: profile?.style ?? "Natural",
    pace: profile?.pace ?? "Natural",
    accent: profile?.accent ?? "General American",
    directorNote: profile?.directorNote ?? "Natural conversational delivery with clear, concise phrasing.",
  };
}

export const VOICE_CATALOG: readonly VoicePreset[] = BASE_VOICE_CATALOG.map(withDirectorProfile);

export function voicePresetById(id: string | null | undefined): VoicePreset | undefined {
  if (!id) return undefined;
  return VOICE_CATALOG.find((v) => v.id === id);
}

export function geminiVoiceDirectorPrompt(preset: VoicePreset): string {
  return [
    `Selected Gemini voice: ${preset.name}.`,
    `Delivery style: ${preset.style}.`,
    `Pace: ${preset.pace}.`,
    `Accent/color: ${preset.accent}.`,
    `Director note: ${preset.directorNote}`,
    "Keep the delivery natural for live conversation. Follow these delivery notes without announcing them to the user.",
  ].join("\n");
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
