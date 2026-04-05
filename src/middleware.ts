import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { EDGE_ROUTE_MAPS_FALLBACK, withEdgeRouteMapFallback } from "@/lib/orchestration/edge-route-maps";
import type { EdgeRouteMaps } from "@/lib/orchestration/edge-route-maps";
import { updateSession } from "@/lib/supabase/middleware";

const APP_ROOT_PREFIXES = new Set([
  "api", "auth", "_next", "login", "companies", "projects", "ideas",
  "advisory", "marketing", "voice", "trading", "terminal", "sessions",
  "logs", "search", "settings", "skills", "workflows", "system",
  "office", "monitoring", "reliability", "reports", "memory", "files",
  "git", "cron", "factory", "org", "tasks", "agents",
]);

const COMPANY_SUB_PATHS = new Set([
  "dashboard", "inbox", "issues", "team", "org", "skills", "costs",
  "activity", "files", "settings", "projects", "goals", "agents", "routines", "tasks",
]);

const EDGE_ROUTE_MAP_CACHE_TTL_MS = 30_000;

type EdgeRouteMapCache = {
  maps: EdgeRouteMaps;
  expiresAt: number;
};

function getEdgeRouteMapCacheStore(): { cache?: EdgeRouteMapCache } {
  const scoped = globalThis as typeof globalThis & { __mcEdgeRouteMapCache?: EdgeRouteMapCache };
  return {
    get cache() {
      return scoped.__mcEdgeRouteMapCache;
    },
    set cache(value: EdgeRouteMapCache | undefined) {
      scoped.__mcEdgeRouteMapCache = value;
    },
  };
}

function hasOwnRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNestedStringRecord(value: unknown): value is Record<string, Record<string, string>> {
  if (!hasOwnRecord(value)) return false;
  return Object.values(value).every((entry) => {
    if (!hasOwnRecord(entry)) return false;
    return Object.values(entry).every((inner) => typeof inner === "string");
  });
}

function isEdgeRouteMapsPayload(value: unknown): value is EdgeRouteMaps {
  if (!hasOwnRecord(value)) return false;
  return (
    hasOwnRecord(value.companyCodeToSlug)
    && Object.values(value.companyCodeToSlug).every((entry) => typeof entry === "string")
    && hasOwnRecord(value.companySlugToCode)
    && Object.values(value.companySlugToCode).every((entry) => typeof entry === "string")
    && isNestedStringRecord(value.projectIdToSlugByCompany)
  );
}

function shouldResolveEdgeRouteMaps(pathname: string): boolean {
  if (!pathname || pathname === "/") return false;
  if (pathname.startsWith("/companies/")) {
    return pathname !== "/companies/new";
  }

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  return !APP_ROOT_PREFIXES.has(segments[0].toLowerCase());
}

async function getEdgeRouteMaps(request: NextRequest): Promise<EdgeRouteMaps> {
  const cacheStore = getEdgeRouteMapCacheStore();
  const cached = cacheStore.cache;
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.maps;
  }

  try {
    const url = new URL("/api/orchestration/edge-route-maps", request.nextUrl.origin);
    const headers = new Headers({
      "x-mc-internal": "edge-route-map-refresh",
    });
    if (process.env.MC_API_KEY) {
      headers.set("x-mc-api-key", process.env.MC_API_KEY);
    }

    const response = await fetch(url.toString(), {
      headers,
      cache: "no-store",
    });

    if (response.ok) {
      const payload = await response.json();
      if (isEdgeRouteMapsPayload(payload)) {
        const merged = withEdgeRouteMapFallback(payload);
        cacheStore.cache = {
          maps: merged,
          expiresAt: now + EDGE_ROUTE_MAP_CACHE_TTL_MS,
        };
        return merged;
      }
    }
  } catch {
    // Fall back to the bundled map below.
  }

  return EDGE_ROUTE_MAPS_FALLBACK;
}

function copyQuery(target: URL, source: URLSearchParams) {
  for (const [key, value] of source) {
    target.searchParams.set(key, value);
  }
}

export function tryCanonicalRewrite(pathname: string, searchParams: URLSearchParams, origin: string, routeMaps: EdgeRouteMaps = EDGE_ROUTE_MAPS_FALLBACK): URL | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const root = segments[0];
  if (APP_ROOT_PREFIXES.has(root.toLowerCase())) return null;

  const companySlug = routeMaps.companyCodeToSlug[root.toUpperCase()];
  if (!companySlug) return null;

  if (segments.length === 1) {
    return new URL(`/companies/${encodeURIComponent(companySlug)}/dashboard`, origin);
  }

  const sub = segments[1];

  if (sub === "projects") {
    if (segments.length === 2) {
      const url = new URL(`/companies/${encodeURIComponent(companySlug)}/projects`, origin);
      copyQuery(url, searchParams);
      return url;
    }

    const projectSlug = segments[2];
    if (segments.length === 3) {
      return new URL(`/companies/${encodeURIComponent(companySlug)}/projects/${encodeURIComponent(projectSlug)}`, origin);
    }

    const projectSub = segments[3];
    if (projectSub === "issues") {
      const url = new URL(`/companies/${encodeURIComponent(companySlug)}/projects/${encodeURIComponent(projectSlug)}/issues`, origin);
      for (const [key, value] of searchParams) {
        url.searchParams.set(key, value);
      }
      return url;
    }

    if (projectSub === "board" || projectSub === "settings" || projectSub === "agents" || projectSub === "overview" || projectSub === "configuration" || projectSub === "budget") {
      const url = new URL(`/companies/${encodeURIComponent(companySlug)}/projects/${encodeURIComponent(projectSlug)}/${projectSub}`, origin);
      copyQuery(url, searchParams);
      return url;
    }
  }

  if (sub === "agents") {
    if (segments.length === 3 && segments[2] === "new") {
      return new URL(`/companies/${encodeURIComponent(companySlug)}/agents/new`, origin);
    }

    if (segments.length >= 3) {
      const agentSlug = segments[2];
      const agentSub = segments[3] || "dashboard";
      const supported = new Set(["dashboard", "configuration", "budget", "instructions", "runs", "skills"]);
      if (supported.has(agentSub)) {
        const url = new URL(`/companies/${encodeURIComponent(companySlug)}/agents/${encodeURIComponent(agentSlug)}/${agentSub}`, origin);
        copyQuery(url, searchParams);
        return url;
      }
      const fallback = new URL(`/companies/${encodeURIComponent(companySlug)}/agents/${encodeURIComponent(agentSlug)}`, origin);
      copyQuery(fallback, searchParams);
      return fallback;
    }
  }

  if (sub === "issues" && segments[2] === "new") {
    const url = new URL(`/companies/${encodeURIComponent(companySlug)}/issues/new`, origin);
    copyQuery(url, searchParams);
    return url;
  }

  if (COMPANY_SUB_PATHS.has(sub)) {
    const rest = segments.slice(1).map(encodeURIComponent).join("/");
    const url = new URL(`/companies/${encodeURIComponent(companySlug)}/${rest}`, origin);
    copyQuery(url, searchParams);
    return url;
  }

  return null;
}

export function tryLegacyRedirect(pathname: string, searchParams: URLSearchParams, origin: string, routeMaps: EdgeRouteMaps = EDGE_ROUTE_MAPS_FALLBACK): URL | null {
  const match = pathname.match(/^\/companies\/([^/]+)(\/.*)?$/);
  if (!match) return null;

  const companySlug = decodeURIComponent(match[1]);
  if (companySlug === "new") return null;

  const companyCode = routeMaps.companySlugToCode[companySlug];
  if (!companyCode) return null;

  const rest = match[2] || "";
  const qs = new URLSearchParams(searchParams);

  if (!rest || rest === "/") {
    const url = new URL(`/${companyCode}`, origin);
    copyQuery(url, qs);
    return url;
  }

  const projectParam = searchParams.get("project") || searchParams.get("projectId");
  if (rest === "/issues" && projectParam) {
    const projectSlug = routeMaps.projectIdToSlugByCompany[companySlug]?.[projectParam] ?? projectParam;
    qs.delete("project");
    qs.delete("projectId");
    const url = new URL(`/${companyCode}/projects/${encodeURIComponent(projectSlug)}/issues`, origin);
    copyQuery(url, qs);
    return url;
  }

  const projectMatch = rest.match(/^\/projects\/([^/]+)(\/.*)?$/);
  if (projectMatch) {
    const projectSlug = decodeURIComponent(projectMatch[1]);
    const projectRest = projectMatch[2] || "";
    const suffix = projectRest || "/issues";
    const url = new URL(`/${companyCode}/projects/${encodeURIComponent(projectSlug)}${suffix}`, origin);
    copyQuery(url, qs);
    return url;
  }

  if (rest === "/agents/new") {
    const url = new URL(`/${companyCode}/agents/new`, origin);
    copyQuery(url, qs);
    return url;
  }

  const agentMatch = rest.match(/^\/agents\/([^/]+)(\/.*)?$/);
  if (agentMatch) {
    const agentSlug = decodeURIComponent(agentMatch[1]);
    const agentRest = agentMatch[2] || "/dashboard";
    const url = new URL(`/${companyCode}/agents/${encodeURIComponent(agentSlug)}${agentRest}`, origin);
    copyQuery(url, qs);
    return url;
  }

  const url = new URL(`/${companyCode}${rest}`, origin);
  copyQuery(url, qs);
  return url;
}

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

  if (!pathname.startsWith("/api/") && !pathname.startsWith("/_next/")) {
    const origin = request.nextUrl.origin;
    const routeMaps = shouldResolveEdgeRouteMaps(pathname)
      ? await getEdgeRouteMaps(request)
      : EDGE_ROUTE_MAPS_FALLBACK;

    const rewriteTarget = tryCanonicalRewrite(pathname, request.nextUrl.searchParams, origin, routeMaps);
    if (rewriteTarget) {
      return finalize(NextResponse.rewrite(rewriteTarget));
    }

    const legacyTarget = tryLegacyRedirect(pathname, request.nextUrl.searchParams, origin, routeMaps);
    if (legacyTarget) {
      return finalize(NextResponse.redirect(legacyTarget, 308));
    }
  }

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
