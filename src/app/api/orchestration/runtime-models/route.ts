import { NextRequest, NextResponse } from "next/server";

import { discoverRuntimeModels } from "@/lib/orchestration/runtime-models";

export const dynamic = "force-dynamic";

function runtimeModelResponse(input: Record<string, unknown>) {
  const provider = typeof input.provider === "string" ? input.provider.trim() : "";
  if (!provider) {
    return NextResponse.json({ error: "Runtime provider is required" }, { status: 400 });
  }

  const result = discoverRuntimeModels({
    provider,
    command: typeof input.command === "string" ? input.command : null,
    commandPath: typeof input.commandPath === "string" ? input.commandPath : null,
  });

  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    return runtimeModelResponse({
      provider: params.get("provider"),
      command: params.get("command"),
      commandPath: params.get("commandPath"),
    });
  } catch (error) {
    console.error("[runtime-models:get] error:", error);
    return NextResponse.json({ error: "Failed to discover runtime models" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return runtimeModelResponse(body);
  } catch (error) {
    console.error("[runtime-models:post] error:", error);
    return NextResponse.json({ error: "Failed to discover runtime models" }, { status: 500 });
  }
}
