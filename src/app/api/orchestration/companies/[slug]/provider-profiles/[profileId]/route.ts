import { NextRequest, NextResponse } from "next/server";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { updateCompanyProviderProfile, type UpdateProviderProfileInput } from "@/lib/orchestration/cost-ledger";

export const dynamic = "force-dynamic";

const BILLING_MODELS = new Set([
  "metered_tokens",
  "subscription_included",
  "subscription_overage",
  "credits",
  "fixed",
  "local_free",
  "hybrid",
  "unknown",
]);

const CONNECTION_TYPES = new Set([
  "local_cli",
  "api_key",
  "env_api_key",
  "oauth",
  "subscription",
  "router",
  "local_model",
  "daemon",
  "manual",
  "unknown",
]);

const AUTH_SURFACES = new Set([
  "api_key",
  "env",
  "oauth",
  "device_login",
  "setup_token",
  "local_config",
  "none",
  "unknown",
]);

function normalizeToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[-\s]/g, "_");
  return normalized || undefined;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; profileId: string }> },
) {
  try {
    const { slug, profileId } = await params;
    const body = await req.json() as Record<string, unknown>;
    const input: UpdateProviderProfileInput = {};

    const billingModel = normalizeToken(body.billingModel);
    if (billingModel) {
      if (!BILLING_MODELS.has(billingModel)) {
        throw new OrchestrationApiError(400, "invalid_billing_model", "Invalid billing model");
      }
      input.billingModel = billingModel as UpdateProviderProfileInput["billingModel"];
    }

    const connectionType = normalizeToken(body.connectionType);
    if (connectionType) {
      if (!CONNECTION_TYPES.has(connectionType)) {
        throw new OrchestrationApiError(400, "invalid_connection_type", "Invalid connection type");
      }
      input.connectionType = connectionType as UpdateProviderProfileInput["connectionType"];
    }

    const authSurface = normalizeToken(body.authSurface);
    if (authSurface) {
      if (!AUTH_SURFACES.has(authSurface)) {
        throw new OrchestrationApiError(400, "invalid_auth_surface", "Invalid auth surface");
      }
      input.authSurface = authSurface as UpdateProviderProfileInput["authSurface"];
    }

    if (typeof body.biller === "string") {
      input.biller = body.biller;
    }

    if (typeof body.isActive === "boolean") {
      input.isActive = body.isActive;
    }

    const profile = updateCompanyProviderProfile(slug, decodeURIComponent(profileId), input);
    return NextResponse.json({ profile });
  } catch (error) {
    if (error instanceof OrchestrationApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[company-provider-profile:patch] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
