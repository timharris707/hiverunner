export interface AvatarDraftCache {
  styleId: string;
  gender: string;
  previews: string[];
  updatedAt: number;
  age?: number | null;
  hairColor?: string | null;
  hairLength?: string | null;
  eyeColor?: string | null;
  vibe?: string | null;
  voiceId?: string | null;
}

function getKey(agentId: string): string {
  return `hiverunner/avatar-draft/${agentId}`;
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
        styleId: typeof parsed.styleId === "string" ? parsed.styleId : "cyber-organic",
        gender: typeof parsed.gender === "string" ? parsed.gender : "androgynous",
        previews: Array.isArray(parsed.previews)
          ? parsed.previews.filter((value): value is string => typeof value === "string")
          : [],
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
        age: typeof parsed.age === "number" ? parsed.age : null,
        hairColor: typeof parsed.hairColor === "string" ? parsed.hairColor : null,
        hairLength: typeof parsed.hairLength === "string" ? parsed.hairLength : null,
        eyeColor: typeof parsed.eyeColor === "string" ? parsed.eyeColor : null,
        vibe: typeof parsed.vibe === "string" ? parsed.vibe : null,
        voiceId: typeof parsed.voiceId === "string" ? parsed.voiceId : null,
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
