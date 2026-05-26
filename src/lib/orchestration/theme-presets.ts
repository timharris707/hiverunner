export interface AvatarThemePreset {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  keywords: string[];
}

export const AVATAR_THEME_PRESETS: AvatarThemePreset[] = [
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    description: "Neon-lit operators with augmented tech aesthetics.",
    promptTemplate:
      "cyberpunk team portrait, neon accents, high contrast, cinematic lighting, detailed character design",
    keywords: ["neon", "cyberpunk", "high-contrast", "augmented"],
  },
  {
    id: "pixel-art",
    name: "Pixel Art",
    description: "Retro pixel sprites with crisp role-based silhouettes.",
    promptTemplate:
      "pixel art portrait, clean 16-bit sprite style, role-coded accessories, cohesive palette and lighting",
    keywords: ["pixel", "retro", "sprite", "playful"],
  },
  {
    id: "sci-fi-crew",
    name: "Sci-Fi Crew",
    description: "Futuristic crew style with cohesive uniforms and devices.",
    promptTemplate:
      "science fiction crew portrait, cohesive uniforms, futuristic command center, cinematic composition",
    keywords: ["futuristic", "crew", "command-center", "cinematic"],
  },
  {
    id: "fantasy-guild",
    name: "Fantasy Guild",
    description: "Stylized fantasy members with role-based gear.",
    promptTemplate:
      "fantasy guild character portrait, role-specific attire, rich textures, dramatic fantasy lighting",
    keywords: ["fantasy", "guild", "medieval", "dramatic"],
  },
  {
    id: "steampunk",
    name: "Steampunk",
    description: "Brass, clockwork, and inventive operator motifs.",
    promptTemplate:
      "steampunk character portrait, brass instruments, clockwork motifs, warm cinematic lighting, detailed attire",
    keywords: ["steampunk", "brass", "clockwork", "inventive"],
  },
  {
    id: "corporate-noir",
    name: "Corporate Noir",
    description: "Premium enterprise style with moody, modern tone.",
    promptTemplate:
      "executive portrait, premium corporate noir, dramatic studio lighting, polished professional style",
    keywords: ["enterprise", "studio", "polished", "dark"],
  },
  {
    id: "watercolor",
    name: "Watercolor",
    description: "Painterly portraits with soft gradients and organic texture.",
    promptTemplate:
      "watercolor portrait, soft washes, hand-painted texture, cohesive team palette, elegant composition",
    keywords: ["watercolor", "soft", "artful", "organic"],
  },
  {
    id: "anime-studio",
    name: "Anime Studio",
    description: "Expressive anime-inspired team identity.",
    promptTemplate:
      "anime character portrait, expressive style, crisp linework, vibrant color palette, role-informed design",
    keywords: ["anime", "expressive", "vibrant", "stylized"],
  },
  {
    id: "minimal-steel",
    name: "Minimal Steel",
    description: "Modern minimal style with clean geometric accents.",
    promptTemplate:
      "minimalist portrait, clean geometric shapes, steel-and-graphite palette, modern editorial look",
    keywords: ["minimal", "modern", "steel", "geometric"],
  },
];

export function findAvatarThemePreset(presetId: string): AvatarThemePreset | undefined {
  return AVATAR_THEME_PRESETS.find((preset) => preset.id === presetId);
}
