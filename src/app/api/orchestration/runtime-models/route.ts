import { NextRequest, NextResponse } from "next/server";

import { discoverRuntimeModels } from "@/lib/orchestration/runtime-models";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    if (!provider) {
      return NextResponse.json({ error: "Runtime provider is required" }, { status: 400 });
    }

    const result = discoverRuntimeModels({
      provider,
      command: typeof body.command === "string" ? body.command : null,
      commandPath: typeof body.commandPath === "string" ? body.commandPath : null,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[runtime-models:post] error:", error);
    return NextResponse.json({ error: "Failed to discover runtime models" }, { status: 500 });
  }
}
