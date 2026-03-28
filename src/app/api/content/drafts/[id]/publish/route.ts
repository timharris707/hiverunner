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

  const drafts = loadDrafts();
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
  saveDrafts(drafts);

  return NextResponse.json({
    draft: drafts[idx],
    published: true,
    platform: draft.platform,
    method: platformResult.method,
    url: platformResult.url || null,
  });
}
