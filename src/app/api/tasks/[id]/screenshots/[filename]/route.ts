import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> },
) {
  const { id, filename } = await params;

  // Prevent path traversal
  if (id.includes("..") || filename.includes("..")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const filePath = join(
    process.cwd(),
    "public",
    "screenshots",
    id,
    filename,
  );

  if (!existsSync(filePath)) {
    return NextResponse.json(
      { error: "Screenshot not found" },
      { status: 404 },
    );
  }

  const buffer = readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
