import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const ATTACHMENTS_DIR = path.join(process.cwd(), "data", "attachments");

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const taskId = formData.get("taskId") as string;
    const files = [
      ...formData.getAll("files"),
      ...formData.getAll("file"),
    ].filter((value): value is File => value instanceof File);

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const taskDir = path.join(ATTACHMENTS_DIR, taskId || "unsorted");
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
      const ext = path.extname(file.name);
      const sanitizedName = path.basename(file.name);
      const storedName = `${id}${ext}`;

      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(path.join(taskDir, storedName), buffer);

      attachments.push({
        id,
        name: sanitizedName,
        type: file.type || "application/octet-stream",
        size: buffer.length,
        path: `${taskId || "unsorted"}/${storedName}`,
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

    const fullPath = path.resolve(ATTACHMENTS_DIR, filePath);
    if (!fullPath.startsWith(ATTACHMENTS_DIR)) {
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

    const fullPath = path.resolve(ATTACHMENTS_DIR, filePath);
    if (!fullPath.startsWith(ATTACHMENTS_DIR)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    await fs.unlink(fullPath);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[attachments] Delete error:", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
