import { LOCAL_DEV_SESSION_COOKIE } from "@/lib/auth/local-dev-session";
import { getAuthMode } from "@/lib/auth/auth-mode";
import { securityLog } from "@/lib/observability/logging";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  if (getAuthMode() === "supabase") {
    try {
      const supabase = await createServerSupabaseClient();
      await supabase.auth.signOut();
    } catch (error) {
      securityLog("auth.logout_supabase_signout_failed", {
        path: "/api/auth/logout",
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(LOCAL_DEV_SESSION_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}
