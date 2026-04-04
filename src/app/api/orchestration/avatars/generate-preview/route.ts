import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { generateAvatarPreviews } from "@/lib/orchestration/avatar-provider";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      agentName = "Agent",
      agentRole = "Agent",
      agentEmoji = "🤖",
      agentPersonality = "",
      styleId = "cyberpunk",
      gender = "androgynous",
      count = 4,
    } = body as {
      agentName?: string;
      agentRole?: string;
      agentEmoji?: string;
      agentPersonality?: string;
      styleId?: string;
      gender?: string;
      count?: number;
    };

    const result = await generateAvatarPreviews({
      agentName,
      agentRole,
      agentEmoji,
      agentPersonality,
      styleId,
      gender,
      count,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "avatar-generate-preview:post");
  }
}
