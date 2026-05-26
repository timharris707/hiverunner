import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import type { ContentDraft } from "@/types/content";

const DRAFTS_FILE = path.join(process.cwd(), "data", "content-drafts.json");

function loadDrafts(): ContentDraft[] {
  try {
    if (!fs.existsSync(DRAFTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(DRAFTS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveDrafts(drafts: ContentDraft[]): void {
  fs.writeFileSync(DRAFTS_FILE, JSON.stringify(drafts, null, 2));
}

// GET /api/content/drafts/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const drafts = loadDrafts();
  const draft = drafts.find((d) => d.id === id);
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ draft });
}

// PATCH /api/content/drafts/[id] — approve, reject, or edit content
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const drafts = loadDrafts();
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date().toISOString();
  const existing = drafts[idx];

  const updated: ContentDraft = {
    ...existing,
    updatedAt: now,
  };

  // Handle status transitions
  if (body.status === "approved") {
    updated.status = "approved";
    updated.approvedAt = now;
    updated.notes = undefined;
  } else if (body.status === "rejected") {
    updated.status = "rejected";
    updated.notes = body.notes || "";
  } else if (body.status === "draft") {
    // Reset to draft (un-approve)
    updated.status = "draft";
    updated.approvedAt = undefined;
  }

  // Allow content edits
  if (body.content !== undefined) updated.content = body.content;
  if (body.title !== undefined) updated.title = body.title;
  if (body.hashtags !== undefined) updated.hashtags = body.hashtags;
  if (body.notes !== undefined) updated.notes = body.notes;

  drafts[idx] = updated;
  saveDrafts(drafts);

  return NextResponse.json({ draft: updated });
}

// DELETE /api/content/drafts/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const drafts = loadDrafts();
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

  drafts.splice(idx, 1);
  saveDrafts(drafts);

  return NextResponse.json({ ok: true });
}
