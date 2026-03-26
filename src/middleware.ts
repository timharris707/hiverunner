import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Pages that don't require authentication
const PUBLIC_PAGES = new Set(["/login"]);

// API routes that are always public
const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/health",
  "/auth/callback",
];

// Internal API routes that skip user-session auth
// (used by advisory board, agents, etc. — protected by other means)
const INTERNAL_API_PREFIXES = [
  "/api/advisory/",
  "/api/agents/",
  "/api/gateway/",
  "/api/system/",
  "/api/terminal",
  "/api/trading/",
  "/api/weather",
  "/api/cron",
  "/api/logs/",
  "/api/notifications",
  "/api/office",
  "/api/files",
  "/api/memory/",
  "/api/search",
  "/api/sessions",
  "/api/skills",
  "/api/reliability",
  "/api/reports",
  "/api/costs",
  "/api/analytics",
  "/api/dashboard/",
  "/api/activities",
  "/api/actions",
  "/api/tasks",
  "/api/browse",
  "/api/git",
  "/api/media/",
  "/api/settings",
  "/api/admin/",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host") || "";

  // Skip auth entirely on localhost (development)
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
    return NextResponse.next();
  }

  // Always allow public pages
  if (PUBLIC_PAGES.has(pathname)) {
    return NextResponse.next();
  }

  // Always allow public API routes
  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // Allow internal API routes through (they handle their own auth if needed)
  if (INTERNAL_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // Check Supabase session for all other routes (pages)
  try {
    const { user, supabaseResponse } = await updateSession(request);

    if (!user) {
      // Not authenticated — redirect pages to login
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Unauthorized", message: "Authentication required" },
          { status: 401 }
        );
      }

      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }

    return supabaseResponse;
  } catch (error) {
    // If Supabase is unavailable, fall back to old cookie auth
    const authCookie = request.cookies.get("mc_auth");
    if (authCookie && authCookie.value === process.env.AUTH_SECRET) {
      return NextResponse.next();
    }

    // No valid session of any kind
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
