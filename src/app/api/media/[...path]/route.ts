import { NextRequest, NextResponse } from "next/server";
import { lstat, readFile, realpath, stat } from "fs/promises";
import path from "path";

import { ALLOWED_MEDIA_PREFIXES } from "@/lib/paths";
import { isPathContained } from "@/lib/workspaces/delete-safety";

const ALLOWED_PREFIXES = ALLOWED_MEDIA_PREFIXES;

const ALLOWED_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const filePath = "/" + segments.join("/");
  const resolved = path.resolve(filePath);

  // Security: only image extensions
  const ext = path.extname(resolved).toLowerCase();
  const contentType = ALLOWED_EXTENSIONS[ext];
  if (!contentType) {
    return NextResponse.json({ error: "Not an image" }, { status: 403 });
  }

  try {
    if ((await lstat(resolved)).isSymbolicLink()) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const realTarget = await realpath(resolved);
    let allowed = false;
    for (const prefix of ALLOWED_PREFIXES) {
      try {
        const realPrefix = await realpath(prefix);
        if (isPathContained(realPrefix, realTarget)) {
          allowed = true;
          break;
        }
      } catch {
        // Ignore unavailable roots.
      }
    }
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data = await readFile(resolved);
    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
