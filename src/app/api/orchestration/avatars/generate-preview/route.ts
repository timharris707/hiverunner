import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { AvatarProviderUnavailableError, generateAvatarPreviews } from "@/lib/orchestration/avatar-provider";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      agentName = "Agent",
      agentRole = "Agent",
      agentEmoji = "🤖",
      agentPersonality = "",
      styleId = "cyber-organic",
      gender = "androgynous",
      count = 4,
      age = null,
      hairColor = null,
      hairLength = null,
      eyeColor = null,
      vibe = null,
    } = body as {
      agentName?: string;
      agentRole?: string;
      agentEmoji?: string;
      agentPersonality?: string;
      styleId?: string;
      gender?: string;
      count?: number;
      age?: number | null;
      hairColor?: string | null;
      hairLength?: string | null;
      eyeColor?: string | null;
      vibe?: string | null;
    };

    const result = await generateAvatarPreviews({
      agentName,
      agentRole,
      agentEmoji,
      agentPersonality,
      styleId,
      gender,
      count,
      age,
      hairColor,
      hairLength,
      eyeColor,
      vibe,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AvatarProviderUnavailableError) {
      return errorResponse(
        error.status,
        error.code,
        error.setupHint,
        {
          provider: error.provider,
          optional: true,
          setupHint: error.setupHint,
        },
      );
    }
    return handleRouteError(error, "avatar-generate-preview:post");
  }
}
