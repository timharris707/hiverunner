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

function isSameOrigin(request: NextRequest): boolean {
  const origin = headerOrigin(request);
  if (origin) {
    return origin === request.nextUrl.origin;
  }

  return request.headers.get("sec-fetch-site") === "same-origin";
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
    reason: headerOrigin(request) ? "cross-origin" : "missing-same-origin-signal",
  };
}
