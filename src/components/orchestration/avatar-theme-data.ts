/**
 * Client-safe avatar theme presets for the wizard.
 * Mirrors the server-side AVATAR_THEME_PRESETS but with added emoji + display metadata.
 */
export const AVATAR_THEME_PRESETS = [
  {
    id: "cyber-organic",
    name: "Cyber-Organic",
    emoji: "🧬",
    description: "New — modeled on the references you shared. Photoreal human with subtle circuitry across temples and jaw, luminescent irises, hoodie, saturated teal/green backdrop.",
    keywords: ["cyber-organic", "augmented", "glowing eyes", "hoodie"],
    isNew: true,
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    emoji: "🌆",
    description: "Neon-lit urban portrait with rain-slick reflections and vibrant rim lighting.",
    keywords: ["neon", "cyberpunk", "urban", "high-contrast"],
  },
  {
    id: "sci-fi-crew",
    name: "Sci-Fi Crew",
    emoji: "🚀",
    description: "Polished starship officer with crisp uniform and cinematic ship-interior lighting.",
    keywords: ["starship", "crew", "cinematic", "clean"],
  },
  {
    id: "fantasy-guild",
    name: "Fantasy Guild",
    emoji: "⚔️",
    description: "Painterly RPG character portrait with leather, embroidered robes, and hearth-lit warmth.",
    keywords: ["fantasy", "guild", "painterly", "heroic"],
  },
  {
    id: "anime-studio",
    name: "Anime Studio",
    emoji: "✨",
    description: "Premium anime key-art portrait with expressive eyes and cel-shaded lighting.",
    keywords: ["anime", "expressive", "key-art", "stylized"],
  },
  {
    id: "watercolor",
    name: "Watercolor",
    emoji: "🎨",
    description: "Soft watercolor portrait with visible brush textures and tasteful color bleeds.",
    keywords: ["watercolor", "painterly", "soft", "organic"],
  },
  {
    id: "minimal-steel",
    name: "Minimal Steel",
    emoji: "🔲",
    description: "Editorial black-and-white studio portrait — clean, modern, high-contrast grayscale.",
    keywords: ["editorial", "grayscale", "minimal", "studio"],
  },
] as const;

export type AvatarThemePresetId = (typeof AVATAR_THEME_PRESETS)[number]["id"];
