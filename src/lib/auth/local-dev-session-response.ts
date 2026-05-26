import { randomUUID } from "node:crypto";

import { createServerClient } from "@supabase/ssr";
import { getAuthMode, getLocalOwner, isSupabaseConfigured } from "@/lib/auth/auth-mode";
import { LOCAL_DEV_SESSION_COOKIE } from "@/lib/auth/local-dev-session";
import {
  auditSupabaseAdminOperation,
  createAdminClient,
  createServerSupabaseClient,
  type SupabaseAdminAuditContext,
} from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

type LocalDevCredentials = {
  email: string;
  password: string;
};

type SupabaseSessionClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;
type SupabaseSessionContext = {
  supabase: SupabaseSessionClient;
  applyCookies(response: NextResponse): void;
};
type SupabaseSessionFactory = (request: NextRequest) => Promise<SupabaseSessionClient | SupabaseSessionContext>;
type SupabaseAdminFactory = typeof createAdminClient;

const LOCAL_DEV_EMAIL_ENV = "MC_LOCAL_DEV_EMAIL";
const LOCAL_DEV_PASSWORD_ENV = "MC_LOCAL_DEV_PASSWORD";
const LOCAL_DEV_AUTO_PROVISION_ENV = "MC_LOCAL_DEV_AUTO_PROVISION";
const DEFAULT_LOCAL_DEV_EMAIL = "local-dev@localhost.test";

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

export function isLocalDevSessionRequestAllowed(request: NextRequest): boolean {
  const host = request.headers.get("host") || request.nextUrl.host;
  if (!isLoopbackHost(host)) return false;
  // Local-single-user installs use this endpoint as the explicit local owner session path.
  if (getAuthMode() === "local-single-user") return true;
  return process.env.NODE_ENV === "development";
}

function buildLocalDevSessionCookie(response: NextResponse): void {
  response.cookies.set(LOCAL_DEV_SESSION_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

function buildLocalSingleUserResponse(): NextResponse {
  const owner = getLocalOwner();
  const response = NextResponse.json(
    {
      success: true,
      user: {
        id: owner.id,
        email: owner.email,
      },
      mode: "local-single-user",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
  buildLocalDevSessionCookie(response);
  return response;
}

async function createRouteSupabaseSessionClient(request: NextRequest): Promise<SupabaseSessionContext> {
  const cookiesToSet: Array<{
    name: string;
    value: string;
    options: Parameters<NextResponse["cookies"]["set"]>[2];
  }> = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(nextCookiesToSet) {
          cookiesToSet.push(...nextCookiesToSet);
        },
      },
    },
  ) as SupabaseSessionClient;

  return {
    supabase,
    applyCookies(response) {
      cookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
    },
  };
}

function normalizeSupabaseSessionContext(
  value: SupabaseSessionClient | SupabaseSessionContext,
): SupabaseSessionContext {
  if ("supabase" in value && "applyCookies" in value) {
    return value;
  }

  return {
    supabase: value,
    applyCookies() {},
  };
}

function isRegisteredUserError(error: { message?: string } | null | undefined): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes("already") && message.includes("registered");
}

async function findUserIdByEmail(
  admin: ReturnType<SupabaseAdminFactory>,
  email: string,
  auditContext: SupabaseAdminAuditContext,
): Promise<string | null> {
  const normalizedEmail = email.toLowerCase();

  for (let page = 1; page <= 10; page += 1) {
    auditSupabaseAdminOperation({
      ...auditContext,
      operation: "auth.admin.listUsers",
    });
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) {
      throw new Error(error.message);
    }

    const user = data.users.find((candidate: { email?: string }) => candidate.email?.toLowerCase() === normalizedEmail);
    if (user?.id) {
      return user.id;
    }

    if (data.users.length < 100) {
      return null;
    }
  }

  return null;
}

async function provisionLocalDevCredentials(
  email: string,
  adminFactory: SupabaseAdminFactory,
  auditContext: SupabaseAdminAuditContext,
): Promise<LocalDevCredentials> {
  const password = `local-dev-${randomUUID().replaceAll("-", "")}`;
  const admin = adminFactory(auditContext);
  const metadata = {
    purpose: "hiverunner-local-dev-auth",
    provisionedBy: "api/auth/local-dev/session",
  };

  auditSupabaseAdminOperation({
    ...auditContext,
    operation: "auth.admin.createUser",
  });
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });

  if (error) {
    if (!isRegisteredUserError(error)) {
      throw new Error(error.message);
    }

    const userId = await findUserIdByEmail(admin, email, auditContext);
    if (!userId) {
      throw new Error(`Local dev user ${email} exists but could not be resolved`);
    }

    auditSupabaseAdminOperation({
      ...auditContext,
      operation: "auth.admin.updateUserById",
    });
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: metadata,
    });

    if (updateError) {
      throw new Error(updateError.message);
    }
  }

  return { email, password };
}

async function readCredentials(
  request: NextRequest,
  adminFactory: SupabaseAdminFactory,
): Promise<LocalDevCredentials | null> {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const email = typeof body?.email === "string"
    ? body.email.trim()
    : process.env[LOCAL_DEV_EMAIL_ENV]?.trim();
  const password = typeof body?.password === "string"
    ? body.password
    : process.env[LOCAL_DEV_PASSWORD_ENV];

  if (email && password) {
    return { email, password };
  }

  const autoProvision = body?.autoProvision === true || process.env[LOCAL_DEV_AUTO_PROVISION_ENV] === "1";
  if (autoProvision) {
    return provisionLocalDevCredentials(email || DEFAULT_LOCAL_DEV_EMAIL, adminFactory, {
      operation: "local-dev-session.auto-provision",
      reason: "Provision loopback-only local dev Supabase user for hosted-mode development.",
      route: "/api/auth/local-dev/session",
      requestId: request.headers.get("x-request-id")?.trim() || undefined,
    });
  }

  if (!email || !password) {
    return null;
  }

  return { email, password };
}

export async function createLocalDevSessionResponse(
  request: NextRequest,
  supabaseFactory: SupabaseSessionFactory = createRouteSupabaseSessionClient,
  adminFactory: SupabaseAdminFactory = createAdminClient,
): Promise<NextResponse> {
  if (!isLocalDevSessionRequestAllowed(request)) {
    return NextResponse.json(
      { success: false, error: "Not found" },
      { status: 404 },
    );
  }

  if (getAuthMode() === "local-single-user" || !isSupabaseConfigured()) {
    return buildLocalSingleUserResponse();
  }

  let credentials: LocalDevCredentials | null;
  try {
    credentials = await readCredentials(request, adminFactory);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Local dev user could not be provisioned",
      },
      { status: 500 },
    );
  }

  if (!credentials) {
    return NextResponse.json(
      {
        success: false,
        error: `Local dev credentials required: provide email/password, set ${LOCAL_DEV_EMAIL_ENV}/${LOCAL_DEV_PASSWORD_ENV}, or request loopback-only autoProvision`,
      },
      { status: 400 },
    );
  }

  const sessionContext = normalizeSupabaseSessionContext(await supabaseFactory(request));
  const { supabase } = sessionContext;
  const {
    data: { user },
    error,
  } = await supabase.auth.signInWithPassword(credentials);

  if (error || !user) {
    return NextResponse.json(
      { success: false, error: error?.message ?? "Local dev session could not be created" },
      { status: 401 },
    );
  }

  const response = NextResponse.json(
    {
      success: true,
      user: {
        id: user.id,
        email: user.email,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
  sessionContext.applyCookies(response);
  buildLocalDevSessionCookie(response);
  return response;
}
