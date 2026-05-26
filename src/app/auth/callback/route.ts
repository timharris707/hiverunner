import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthMode, isSupabaseConfigured } from "@/lib/auth/auth-mode";
import { securityLog } from "@/lib/observability/logging";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // Local-single-user installs have no OAuth flow; redirect to the destination.
  if (getAuthMode() === "local-single-user") {
    return NextResponse.redirect(`${origin}${next}`);
  }

  if (!isSupabaseConfigured()) {
    securityLog("auth.callback_hosted_config_missing", {
      path: "/auth/callback",
      mode: getAuthMode(),
    });
    return NextResponse.redirect(`${origin}/login?error=auth_unavailable`);
  }

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }

    securityLog("auth.callback_exchange_failed", {
      path: "/auth/callback",
      reason: error?.message ?? "missing_code_or_session_exchange_failed",
    });
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
