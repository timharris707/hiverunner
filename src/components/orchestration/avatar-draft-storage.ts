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
      const raw = window.sessionStorage.getItem(key) || window.localStorage.getItem(key);
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
  const payload = JSON.stringify(draft);
  const keys = [getKey(agentId)];
  if (alternateKey && alternateKey !== agentId) keys.push(getKey(alternateKey));
  try {
    for (const key of keys) {
      window.sessionStorage.setItem(key, payload);
      window.localStorage.setItem(key, payload);
    }
  } catch {
    // best-effort cache only
  }
}

export function clearAvatarDraftCache(agentId: string, alternateKey?: string): void {
  if (typeof window === "undefined") return;
  const keys = [getKey(agentId)];
  if (alternateKey && alternateKey !== agentId) keys.push(getKey(alternateKey));
  try {
    for (const key of keys) {
      window.sessionStorage.removeItem(key);
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}
