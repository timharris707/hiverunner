export interface AvatarDraftCache {
  styleId: string;
  gender: string;
  previews: string[];
  updatedAt: number;
}

function getKey(agentId: string): string {
  return `mission-control/avatar-draft/${agentId}`;
}

export function readAvatarDraftCache(agentId: string): AvatarDraftCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(getKey(agentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AvatarDraftCache>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      styleId: typeof parsed.styleId === "string" ? parsed.styleId : "cyberpunk",
      gender: typeof parsed.gender === "string" ? parsed.gender : "androgynous",
      previews: Array.isArray(parsed.previews)
        ? parsed.previews.filter((value): value is string => typeof value === "string")
        : [],
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function writeAvatarDraftCache(agentId: string, draft: AvatarDraftCache): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(getKey(agentId), JSON.stringify(draft));
  } catch {
    // best-effort cache only
  }
}

export function clearAvatarDraftCache(agentId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(getKey(agentId));
  } catch {
    // ignore
  }
}
