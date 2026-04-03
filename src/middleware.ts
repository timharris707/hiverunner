import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Pages that don't require authentication
const PUBLIC_PAGES = new Set(["/login"]);

const ORCHESTRATION_API_PREFIX = "/api/orchestration/";
const ORCHESTRATION_HEALTH_PATHS = new Set<string>([
  "/api/orchestration/bridge/status",
]);

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
  "/api/orchestration/",
];

type OrchestrationAuthDecisionInput = {
  expectedApiKey?: string | null;
  providedApiKey?: string | null;
  hasSupabaseUser: boolean;
};

export function isValidOrchestrationApiKey(expectedApiKey?: string | null, providedApiKey?: string | null): boolean {
  const expected = expectedApiKey?.trim();
  const provided = providedApiKey?.trim();
  return Boolean(expected && provided && expected === provided);
}

export function canAccessOrchestrationApi(input: OrchestrationAuthDecisionInput): boolean {
  return isValidOrchestrationApiKey(input.expectedApiKey, input.providedApiKey) || input.hasSupabaseUser;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host") || "";
  const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  const startedAt = Date.now();

  const finalize = (response: NextResponse): NextResponse => {
    response.headers.set("x-request-id", requestId);

    if (pathname.startsWith("/api/")) {
      const payload = {
        requestId,
        method: request.method,
        path: pathname,
        status: response.status,
        durationMs: Date.now() - startedAt,
      };
      console.info(`[api] ${JSON.stringify(payload)}`);
    }

    return response;
  };

  // Skip auth entirely on localhost (development)
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
    return finalize(NextResponse.next());
  }

  // Orchestration API uses a shared-secret header and skips user-session auth.
  // Exempt health checks. For protected orchestration routes, allow:
  // - valid x-mc-api-key, OR
  // - valid Supabase browser session
  if (pathname.startsWith(ORCHESTRATION_API_PREFIX) && !ORCHESTRATION_HEALTH_PATHS.has(pathname)) {
    const expectedApiKey = process.env.MC_API_KEY;
    const providedApiKey = request.headers.get("x-mc-api-key");

    if (isValidOrchestrationApiKey(expectedApiKey, providedApiKey)) {
      return finalize(NextResponse.next());
    }

    try {
      const { user, supabaseResponse } = await updateSession(request);
      if (canAccessOrchestrationApi({ expectedApiKey, providedApiKey, hasSupabaseUser: Boolean(user) })) {
        return finalize(supabaseResponse);
      }
    } catch {
      const authCookie = request.cookies.get("mc_auth");
      const hasLegacyAuth = Boolean(authCookie && authCookie.value === process.env.AUTH_SECRET);
      if (canAccessOrchestrationApi({ expectedApiKey, providedApiKey, hasSupabaseUser: hasLegacyAuth })) {
        return finalize(NextResponse.next());
      }
    }

    return finalize(NextResponse.json(
      {
        error: {
          code: "unauthorized",
          message: "Authentication required: valid Supabase session or X-MC-API-Key header",
        },
      },
      { status: 401 }
    ));
  }

  // Always allow public pages
  if (PUBLIC_PAGES.has(pathname)) {
    return finalize(NextResponse.next());
  }

  // Always allow public API routes
  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return finalize(NextResponse.next());
  }

  // Allow internal API routes through (they handle their own auth if needed)
  if (INTERNAL_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return finalize(NextResponse.next());
  }

  // Check Supabase session for all other routes (pages)
  try {
    const { user, supabaseResponse } = await updateSession(request);

    if (!user) {
      // Not authenticated — redirect pages to login
      if (pathname.startsWith("/api/")) {
        return finalize(NextResponse.json(
          { error: "Unauthorized", message: "Authentication required" },
          { status: 401 }
        ));
      }

      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return finalize(NextResponse.redirect(loginUrl));
    }

    return finalize(supabaseResponse);
  } catch {
    // If Supabase is unavailable, fall back to old cookie auth
    const authCookie = request.cookies.get("mc_auth");
    if (authCookie && authCookie.value === process.env.AUTH_SECRET) {
      return finalize(NextResponse.next());
    }

    // No valid session of any kind
    if (pathname.startsWith("/api/")) {
      return finalize(NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      ));
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return finalize(NextResponse.redirect(loginUrl));
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
