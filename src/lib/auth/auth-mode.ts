/**
 * Auth mode resolver.
 *
 * HiveRunner supports two auth shapes:
 *
 * - `local-single-user`: default for local-first installs cloned from GitHub.
 *   The app trusts a single owner identity; no Supabase calls are issued.
 *   Protected mutation routes are still gated by `MC_API_KEY` (for agent
 *   traffic) and by the loopback policy (for browser traffic).
 *
 * - `supabase`: multi-user hosted deployment. Requires
 *   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Session
 *   issuance and refresh go through the Supabase SSR helpers as before.
 *
 * Selection is explicit (`MC_AUTH_MODE` env). Treat anything unset or invalid
 * as `local-single-user` — a GitHub clone with no config should still boot,
 * and local installs should not switch into hosted auth just because Supabase
 * keys are present for optional testing.
 */

export type AuthMode = "local-single-user" | "supabase";

export const AUTH_MODE_ENV = "MC_AUTH_MODE";
export const LOCAL_OWNER_ID = "local-owner";
export const LOCAL_OWNER_EMAIL_ENV = "MC_LOCAL_OWNER_EMAIL";
export const DEFAULT_LOCAL_OWNER_EMAIL = "owner@localhost.local";

export type LocalOwner = {
  id: string;
  email: string;
};

export function isSupabaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return Boolean(url && anonKey);
}

function normalizeMode(value: string | undefined): AuthMode | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === "local-single-user" || trimmed === "local" || trimmed === "single-user") {
    return "local-single-user";
  }
  if (trimmed === "supabase" || trimmed === "hosted") {
    return "supabase";
  }
  return null;
}

export function getAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  const explicit = normalizeMode(env[AUTH_MODE_ENV]);
  if (explicit) return explicit;
  return "local-single-user";
}

export function isLocalSingleUserMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return getAuthMode(env) === "local-single-user";
}

export function getLocalOwner(env: NodeJS.ProcessEnv = process.env): LocalOwner {
  const email = env[LOCAL_OWNER_EMAIL_ENV]?.trim() || DEFAULT_LOCAL_OWNER_EMAIL;
  return { id: LOCAL_OWNER_ID, email };
}
