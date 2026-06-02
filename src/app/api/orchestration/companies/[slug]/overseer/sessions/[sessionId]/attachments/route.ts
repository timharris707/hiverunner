import { createHash, randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { assertOverseerSessionCompany } from "@/lib/orchestration/overseer/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILES = 12;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function safeSegment(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "file";
}

function buildStoredFileName(originalName: string, id: string): string {
  const parsed = path.parse(originalName || "upload");
  const base = safeSegment(parsed.name || parsed.base || "upload");
  const extension = parsed.ext
    ? parsed.ext.toLowerCase().replace(/[^a-z0-9.]+/g, "")
    : "";
  return `${id}-${base}${extension}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
) {
  try {
    const { slug, sessionId } = await params;
    const session = assertOverseerSessionCompany({ sessionId, companyIdOrSlug: slug });
    const form = await req.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if (files.length === 0) {
      return errorResponse(400, "missing_files", "No files were uploaded.");
    }
    if (files.length > MAX_FILES) {
      return errorResponse(400, "too_many_files", `Upload at most ${MAX_FILES} files at a time.`);
    }

    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        return errorResponse(413, "file_too_large", `${file.name || "Upload"} is larger than 50 MB.`);
      }
    }

    const uploadDir = path.join(session.workspaceRoot, "overseer", "sessions", session.id, "attachments");
    await mkdir(uploadDir, { recursive: true });

    const attachments: Array<Record<string, unknown>> = [];
    for (const file of files) {
      const originalName = file.name || "upload";
      const id = randomUUID();
      const filename = buildStoredFileName(originalName, id);
      const filePath = path.join(uploadDir, filename);
      const bytes = Buffer.from(await file.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await writeFile(filePath, bytes);
      attachments.push({
        id,
        name: originalName,
        originalName,
        storedName: filename,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        byteSize: file.size,
        sha256,
        path: filePath,
        uploadedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({ attachments });
  } catch (error) {
    return handleRouteError(error, "overseer-session-attachments:post");
  }
}
