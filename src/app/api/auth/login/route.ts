import { getAuthMode } from "@/lib/auth/auth-mode";
import { createLocalDevSessionResponse } from "@/lib/auth/local-dev-session-response";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  if (getAuthMode() === "local-single-user") {
    return createLocalDevSessionResponse(request);
  }

  return NextResponse.json(
    {
      success: false,
      error: "Legacy password login is disabled. Use the configured Supabase auth flow.",
    },
    { status: 410 },
  );
}
