/**
 * Client-safe avatar theme presets for the wizard.
 * Mirrors the server-side AVATAR_THEME_PRESETS but with added emoji + display metadata.
 */
export const AVATAR_THEME_PRESETS = [
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    emoji: "🌆",
    description: "Neon-lit operators with augmented tech aesthetics.",
    keywords: ["neon", "cyberpunk", "high-contrast", "augmented"],
  },
  {
    id: "pixel-art",
    name: "Pixel Art",
    emoji: "👾",
    description: "Retro pixel sprites with crisp role-based silhouettes.",
    keywords: ["pixel", "retro", "sprite", "playful"],
  },
  {
    id: "sci-fi-crew",
    name: "Sci-Fi Crew",
    emoji: "🚀",
    description: "Futuristic crew style with cohesive uniforms and devices.",
    keywords: ["futuristic", "crew", "command-center", "cinematic"],
  },
  {
    id: "fantasy-guild",
    name: "Fantasy Guild",
    emoji: "⚔️",
    description: "Stylized fantasy members with role-based gear.",
    keywords: ["fantasy", "guild", "medieval", "dramatic"],
  },
  {
    id: "steampunk",
    name: "Steampunk",
    emoji: "⚙️",
    description: "Brass, clockwork, and inventive operator motifs.",
    keywords: ["steampunk", "brass", "clockwork", "inventive"],
  },
  {
    id: "corporate-noir",
    name: "Corporate Noir",
    emoji: "🏢",
    description: "Premium enterprise style with moody, modern tone.",
    keywords: ["enterprise", "studio", "polished", "dark"],
  },
  {
    id: "watercolor",
    name: "Watercolor",
    emoji: "🎨",
    description: "Painterly portraits with soft gradients and organic texture.",
    keywords: ["watercolor", "soft", "artful", "organic"],
  },
  {
    id: "anime-studio",
    name: "Anime Studio",
    emoji: "✨",
    description: "Expressive anime-inspired team identity.",
    keywords: ["anime", "expressive", "vibrant", "stylized"],
  },
  {
    id: "minimal-steel",
    name: "Minimal Steel",
    emoji: "🔲",
    description: "Modern minimal style with clean geometric accents.",
    keywords: ["minimal", "modern", "steel", "geometric"],
  },
] as const;

export type AvatarThemePresetId = (typeof AVATAR_THEME_PRESETS)[number]["id"];
