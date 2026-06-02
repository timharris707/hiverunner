import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { isPathContained } from "@/lib/workspaces/delete-safety";

export const dynamic = "force-dynamic";

const ATTACHMENTS_DIR = path.resolve(process.cwd(), "data", "attachments");
const SAFE_ATTACHMENT_SEGMENT = /^[A-Za-z0-9._-]{1,160}$/;

function sanitizeAttachmentSegment(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!SAFE_ATTACHMENT_SEGMENT.test(trimmed)) return null;
  return trimmed;
}

async function resolveAttachmentPath(relativePath: string, options: { forWrite?: boolean } = {}): Promise<string | null> {
  const normalized = path.normalize(relativePath).replace(/^[/\\]+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null;
  }

  const segments = normalized.split(/[\\/]+/);
  if (segments.some((segment) => !sanitizeAttachmentSegment(segment))) {
    return null;
  }

  const fullPath = path.resolve(ATTACHMENTS_DIR, ...segments);
  if (!isPathContained(ATTACHMENTS_DIR, fullPath)) {
    return null;
  }

  try {
    const link = await fs.lstat(fullPath);
    if (link.isSymbolicLink()) return null;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : null;
    if (!options.forWrite || code !== "ENOENT") return null;
  }

  if (!options.forWrite) {
    const [realRoot, realTarget] = await Promise.all([
      fs.realpath(ATTACHMENTS_DIR),
      fs.realpath(fullPath),
    ]);
    if (!isPathContained(realRoot, realTarget)) return null;
  }

  return fullPath;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const rawTaskId = typeof formData.get("taskId") === "string" ? formData.get("taskId") as string : "";
    const taskId = rawTaskId ? sanitizeAttachmentSegment(rawTaskId) : "unsorted";
    if (!taskId) {
      return NextResponse.json({ error: "Invalid taskId" }, { status: 400 });
    }
    const files = [
      ...formData.getAll("files"),
      ...formData.getAll("file"),
    ].filter((value): value is File => value instanceof File);

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const taskDir = await resolveAttachmentPath(taskId, { forWrite: true });
    if (!taskDir) {
      return NextResponse.json({ error: "Invalid taskId" }, { status: 400 });
    }
    await fs.mkdir(taskDir, { recursive: true });

    const attachments: Array<{
      id: string;
      name: string;
      type: string;
      size: number;
      path: string;
    }> = [];

    for (const file of files) {
      const id = crypto.randomUUID();
      const ext = sanitizeAttachmentSegment(path.extname(file.name).replace(/^\./, "")) ?? "bin";
      const sanitizedName = path.basename(file.name);
      const storedName = `${id}.${ext}`;
      const targetPath = await resolveAttachmentPath(`${taskId}/${storedName}`, { forWrite: true });
      if (!targetPath) {
        return NextResponse.json({ error: "Invalid upload path" }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(targetPath, buffer);

      attachments.push({
        id,
        name: sanitizedName,
        type: file.type || "application/octet-stream",
        size: buffer.length,
        path: `${taskId}/${storedName}`,
      });
    }

    return NextResponse.json({ success: true, attachments });
  } catch (error) {
    console.error("[attachments] Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get("path");

    if (!filePath) {
      return NextResponse.json({ error: "No path provided" }, { status: 400 });
    }

    const fullPath = await resolveAttachmentPath(filePath);
    if (!fullPath) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const buffer = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();

    const mimeMap: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".pdf": "application/pdf",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".md": "text/markdown",
      ".txt": "text/plain",
    };

    const contentType = mimeMap[ext] || "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[attachments] Read error:", error);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { path: filePath } = await request.json();

    if (!filePath) {
      return NextResponse.json({ error: "No path provided" }, { status: 400 });
    }

    const fullPath = await resolveAttachmentPath(filePath);
    if (!fullPath) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    await fs.unlink(fullPath);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[attachments] Delete error:", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
