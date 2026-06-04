import { NextRequest, NextResponse } from "next/server";
import type { ContentDraft } from "@/types/content";
import { loadContentDrafts, saveContentDrafts } from "@/lib/content-drafts-store";

// GET /api/content/drafts/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const drafts = loadContentDrafts();
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

  const drafts = loadContentDrafts();
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
  saveContentDrafts(drafts);

  return NextResponse.json({ draft: updated });
}

// DELETE /api/content/drafts/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const drafts = loadContentDrafts();
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

  drafts.splice(idx, 1);
  saveContentDrafts(drafts);

  return NextResponse.json({ ok: true });
}
