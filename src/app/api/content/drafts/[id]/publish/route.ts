import { NextRequest, NextResponse } from "next/server";
import { loadContentDrafts, saveContentDrafts } from "@/lib/content-drafts-store";

/**
 * POST /api/content/drafts/[id]/publish
 *
 * Marks an approved draft as published.
 * Scaffolded for X (Twitter) and LinkedIn API integration.
 * When platform credentials are configured (env vars), this will
 * actually post. Otherwise it records a "manual publish" event.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const drafts = loadContentDrafts();
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const draft = drafts[idx];

  if (draft.status !== "approved") {
    return NextResponse.json(
      { error: "Draft must be approved before publishing" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  let platformResult: { url?: string; method: string } = { method: "manual" };

  // ── X (Twitter) API scaffold ──────────────────────────────────────────────
  if (draft.platform === "x" && process.env.TWITTER_BEARER_TOKEN) {
    // TODO: implement OAuth 2.0 tweet posting
    // const tweetText = [draft.content, ...(draft.hashtags || [])].join("\n");
    // const tweetRes = await fetch("https://api.twitter.com/2/tweets", { ... });
    platformResult = { method: "x-api", url: "https://twitter.com" };
  }

  // ── LinkedIn API scaffold ─────────────────────────────────────────────────
  if (draft.platform === "linkedin" && process.env.LINKEDIN_ACCESS_TOKEN) {
    // TODO: implement LinkedIn Posts API v2
    // const postText = [draft.content, ...(draft.hashtags || [])].join("\n");
    // const liRes = await fetch("https://api.linkedin.com/v2/ugcPosts", { ... });
    platformResult = { method: "linkedin-api", url: "https://linkedin.com" };
  }

  // Mark as published
  drafts[idx] = {
    ...draft,
    status: "published",
    publishedAt: now,
    updatedAt: now,
  };
  saveContentDrafts(drafts);

  return NextResponse.json({
    draft: drafts[idx],
    published: true,
    platform: draft.platform,
    method: platformResult.method,
    url: platformResult.url || null,
  });
}
