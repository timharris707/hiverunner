import { NextRequest, NextResponse } from "next/server";
import type { ContentDraft } from "@/types/content";
import { loadContentDrafts, saveContentDrafts } from "@/lib/content-drafts-store";

// GET /api/content/drafts — list all drafts, optional ?status= filter
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status");

  let drafts = loadContentDrafts();
  if (statusFilter) {
    drafts = drafts.filter((d) => d.status === statusFilter);
  }

  return NextResponse.json({ drafts });
}

// POST /api/content/drafts — manually create a draft
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const now = new Date().toISOString();

    const draft: ContentDraft = {
      id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: body.type || "tweet",
      platform: body.platform || "x",
      topic: body.topic || "",
      content: body.content || "",
      hashtags: body.hashtags || [],
      title: body.title,
      videoTags: body.videoTags,
      hook: body.hook,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };

    const drafts = loadContentDrafts();
    drafts.unshift(draft);
    saveContentDrafts(drafts);

    return NextResponse.json({ draft }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
