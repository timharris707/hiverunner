/**
 * Avatar generation provider abstraction.
 *
 * Supports AI-generated portrait previews.
 * If no image provider is configured, callers should use the basic icon path.
 */

import OpenAI from "openai";

import { getSecret, hasSecret } from "@/lib/secrets";

/* ═══════════════════════════════════════════
   Provider detection
   ═══════════════════════════════════════════ */

export type AvatarProviderType = "local" | "openai" | "replicate";

export interface AvatarProviderStatus {
  /** Which provider is active */
  provider: AvatarProviderType;
  /** Human-readable label */
  label: string;
  /** Whether AI generation is available */
  aiAvailable: boolean;
  /** Setup hint if AI is not available */
  setupHint?: string;
}

/**
 * Detect which avatar generation provider is available.
 * Checks env vars at call time (not import time) so hot-reload works.
 */
export function detectAvatarProvider(): AvatarProviderStatus {
  // Check OpenAI (DALL-E / gpt-image-1)
  if (hasSecret("OPENAI_API_KEY")) {
    return {
      provider: "openai",
      label: "OpenAI (DALL-E)",
      aiAvailable: true,
    };
  }

  // Check Replicate (Flux etc.)
  if (process.env.REPLICATE_API_TOKEN) {
    return {
      provider: "replicate",
      label: "Replicate (not implemented)",
      aiAvailable: false,
      setupHint:
        "Replicate avatar generation is not implemented in this build. Add OPENAI_API_KEY to enable generated portraits.",
    };
  }

  return {
    provider: "local",
    label: "AI image generation unavailable",
    aiAvailable: false,
    setupHint:
      "To enable generated portrait avatars, add OPENAI_API_KEY via environment config or local keychain integration. Otherwise use a basic icon.",
  };
}

/* ═══════════════════════════════════════════
   Generation input
   ═══════════════════════════════════════════ */

export interface AvatarGenerationInput {
  agentName: string;
  agentRole: string;
  agentEmoji: string;
  agentPersonality: string;
  styleId: string;
  gender: string;
  count: number;
  age?: number | null;
  hairColor?: string | null;
  hairLength?: string | null;
  eyeColor?: string | null;
  vibe?: string | null;
}

export interface AvatarGenerationResult {
  previews: string[];
  provider: AvatarProviderType;
  /** Whether these previews came from an AI image provider. */
  isAiGenerated: boolean;
}

/* ═══════════════════════════════════════════
   Generate avatars (dispatches to provider)
   ═══════════════════════════════════════════ */

export async function generateAvatarPreviews(
  input: AvatarGenerationInput
): Promise<AvatarGenerationResult> {
  const status = detectAvatarProvider();

  if (status.provider === "openai" && hasSecret("OPENAI_API_KEY")) {
    return generateWithOpenAI(input);
  }

  throw new Error(status.setupHint ?? "Generated portrait avatars require an AI image provider.");
}

/* ═══════════════════════════════════════════
   OpenAI prompt generation
   ═══════════════════════════════════════════ */

function buildOpenAiPrompt(input: AvatarGenerationInput): string {
  const stylePrompts: Record<string, string> = {
    "cyber-organic":
      "CYBER-ORGANIC augmented-human portrait. Photorealistic human face (this is essential — NOT anime, NOT painterly, NOT stylized). Subtle glowing circuitry traced like luminescent tattoos across the temple, cheekbone, and jawline on ONE side of the face. Eyes are the focal point: luminescent iridescent irises (yellow, green, amber, or cyan — glowing softly from within). Visible cybernetic plating along the neck or partial collarbone — clean chrome-and-light hardware, like the character is part organic, part machine. Wardrobe: a casual hoodie (mint, teal, olive, or charcoal), relaxed and humanizing. Backdrop: a saturated monochromatic gradient in teal, mint, or green that echoes the glow color on the face. Cinematic soft rim lighting. Head-and-shoulders framing, centered, confident gaze. Aesthetic reference: high-end AI character concept art — think photoreal skin with delicate tech overlays, not a full robot.",
    cyberpunk:
      "neon-lit cyberpunk street portrait: rain-slick surfaces, distant kanji and holographic signage as bokeh, vibrant magenta/cyan rim lighting carving the face from the dark, slightly angular crop, head-and-shoulders framing, premium cinematic tone",
    "sci-fi-crew":
      "polished starship crew portrait: crisp uniform with subtle holographic insignia, clean studio lighting, dark ship-interior backdrop with muted blue accents, composed and confident expression, head-and-shoulders framing, premium concept-art finish",
    "fantasy-guild":
      "painterly fantasy guild portrait: worn leather and embroidered robes, weathered yet heroic expression, warm hearth-lit backdrop with amber glow, brush-stroke texture visible, head-and-shoulders framing in the style of premium illustrated RPG character art",
    "anime-studio":
      "premium anime studio key-art portrait: expressive large eyes with bright catchlights, dynamic stylized hair, crisp line art with cel-shaded soft lighting, head-and-shoulders framing on a saturated gradient backdrop, cinematic composition",
    watercolor:
      "soft watercolor portrait: visible brush textures and paper grain, muted pastel palette with tasteful color bleeds along edges, gentle editorial lighting, head-and-shoulders framing on a cream background, feels hand-painted",
    "minimal-steel":
      "editorial black-and-white studio portrait: high-contrast grayscale with controlled highlights, clean modern wardrobe, simple charcoal backdrop, crisp head-and-shoulders framing, feels like a premium magazine cover",
  };

  const genderText =
    input.gender === "androgynous"
      ? "androgynous or gender-neutral"
      : input.gender;

  const stylePrompt = stylePrompts[input.styleId] ?? stylePrompts["cyber-organic"];

  const ageFragment =
    typeof input.age === "number" && Number.isFinite(input.age)
      ? `, appearing roughly ${Math.round(input.age)} years old`
      : "";

  const hairBits: string[] = [];
  if (input.hairColor?.trim()) hairBits.push(input.hairColor.trim());
  if (input.hairLength?.trim()) hairBits.push(input.hairLength.trim());
  const hairFragment = hairBits.length > 0 ? `Hair: ${hairBits.join(" ")}.` : "";

  const eyeFragment = input.eyeColor?.trim() ? `Eyes: ${input.eyeColor.trim()}.` : "";
  const vibeFragment = input.vibe?.trim() ? `Character vibe: ${input.vibe.trim()}.` : "";

  return [
    "ABSOLUTELY NO TEXT, LETTERS, WORDS, NAMES, CAPTIONS, LABELS, NUMBERS, WATERMARKS, OR UI OVERLAYS ANYWHERE IN THE IMAGE. The output is a pure portrait — no written language of any kind, no signage, no insignia text, no name plates, no hud, no chrome.",
    "Create a single square avatar portrait for an AI agent.",
    `The character should feel like a ${genderText} ${input.agentRole}${ageFragment}.`,
    stylePrompt,
    hairFragment,
    eyeFragment,
    vibeFragment,
    "This must be a true portrait image, not an icon, glyph, logo, flat SVG, mascot badge, or abstract placeholder.",
    "Show head-and-shoulders only. Strong face visibility. Professional composition for a profile picture.",
    "Keep the subject centered and readable at small sizes.",
    "Final reminder: zero rendered text of any kind. If your draft contains any letters, numbers, or words, regenerate without them.",
    input.agentPersonality ? `Additional personality cues: ${input.agentPersonality}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function generateWithOpenAI(
  input: AvatarGenerationInput
): Promise<AvatarGenerationResult> {
  const apiKey = getSecret("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not available");
  }

  const client = new OpenAI({ apiKey });
  const count = Math.max(1, Math.min(4, Math.trunc(input.count)));
  const previews: string[] = [];

  for (let i = 0; i < count; i++) {
    const response = await client.images.generate({
      model: "gpt-image-1",
      prompt: `${buildOpenAiPrompt(input)} Variation ${i + 1} of ${count}; keep the same style but produce a distinct face, hairstyle, pose nuance, and lighting balance.`,
      size: "1024x1024",
    });

    const image = response.data?.[0];
    const b64 = image?.b64_json;
    const url = image?.url;
    if (b64) {
      previews.push(`data:image/png;base64,${b64}`);
    } else if (url) {
      previews.push(url);
    }
  }

  if (previews.length === 0) {
    throw new Error("OpenAI image generation returned no previews");
  }

  return {
    previews,
    provider: "openai",
    isAiGenerated: true,
  };
}
