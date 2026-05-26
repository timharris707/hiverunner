import type { NextRequest } from "next/server";

import { getAuthMode } from "@/lib/auth/auth-mode";
import { LOCAL_DEV_SESSION_COOKIE } from "@/lib/auth/local-dev-session";
import { resolveAndReconcileLocalOwnerUserId } from "@/lib/auth/local-owner-reconciliation";
import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { updateSession } from "@/lib/supabase/middleware";

export const MC_RUN_AS_USER_ID_HEADER = "x-mc-run-as-user-id";

function isValidApiKeyRequest(req: NextRequest): boolean {
  const expected = process.env.MC_API_KEY?.trim();
  const provided = req.headers.get("x-mc-api-key")?.trim();
  return Boolean(expected && provided && expected === provided);
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

function isLoopbackHost(hostHeader: string | null): boolean {
  const hostname = hostnameFromHostHeader(hostHeader);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function hasLocalDevSession(req: NextRequest): boolean {
  const host = req.headers.get("host") || req.nextUrl.host;
  return (
    process.env.NODE_ENV === "development"
    && isLoopbackHost(host)
    && req.cookies.get(LOCAL_DEV_SESSION_COOKIE)?.value === "1"
  );
}

function hasLocalSingleUserLoopbackAccess(req: NextRequest): boolean {
  const host = req.headers.get("host") || req.nextUrl.host;
  return (
    getAuthMode() === "local-single-user"
    && isLoopbackHost(host)
  );
}

function resolveLocalCompanyOwnerUserId(): string {
  return resolveAndReconcileLocalOwnerUserId(getOrchestrationDb());
}

export async function resolveRequestCompanyOwnerUserId(req: NextRequest): Promise<string | undefined> {
  if (isValidApiKeyRequest(req)) {
    const runAsUserId = req.headers.get(MC_RUN_AS_USER_ID_HEADER)?.trim();
    if (runAsUserId) return runAsUserId;
    return getAuthMode() === "local-single-user" ? resolveLocalCompanyOwnerUserId() : undefined;
  }

  if (hasLocalDevSession(req)) {
    return resolveLocalCompanyOwnerUserId();
  }

  if (hasLocalSingleUserLoopbackAccess(req)) {
    return resolveLocalCompanyOwnerUserId();
  }

  const { user } = await updateSession(req);
  if (!user?.id) {
    throw new OrchestrationApiError(401, "unauthorized", "Authentication required");
  }
  return getAuthMode() === "local-single-user" ? resolveLocalCompanyOwnerUserId() : user.id;
}
