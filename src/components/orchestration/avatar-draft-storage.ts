export interface AvatarDraftCache {
  styleId: string;
  gender: string;
  previews: string[];
  updatedAt: number;
}

function getKey(agentId: string): string {
  return `mission-control/avatar-draft/${agentId}`;
}

export function readAvatarDraftCache(agentId: string, alternateKey?: string): AvatarDraftCache | null {
  if (typeof window === "undefined") return null;
  const keysToTry = [getKey(agentId)];
  if (alternateKey && alternateKey !== agentId) {
    keysToTry.push(getKey(alternateKey));
  }
  for (const key of keysToTry) {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Partial<AvatarDraftCache>;
      if (!parsed || typeof parsed !== "object") continue;
      return {
        styleId: typeof parsed.styleId === "string" ? parsed.styleId : "cyberpunk",
        gender: typeof parsed.gender === "string" ? parsed.gender : "androgynous",
        previews: Array.isArray(parsed.previews)
          ? parsed.previews.filter((value): value is string => typeof value === "string")
          : [],
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
      };
    } catch {
      // try next key
    }
  }
  return null;
}

export function writeAvatarDraftCache(agentId: string, draft: AvatarDraftCache, alternateKey?: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(getKey(agentId), JSON.stringify(draft));
    if (alternateKey && alternateKey !== agentId) {
      window.sessionStorage.setItem(getKey(alternateKey), JSON.stringify(draft));
    }
  } catch {
    // best-effort cache only
  }
}

export function clearAvatarDraftCache(agentId: string, alternateKey?: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(getKey(agentId));
    if (alternateKey && alternateKey !== agentId) {
      window.sessionStorage.removeItem(getKey(alternateKey));
    }
  } catch {
    // ignore
  }
}
