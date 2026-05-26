import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthMode, getLocalOwner, isSupabaseConfigured } from "@/lib/auth/auth-mode";
import { securityLog } from "@/lib/observability/logging";

export type SessionLoaderResult = {
  user: { id: string; email?: string } | null;
  supabaseResponse: NextResponse;
};

export async function updateSession(request: NextRequest): Promise<SessionLoaderResult> {
  // Local-first install: no Supabase configured (or explicitly disabled). The
  // app trusts a single owner identity so a fresh GitHub clone can boot
  // without external auth.
  if (getAuthMode() === "local-single-user") {
    const owner = getLocalOwner();
    return {
      user: { id: owner.id, email: owner.email },
      supabaseResponse: NextResponse.next({ request }),
    };
  }

  // Hosted mode: defensive guard. If someone set MC_AUTH_MODE=supabase but
  // forgot to provide the env vars, fail loud rather than crash the request
  // with a non-null assertion.
  if (!isSupabaseConfigured()) {
    securityLog("auth.hosted_config_missing", {
      path: request.nextUrl.pathname,
      mode: getAuthMode(),
    });
    throw new Error(
      "Supabase auth mode selected but NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing.",
    );
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Do NOT add any logic between createServerClient and getUser()
  // This refreshes the auth token if needed
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) {
    securityLog("auth.hosted_session_check_failed", {
      path: request.nextUrl.pathname,
      mode: getAuthMode(),
      reason: error.message || error.name || "supabase_get_user_error",
    });
    throw new Error("Supabase session could not be verified.");
  }

  return { user, supabaseResponse };
}
