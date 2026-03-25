import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
  } catch {
    // Ignore errors — we're logging out regardless
  }

  // Also clear old cookie auth for backwards compat
  const response = NextResponse.json({ success: true });
  response.cookies.set("mc_auth", "", { maxAge: 0, path: "/" });
  return response;
}
