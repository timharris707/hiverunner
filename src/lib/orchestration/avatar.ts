import { createHash } from "crypto";

type AvatarTheme = {
  name: string;
  promptTemplate: string;
  keywords: string[];
};

type GenerateAgentAvatarInput = {
  name: string;
  role: string;
  personality: string;
  emoji?: string | null;
  theme: AvatarTheme;
  seed?: string;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pickHex(seed: string, offset: number): string {
  const value = seed.slice(offset, offset + 6);
  return `#${value.padEnd(6, "0")}`;
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "AG";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function compact(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function generateAgentAvatarDataUrl(input: GenerateAgentAvatarInput): string {
  const seed = createHash("sha256")
    .update(
      [
        input.theme.name,
        input.theme.promptTemplate,
        input.theme.keywords.join("|"),
        input.name,
        input.role,
        input.personality,
        input.emoji ?? "",
        input.seed ?? "",
      ].join("::")
    )
    .digest("hex");

  const bgA = pickHex(seed, 0);
  const bgB = pickHex(seed, 6);
  const orb = pickHex(seed, 12);
  const fg = pickHex(seed, 18);
  const nameInitials = escapeXml(initials(input.name));
  const role = escapeXml(compact(input.role.trim() || "Agent", 22));
  const themeName = escapeXml(compact(input.theme.name.trim() || "Theme", 18));
  const accent = escapeXml((input.emoji ?? "").trim() || role.slice(0, 1).toUpperCase());

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480" role="img" aria-label="Agent avatar">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bgA}" />
      <stop offset="100%" stop-color="${bgB}" />
    </linearGradient>
    <radialGradient id="orb" cx="80%" cy="20%" r="45%">
      <stop offset="0%" stop-color="${orb}" stop-opacity="0.9" />
      <stop offset="100%" stop-color="${orb}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="480" height="480" fill="url(#bg)" />
  <rect width="480" height="480" fill="url(#orb)" />
  <rect x="30" y="30" width="420" height="420" rx="52" fill="none" stroke="${fg}" stroke-opacity="0.35" stroke-width="3" />
  <text x="240" y="245" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="152" font-weight="700" fill="${fg}">${nameInitials}</text>
  <text x="42" y="386" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="24" fill="#ffffff" fill-opacity="0.95">${role}</text>
  <text x="42" y="422" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="20" fill="#ffffff" fill-opacity="0.72">${themeName}</text>
  <circle cx="418" cy="66" r="30" fill="#000000" fill-opacity="0.22" />
  <text x="418" y="76" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI Emoji, sans-serif" font-size="28" fill="#ffffff">${accent}</text>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
