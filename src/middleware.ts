import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validateCsrfRequest } from "@/lib/auth/csrf";
import { getAuthMode } from "@/lib/auth/auth-mode";
import { LOCAL_DEV_SESSION_COOKIE } from "@/lib/auth/local-dev-session";
import { apiLog, securityLog } from "@/lib/observability/logging";
import { EDGE_ROUTE_MAPS_FALLBACK, withEdgeRouteMapFallback } from "@/lib/orchestration/edge-route-maps";
import type { EdgeRouteMaps } from "@/lib/orchestration/edge-route-maps";
import { updateSession } from "@/lib/supabase/middleware";

const APP_ROOT_PREFIXES = new Set([
  "api", "auth", "_next", "login", "companies", "projects", "ideas",
  "marketing", "voice", "terminal", "sessions",
  "logs", "search", "settings", "skills", "workflows", "system",
  "office", "monitoring", "reliability", "reports", "memory", "files",
  "git", "cron", "factory", "org", "tasks", "agents",
]);

const COMPANY_SUB_PATHS = new Set([
  "dashboard", "inbox", "team", "org", "skills", "costs",
  "activity", "files", "settings", "projects", "goals", "agents", "routines", "tasks", "approvals", "runtimes", "runtime-inventory", "hives",
  "export", "import", "manage-projects", "memory",
]);

const EDGE_ROUTE_MAP_CACHE_TTL_MS = 30_000;

type EdgeRouteMapCache = {
  maps: EdgeRouteMaps;
  expiresAt: number;
  /** Monotonic version — bumped by service layer to force immediate refresh. */
  version: number;
};

type GlobalCacheState = {
  __mcEdgeRouteMapCache?: EdgeRouteMapCache;
  /** Bumped by service layer when slug aliases change. */
  __mcEdgeRouteMapVersion?: number;
};

function getEdgeRouteMapCacheStore(): { cache?: EdgeRouteMapCache } {
  const scoped = globalThis as typeof globalThis & GlobalCacheState;
  return {
    get cache() {
      const c = scoped.__mcEdgeRouteMapCache;
      // If the service layer bumped the version, treat cache as stale.
      if (c && scoped.__mcEdgeRouteMapVersion !== undefined && c.version !== scoped.__mcEdgeRouteMapVersion) {
        return undefined;
      }
      return c;
    },
    set cache(value: EdgeRouteMapCache | undefined) {
      scoped.__mcEdgeRouteMapCache = value;
    },
  };
}

/**
 * Invalidate the edge route map cache immediately. Called by the service layer
 * after slug changes so the next middleware request fetches fresh maps.
 */
export function invalidateEdgeRouteMapCache(): void {
  const scoped = globalThis as typeof globalThis & GlobalCacheState;
  scoped.__mcEdgeRouteMapVersion = (scoped.__mcEdgeRouteMapVersion ?? 0) + 1;
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
    && (
      value.actualCompanyCodes === undefined
      || (Array.isArray(value.actualCompanyCodes) && value.actualCompanyCodes.every((entry) => typeof entry === "string"))
    )
    && isNestedStringRecord(value.projectIdToSlugByCompany)
  );
}

function normalizeCompanyCode(value: string | undefined | null): string {
  return value?.trim().toUpperCase() ?? "";
}

export function getRootRedirectCompanyCode(routeMaps: EdgeRouteMaps, env: NodeJS.ProcessEnv = process.env): string {
  const actualCodes: string[] = [];
  for (const code of routeMaps.actualCompanyCodes ?? []) {
    const normalized = code.trim().toUpperCase();
    if (normalized && routeMaps.companyCodeToSlug[normalized]) {
      actualCodes.push(normalized);
    }
  }

  const configuredDefault = normalizeCompanyCode(env.MC_DEFAULT_COMPANY_CODE);
  if (configuredDefault && actualCodes.includes(configuredDefault)) return configuredDefault;
  if (actualCodes.includes("HIVE")) return "HIVE";
  if (actualCodes.includes("INS")) return "INS";
  if (actualCodes.length > 0) return actualCodes[0];

  const fallbackCodes = Object.keys(routeMaps.companyCodeToSlug);
  if (configuredDefault && routeMaps.companyCodeToSlug[configuredDefault]) return configuredDefault;
  if (routeMaps.companyCodeToSlug.HIVE) return "HIVE";
  if (routeMaps.companyCodeToSlug.INS) return "INS";
  return fallbackCodes[0] ?? "HIVE";
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

async function getEdgeRouteMaps(request: NextRequest, options: { forceRefresh?: boolean } = {}): Promise<EdgeRouteMaps> {
  const cacheStore = getEdgeRouteMapCacheStore();
  const cached = cacheStore.cache;
  const now = Date.now();
  if (!options.forceRefresh && cached && cached.expiresAt > now) {
    return cached.maps;
  }

  const scoped = globalThis as typeof globalThis & GlobalCacheState;

  // If the service layer already populated the cache (via refreshEdgeRouteMapCache),
  // use that even if it was invalidated by a version bump — it is still the latest.
  const eagerCache = scoped.__mcEdgeRouteMapCache;
  if (!options.forceRefresh && eagerCache && eagerCache.expiresAt > now) {
    return eagerCache.maps;
  }

  try {
    // Use the host header to build the self-fetch URL so the request reaches
    // the correct server instance (avoids misrouting on custom ports / 0.0.0.0).
    const host = request.headers.get("host") || request.nextUrl.host;
    const protocol = request.nextUrl.protocol || "http:";
    const origin = `${protocol}//${host}`;
    const url = new URL("/api/orchestration/edge-route-maps", origin);
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
          version: scoped.__mcEdgeRouteMapVersion ?? 0,
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

    // Resolve project slug alias if the slug is historical.
    const rawProjectSlug = segments[2];
    const projectSlug = routeMaps.projectSlugAliasToCanonical[rawProjectSlug] ?? rawProjectSlug;
    if (segments.length === 3) {
      return new URL(`/companies/${encodeURIComponent(companySlug)}/projects/${encodeURIComponent(projectSlug)}`, origin);
    }

    const projectSub = segments[3];
    if (projectSub === "tasks") {
      const url = new URL(`/companies/${encodeURIComponent(companySlug)}/projects/${encodeURIComponent(projectSlug)}/tasks`, origin);
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
        // Forward any deeper sub-path (e.g. runs/{runId})
        const rest = segments.slice(3).map(encodeURIComponent).join("/");
        const url = new URL(`/companies/${encodeURIComponent(companySlug)}/agents/${encodeURIComponent(agentSlug)}/${rest}`, origin);
        copyQuery(url, searchParams);
        return url;
      }
      const fallback = new URL(`/companies/${encodeURIComponent(companySlug)}/agents/${encodeURIComponent(agentSlug)}`, origin);
      copyQuery(fallback, searchParams);
      return fallback;
    }
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

  if (rest === "/issues" || rest.startsWith("/issues/")) {
    return null;
  }

  if (!rest || rest === "/") {
    // Preserve canonical /companies/{slug} detail routes, but redirect known legacy aliases.
    const canonicalSlugForCode = routeMaps.companyCodeToSlug[companyCode];
    if (canonicalSlugForCode && canonicalSlugForCode !== companySlug) {
      const url = new URL(`/${companyCode}/dashboard`, origin);
      copyQuery(url, qs);
      return url;
    }
    return null;
  }

  const projectMatch = rest.match(/^\/projects\/([^/]+)(\/.*)?$/);
  if (projectMatch) {
    const projectSlug = decodeURIComponent(projectMatch[1]);
    const projectRest = projectMatch[2] || "";
    if (projectRest === "/issues" || projectRest.startsWith("/issues/")) {
      return null;
    }
    const suffix = projectRest || "/tasks";
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
const ORCHESTRATION_HEALTH_PATHS = new Set<string>();
const MC_RUN_AS_USER_ID_HEADER = "x-mc-run-as-user-id";
const ENGINE_TICK_PATH = "/api/orchestration/engine/tick";
const SELF_AUTHENTICATING_API_PATHS = new Set([
  ENGINE_TICK_PATH,
  "/api/orchestration/symphony/tracker",
]);

// API routes that are always public
const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/health",
  "/auth/callback",
];

const LOOPBACK_HEALTHCHECK_PATHS = new Set([
  "/api/hiverunner/health",
  // Legacy compatibility for existing local health checks.
  "/api/mc/health",
]);

// Internal API routes that skip user-session auth
// (used by local agents and system tooling — protected by other means)
const INTERNAL_API_PREFIXES = [
  "/api/agents/",
  "/api/system/",
  "/api/terminal",
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

function hasSelfAuthenticatingApiTokenSignal(request: NextRequest): boolean {
  if (!SELF_AUTHENTICATING_API_PATHS.has(request.nextUrl.pathname)) return false;

  if (request.nextUrl.pathname === ENGINE_TICK_PATH) {
    const token = request.headers.get("x-engine-tick")?.trim();
    return token === "internal" || token === "1";
  }

  const bearer = request.headers.get("authorization")?.trim();
  if (bearer?.toLowerCase().startsWith("bearer ")) return true;
  return Boolean(request.headers.get("x-hiverunner-symphony-token")?.trim());
}

function hostnameFromHostHeader(hostHeader: string | null): string {
  const host = hostHeader?.trim().toLowerCase() ?? "";
  if (!host) return "";
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end > 0 ? host.slice(1, end) : host;
  }
  const colonCount = (host.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    return host.split(":")[0] ?? "";
  }
  return host;
}

export function isLoopbackHost(hostHeader: string | null): boolean {
  const hostname = hostnameFromHostHeader(hostHeader);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function canBypassLocalDevAuth(hostHeader: string | null): boolean {
  if (process.env.NODE_ENV !== "development") {
    return false;
  }

  // Explicit, development-only opt-in for E2E suites that need to skip all
  // auth on loopback. The previous MC_LOCAL_DEV_AUTH_BYPASS=1 alias has been
  // removed; intentional loopback access for the dashboard and agents goes
  // through the local-dev session cookie, local-single-user auth mode, the
  // MC_API_KEY orchestration header, or the exact loopback healthcheck path.
  if (process.env.MC_REQUIRE_LOCAL_DEV_AUTH === "0") {
    return isLoopbackHost(hostHeader);
  }

  return false;
}

export function hasLocalDevSessionCookie(request: NextRequest, hostHeader: string | null): boolean {
  return (
    process.env.NODE_ENV === "development"
    && isLoopbackHost(hostHeader)
    && request.cookies.get(LOCAL_DEV_SESSION_COOKIE)?.value === "1"
  );
}

function getSafeLocalDevLoginReturnPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (value === "/login" || value.startsWith("/login?")) return null;
  return value;
}

function getRequestHost(request: NextRequest): string {
  return request.headers.get("host") || request.nextUrl.host;
}

type SessionLoader = typeof updateSession;

export async function middleware(request: NextRequest, sessionLoaderOrEvent: SessionLoader | unknown = updateSession) {
  const sessionLoader: SessionLoader = typeof sessionLoaderOrEvent === "function"
    ? sessionLoaderOrEvent as SessionLoader
    : updateSession;
  const { pathname } = request.nextUrl;
  const host = getRequestHost(request);
  const hasLocalDevBypass = canBypassLocalDevAuth(host);
  const hasLocalDevSession = hasLocalDevSessionCookie(request, host);
  let pendingRewriteTarget: URL | null = null;
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
      apiLog("request", payload);
    }

    return response;
  };

  if (hasLocalDevBypass && pathname === "/login") {
    const returnPath = getSafeLocalDevLoginReturnPath(request.nextUrl.searchParams.get("from"));
    if (returnPath) {
      return finalize(NextResponse.redirect(new URL(returnPath, request.nextUrl.origin), 307));
    }
  }

  if (hasLocalDevSession && pathname === "/login") {
    const returnPath = getSafeLocalDevLoginReturnPath(request.nextUrl.searchParams.get("from"));
    if (returnPath) {
      return finalize(NextResponse.redirect(new URL(returnPath, request.nextUrl.origin), 307));
    }
  }

  const csrfDecision = validateCsrfRequest({
    request,
    hasValidApiToken: isValidOrchestrationApiKey(process.env.MC_API_KEY, request.headers.get("x-mc-api-key"))
      || hasSelfAuthenticatingApiTokenSignal(request),
    hasExplicitLocalDevBypass: hasLocalDevBypass,
  });

  if (!csrfDecision.allowed) {
    securityLog("auth.csrf_rejected", {
      requestId,
      method: request.method,
      path: pathname,
      host,
      reason: csrfDecision.reason,
    });
    return finalize(NextResponse.json(
      {
        error: {
          code: "csrf_rejected",
          message: "State-changing browser requests must originate from the same HiveRunner origin.",
          reason: csrfDecision.reason,
        },
      },
      { status: 403 }
    ));
  }

  if (!pathname.startsWith("/api/") && !pathname.startsWith("/_next/")) {
    const origin = request.nextUrl.origin;
    if (pathname === "/") {
      const routeMaps = await getEdgeRouteMaps(request);
      const defaultCode = getRootRedirectCompanyCode(routeMaps);
      return finalize(NextResponse.redirect(new URL(`/${defaultCode}/dashboard`, origin), 307));
    }

    let routeMaps = shouldResolveEdgeRouteMaps(pathname)
      ? await getEdgeRouteMaps(request)
      : EDGE_ROUTE_MAPS_FALLBACK;
    const routeSegments = pathname.split("/").filter(Boolean);
    const routeRoot = routeSegments[0];
    if (
      routeRoot
      && shouldResolveEdgeRouteMaps(pathname)
      && !APP_ROOT_PREFIXES.has(routeRoot.toLowerCase())
      && !routeMaps.companyCodeToSlug[routeRoot.toUpperCase()]
    ) {
      routeMaps = await getEdgeRouteMaps(request, { forceRefresh: true });
    }

    // Bare company code (e.g. /NEV) → redirect to /{code}/dashboard so the
    // browser URL reflects the actual page and breadcrumbs resolve correctly.
    const bareSegments = routeSegments;
    if (bareSegments.length === 1 && !APP_ROOT_PREFIXES.has(bareSegments[0].toLowerCase())) {
      const code = bareSegments[0];
      const slug = routeMaps.companyCodeToSlug[code.toUpperCase()];
      if (slug) {
        return finalize(NextResponse.redirect(new URL(`/${code}/dashboard`, origin), 308));
      }
    }

    const rewriteTarget = tryCanonicalRewrite(pathname, request.nextUrl.searchParams, origin, routeMaps);
    if (rewriteTarget) {
      if (hasLocalDevBypass) {
        return finalize(NextResponse.rewrite(rewriteTarget));
      }
      pendingRewriteTarget = rewriteTarget;
    }

    const legacyTarget = pendingRewriteTarget
      ? null
      : tryLegacyRedirect(pathname, request.nextUrl.searchParams, origin, routeMaps);
    if (legacyTarget) {
      return finalize(NextResponse.redirect(legacyTarget, 308));
    }
  }

  if (hasLocalDevBypass) {
    return finalize(NextResponse.next());
  }

  if (hasLocalDevSession) {
    if (pendingRewriteTarget) {
      return finalize(NextResponse.rewrite(pendingRewriteTarget));
    }
    return finalize(NextResponse.next());
  }

  if (LOOPBACK_HEALTHCHECK_PATHS.has(pathname) && isLoopbackHost(host)) {
    return finalize(NextResponse.next());
  }

  if (SELF_AUTHENTICATING_API_PATHS.has(pathname)) {
    return finalize(NextResponse.next());
  }

  // Orchestration API uses a shared-secret header and skips user-session auth.
  // Exempt health checks. For protected orchestration routes, allow:
  // - valid x-mc-api-key, OR
  // - valid Supabase browser session (hosted mode only).
  //
  // In local-single-user mode the session loader synthesizes a local owner
  // for every request, so falling back to it here would let an unauthenticated
  // caller reach orchestration routes. Browser traffic in local mode already
  // flowed through the local-dev session / loopback bypass checks above, so
  // anything reaching this point must present the API key.
  if (pathname.startsWith(ORCHESTRATION_API_PREFIX) && !ORCHESTRATION_HEALTH_PATHS.has(pathname)) {
    const expectedApiKey = process.env.MC_API_KEY;
    const providedApiKey = request.headers.get("x-mc-api-key");
    const runAsUserId = request.headers.get(MC_RUN_AS_USER_ID_HEADER)?.trim();

    if (isValidOrchestrationApiKey(expectedApiKey, providedApiKey)) {
      return finalize(NextResponse.next());
    }

    if (runAsUserId) {
      securityLog("auth.run_as_without_api_key", {
        requestId,
        method: request.method,
        path: pathname,
        host,
      });
      return finalize(NextResponse.json(
        {
          error: {
            code: "unauthorized",
            message: "Company run-as context requires a valid X-MC-API-Key header",
          },
        },
        { status: 401 }
      ));
    }

    if (
      getAuthMode() === "local-single-user"
      && isLoopbackHost(host)
    ) {
      return finalize(NextResponse.next());
    }

    if (getAuthMode() === "supabase") {
      try {
        const { user, supabaseResponse } = await sessionLoader(request);
        if (canAccessOrchestrationApi({ expectedApiKey, providedApiKey, hasSupabaseUser: Boolean(user) })) {
          return finalize(supabaseResponse);
        }
      } catch (error) {
        securityLog("auth.hosted_orchestration_session_error", {
          requestId,
          method: request.method,
          path: pathname,
          host,
          reason: error instanceof Error ? error.message : "unknown",
        });
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
    const { user, supabaseResponse } = await sessionLoader(request);

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

    if (pendingRewriteTarget) {
      const rewriteResponse = NextResponse.rewrite(pendingRewriteTarget);
      supabaseResponse.headers.forEach((value, key) => {
        if (key.toLowerCase().startsWith("x-middleware-")) return;
        rewriteResponse.headers.set(key, value);
      });
      return finalize(rewriteResponse);
    }

    return finalize(supabaseResponse);
  } catch (error) {
    securityLog("auth.hosted_session_error", {
      requestId,
      method: request.method,
      path: pathname,
      host,
      reason: error instanceof Error ? error.message : "unknown",
    });
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
