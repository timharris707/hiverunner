/**
 * Avatar generation provider abstraction.
 *
 * Supports two modes:
 *   1. **Local SVG** (always available, zero dependencies) — deterministic styled SVG portraits
 *   2. **AI provider** (optional) — calls an external image generation API
 *
 * The AI provider is enabled only when env vars are configured.
 * The app works fully without any provider key.
 */

import { createHash, randomUUID } from "crypto";
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
      label: "Replicate (Flux)",
      aiAvailable: true,
    };
  }

  // Fallback: local SVG generation (always works)
  return {
    provider: "local",
    label: "Local SVG (built-in)",
    aiAvailable: false,
    setupHint:
      "To enable AI-generated avatars, add OPENAI_API_KEY or REPLICATE_API_TOKEN via environment config or local keychain integration. " +
      "See docs/AVATAR_SYSTEM.md for details.",
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
  /** Whether these are AI-generated or local SVGs */
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
    try {
      return await generateWithOpenAI(input);
    } catch {
      return generateLocalSvg(input, "local");
    }
  }

  return generateLocalSvg(input, status.provider);
}

/* ═══════════════════════════════════════════
   Local SVG generation (always available)
   ═══════════════════════════════════════════ */

/* ── Style palettes ── */
const STYLE_PALETTES: Record<
  string,
  { bg: [string, string]; orb: string; fg: string; accent: string }
> = {
  "cyber-organic": {
    bg: ["#0a1a1a", "#083838"],
    orb: "#2dd4bf",
    fg: "#5eead4",
    accent: "#fbbf24",
  },
  cyberpunk: {
    bg: ["#0f172a", "#1e1b4b"],
    orb: "#06b6d4",
    fg: "#22d3ee",
    accent: "#a78bfa",
  },
  "sci-fi-crew": {
    bg: ["#0c1527", "#1e293b"],
    orb: "#3b82f6",
    fg: "#60a5fa",
    accent: "#818cf8",
  },
  "fantasy-guild": {
    bg: ["#2d1810", "#451a03"],
    orb: "#f59e0b",
    fg: "#fbbf24",
    accent: "#ef4444",
  },
  watercolor: {
    bg: ["#1e1338", "#312e81"],
    orb: "#c084fc",
    fg: "#e9d5ff",
    accent: "#f9a8d4",
  },
  "anime-studio": {
    bg: ["#1a0625", "#3b0764"],
    orb: "#e879f9",
    fg: "#f5d0fe",
    accent: "#fb923c",
  },
  "minimal-steel": {
    bg: ["#111111", "#1a1a1a"],
    orb: "#525252",
    fg: "#e5e5e5",
    accent: "#737373",
  },
};

/* ── Gender appearance modifiers ── */
const GENDER_SHAPES: Record<
  string,
  { faceShape: string; hairStyle: string }
> = {
  male: {
    faceShape:
      "M 200 115 Q 240 100 280 115 Q 310 165 300 230 Q 270 270 240 275 Q 210 270 180 230 Q 170 165 200 115 Z",
    hairStyle:
      "M 185 120 Q 200 80 240 70 Q 280 80 295 120 Q 285 100 240 95 Q 195 100 185 120 Z",
  },
  female: {
    faceShape:
      "M 205 120 Q 240 108 275 120 Q 300 168 290 228 Q 265 268 240 272 Q 215 268 190 228 Q 180 168 205 120 Z",
    hairStyle:
      "M 175 130 Q 190 70 240 55 Q 290 70 305 130 Q 310 95 300 70 Q 275 40 240 35 Q 205 40 180 70 Q 170 95 175 130 Z M 175 130 Q 165 180 170 230 Q 175 200 180 170 Z M 305 130 Q 315 180 310 230 Q 305 200 300 170 Z",
  },
  androgynous: {
    faceShape:
      "M 202 118 Q 240 105 278 118 Q 305 166 295 228 Q 268 266 240 270 Q 212 266 185 228 Q 175 166 202 118 Z",
    hairStyle:
      "M 180 125 Q 195 75 240 65 Q 285 75 300 125 Q 290 90 240 82 Q 190 90 180 125 Z",
  },
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hashToNum(seed: string, offset: number, range: number): number {
  const hex = seed.slice(offset, offset + 4);
  return parseInt(hex, 16) % range;
}

function generateSingleAvatarSvg(input: {
  name: string;
  role: string;
  styleId: string;
  gender: string;
  seed: string;
}): string {
  const seedHash = createHash("sha256")
    .update(
      [input.styleId, input.name, input.role, input.gender, input.seed].join(
        "::"
      )
    )
    .digest("hex");

  const palette =
    STYLE_PALETTES[input.styleId] ?? STYLE_PALETTES["corporate-noir"];
  const genderShape =
    GENDER_SHAPES[input.gender] ?? GENDER_SHAPES.androgynous;

  const eyeX = 8 + hashToNum(seedHash, 0, 6);
  const mouthCurve = hashToNum(seedHash, 4, 12) - 4;
  const orbX = 30 + hashToNum(seedHash, 8, 40);
  const orbY = 20 + hashToNum(seedHash, 12, 30);
  const patternRotation = hashToNum(seedHash, 16, 360);
  const shoulderWidth = 120 + hashToNum(seedHash, 20, 40);

  const initials =
    input.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "AG";

  const escapedRole = escapeXml(input.role.slice(0, 24));
  const escapedStyle = escapeXml(
    (input.styleId ?? "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .slice(0, 20)
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480" role="img" aria-label="Agent avatar">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stop-color="${palette.bg[0]}" />
      <stop offset="100%" stop-color="${palette.bg[1]}" />
    </linearGradient>
    <radialGradient id="orb" cx="${orbX}%" cy="${orbY}%" r="50%">
      <stop offset="0%" stop-color="${palette.orb}" stop-opacity="0.35" />
      <stop offset="100%" stop-color="${palette.orb}" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="skin" cx="50%" cy="35%" r="55%">
      <stop offset="0%" stop-color="${palette.fg}" stop-opacity="0.25" />
      <stop offset="100%" stop-color="${palette.bg[1]}" stop-opacity="0.6" />
    </radialGradient>
    <clipPath id="circle"><circle cx="240" cy="240" r="240"/></clipPath>
  </defs>
  <rect width="480" height="480" fill="url(#bg)" clip-path="url(#circle)"/>
  <rect width="480" height="480" fill="url(#orb)" clip-path="url(#circle)"/>
  <g opacity="0.04" transform="rotate(${patternRotation} 240 240)">
    <line x1="0" y1="120" x2="480" y2="120" stroke="${palette.fg}" stroke-width="1"/>
    <line x1="0" y1="240" x2="480" y2="240" stroke="${palette.fg}" stroke-width="1"/>
    <line x1="0" y1="360" x2="480" y2="360" stroke="${palette.fg}" stroke-width="1"/>
    <line x1="120" y1="0" x2="120" y2="480" stroke="${palette.fg}" stroke-width="1"/>
    <line x1="240" y1="0" x2="240" y2="480" stroke="${palette.fg}" stroke-width="1"/>
    <line x1="360" y1="0" x2="360" y2="480" stroke="${palette.fg}" stroke-width="1"/>
  </g>
  <ellipse cx="240" cy="420" rx="${shoulderWidth}" ry="80" fill="url(#skin)" stroke="${palette.accent}" stroke-width="1.5" stroke-opacity="0.3"/>
  <rect x="222" y="272" width="36" height="40" rx="8" fill="url(#skin)" opacity="0.8"/>
  <path d="${genderShape.faceShape}" fill="url(#skin)" stroke="${palette.accent}" stroke-width="1.5" stroke-opacity="0.25"/>
  <path d="${genderShape.hairStyle}" fill="${palette.accent}" fill-opacity="0.5" stroke="${palette.accent}" stroke-width="0.8" stroke-opacity="0.3"/>
  <ellipse cx="${240 - eyeX - 12}" cy="178" rx="8" ry="6" fill="${palette.fg}" opacity="0.9"/>
  <ellipse cx="${240 + eyeX + 12}" cy="178" rx="8" ry="6" fill="${palette.fg}" opacity="0.9"/>
  <circle cx="${240 - eyeX - 12}" cy="177" r="3.5" fill="${palette.accent}"/>
  <circle cx="${240 + eyeX + 12}" cy="177" r="3.5" fill="${palette.accent}"/>
  <circle cx="${240 - eyeX - 11}" cy="176" r="1.5" fill="#ffffff" opacity="0.7"/>
  <circle cx="${240 + eyeX + 13}" cy="176" r="1.5" fill="#ffffff" opacity="0.7"/>
  <path d="M ${228} ${215 + mouthCurve} Q ${240} ${222 + mouthCurve} ${252} ${215 + mouthCurve}" fill="none" stroke="${palette.fg}" stroke-width="1.8" stroke-linecap="round" opacity="0.6"/>
  <circle cx="240" cy="240" r="237" fill="none" stroke="${palette.accent}" stroke-width="2.5" stroke-opacity="0.2"/>
  <circle cx="240" cy="240" r="234" fill="none" stroke="${palette.fg}" stroke-width="0.5" stroke-opacity="0.08"/>
  <rect x="30" y="400" width="${Math.min(escapedRole.length * 8.5 + 24, 280)}" height="26" rx="13" fill="${palette.bg[0]}" fill-opacity="0.8" stroke="${palette.accent}" stroke-width="1" stroke-opacity="0.3"/>
  <text x="42" y="418" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" fill="${palette.fg}" fill-opacity="0.9">${escapedRole}</text>
  <text x="46" y="444" font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="${palette.fg}" fill-opacity="0.35">${escapedStyle}</text>
  <circle cx="410" cy="70" r="32" fill="${palette.bg[0]}" fill-opacity="0.7" stroke="${palette.accent}" stroke-width="1.5" stroke-opacity="0.3"/>
  <text x="410" y="78" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, monospace" font-size="22" font-weight="700" fill="${palette.fg}" fill-opacity="0.9">${initials}</text>
</svg>`;
}

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
    `Create a single square avatar portrait for an AI agent named ${input.agentName}.`,
    `The character should feel like a ${genderText} ${input.agentRole}${ageFragment}.`,
    stylePrompt,
    hairFragment,
    eyeFragment,
    vibeFragment,
    "This must be a true portrait image, not an icon, glyph, logo, flat SVG, mascot badge, or abstract placeholder.",
    "Show head-and-shoulders only. Strong face visibility. Professional composition for a profile picture.",
    "Keep the subject centered and readable at small sizes.",
    "No text, no labels, no HUD overlays, no letters, no watermark, no UI chrome.",
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

function generateLocalSvg(
  input: AvatarGenerationInput,
  provider: AvatarProviderType
): AvatarGenerationResult {
  const count = Math.max(1, Math.min(6, Math.trunc(input.count)));
  const previews: string[] = [];

  for (let i = 0; i < count; i++) {
    const svg = generateSingleAvatarSvg({
      name: input.agentName,
      role: input.agentRole,
      styleId: input.styleId,
      gender: input.gender,
      seed: randomUUID(),
    });
    previews.push(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
    );
  }

  return {
    previews,
    provider,
    isAiGenerated: false,
  };
}
