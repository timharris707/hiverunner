import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getAuthMode, isSupabaseConfigured } from "@/lib/auth/auth-mode";
import { securityLog } from "@/lib/observability/logging";

export type SupabaseAdminAuditContext = {
  operation: string;
  reason: string;
  route?: string;
  actor?: string;
  requestId?: string;
};

function requireSupabaseConfig(action: string): void {
  if (!isSupabaseConfigured()) {
    throw new Error(
      `Supabase is not configured but '${action}' was invoked. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or switch MC_AUTH_MODE to local-single-user.`,
    );
  }
}

export function isHostedAuthMode(): boolean {
  return getAuthMode() === "supabase";
}

export async function createServerSupabaseClient() {
  requireSupabaseConfig("createServerSupabaseClient");
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // This can be called from Server Components where cookies
            // can't be set — silently ignore
          }
        },
      },
    }
  );
}

function requireAdminAuditContext(context: SupabaseAdminAuditContext): void {
  if (!context?.operation?.trim() || !context.reason?.trim()) {
    throw new Error("createAdminClient requires a privileged operation name and reason.");
  }
}

export function auditSupabaseAdminOperation(context: SupabaseAdminAuditContext): void {
  requireAdminAuditContext(context);

  securityLog("supabase_admin_operation", {
    operation: context.operation,
    reason: context.reason,
    route: context.route ?? null,
    actor: context.actor ?? null,
    requestId: context.requestId ?? null,
  }, "info");
}

/** Admin client using service role key — bypasses RLS and must be audited. */
export function createAdminClient(context: SupabaseAdminAuditContext) {
  requireAdminAuditContext(context);
  requireSupabaseConfig("createAdminClient");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "createAdminClient requires SUPABASE_SERVICE_ROLE_KEY. Configure it or avoid hosted-mode admin operations in local-single-user installs.",
    );
  }
  auditSupabaseAdminOperation({
    ...context,
    operation: `createAdminClient:${context.operation}`,
  });
  const { createClient } = require("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
