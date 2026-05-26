import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError, OrchestrationApiError } from "@/lib/orchestration/api";
import {
  listModelSourceCredentials,
  saveModelSourceCredential,
} from "@/lib/orchestration/model-source-credentials";

export const dynamic = "force-dynamic";

const optionalKeySchema = z.string().trim().min(1).max(10000).optional();

const providerKeysSchema = z.object({
  openaiApiKey: optionalKeySchema,
  geminiApiKey: optionalKeySchema,
});

export async function POST(req: NextRequest) {
  try {
    const parsed = providerKeysSchema.parse(await req.json());
    const saved: { openai: boolean; gemini: boolean } = {
      openai: false,
      gemini: false,
    };

    if (parsed.openaiApiKey) {
      saveModelSourceCredential({ sourceId: "openai", credentialValue: parsed.openaiApiKey });
      saved.openai = true;
    }

    if (parsed.geminiApiKey) {
      saveModelSourceCredential({ sourceId: "google", credentialValue: parsed.geminiApiKey });
      saved.gemini = true;
    }

    if (!saved.openai && !saved.gemini) {
      throw new OrchestrationApiError(400, "provider_key_required", "Enter at least one provider key to save.");
    }

    return NextResponse.json({
      saved,
      modelSources: listModelSourceCredentials(),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "invalid_provider_key_payload", "Provider key payload is invalid.", error.flatten());
    }
    return handleRouteError(error, "setup-provider-keys:post");
  }
}
