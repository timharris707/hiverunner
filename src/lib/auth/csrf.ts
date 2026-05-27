import type { NextRequest } from "next/server";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type CsrfDecision =
  | { allowed: true; reason: "safe-method" | "api-token" | "explicit-local-dev-bypass" | "same-origin" }
  | { allowed: false; reason: "missing-same-origin-signal" | "cross-origin" };

export type CsrfValidationInput = {
  request: NextRequest;
  hasValidApiToken?: boolean;
  hasExplicitLocalDevBypass?: boolean;
};

export function isStateChangingMethod(method: string): boolean {
  return STATE_CHANGING_METHODS.has(method.toUpperCase());
}

function headerOrigin(request: NextRequest): string | null {
  const value = request.headers.get("origin")?.trim();
  return value || null;
}

function headerReferer(request: NextRequest): string | null {
  const value = request.headers.get("referer")?.trim();
  return value || null;
}

const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

function normalizeOriginForComparison(value: string): string {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (LOOPBACK_HOSTNAMES.has(hostname)) {
      const port = url.port || (url.protocol === "https:" ? "443" : "80");
      return `${url.protocol}//loopback:${port}`;
    }
    return url.origin;
  } catch {
    return value;
  }
}

function originFromHostHeader(request: NextRequest): string | null {
  const host = request.headers.get("host")?.trim();
  if (!host) return null;
  try {
    return new URL(`${request.nextUrl.protocol}//${host}`).origin;
  } catch {
    return null;
  }
}

function allowedRequestOrigins(request: NextRequest): Set<string> {
  const origins = new Set<string>();
  origins.add(normalizeOriginForComparison(request.nextUrl.origin));

  const hostOrigin = originFromHostHeader(request);
  if (hostOrigin) {
    origins.add(normalizeOriginForComparison(hostOrigin));
  }

  return origins;
}

function isAllowedOrigin(value: string, request: NextRequest): boolean {
  return allowedRequestOrigins(request).has(normalizeOriginForComparison(value));
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = headerOrigin(request);
  if (origin) {
    return isAllowedOrigin(origin, request);
  }

  if (request.headers.get("sec-fetch-site") === "same-origin") {
    return true;
  }

  const referer = headerReferer(request);
  if (referer) {
    return isAllowedOrigin(referer, request);
  }

  return false;
}

export function validateCsrfRequest(input: CsrfValidationInput): CsrfDecision {
  const { request } = input;

  if (!isStateChangingMethod(request.method)) {
    return { allowed: true, reason: "safe-method" };
  }

  if (input.hasValidApiToken) {
    return { allowed: true, reason: "api-token" };
  }

  if (input.hasExplicitLocalDevBypass) {
    return { allowed: true, reason: "explicit-local-dev-bypass" };
  }

  if (isSameOrigin(request)) {
    return { allowed: true, reason: "same-origin" };
  }

  return {
    allowed: false,
    reason: headerOrigin(request) || headerReferer(request) ? "cross-origin" : "missing-same-origin-signal",
  };
}
