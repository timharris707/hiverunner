import { NextRequest, NextResponse } from "next/server";
import type { RedditOpportunity } from "@/types/factory";

/**
 * POST /api/factory/scan — Scan Reddit for SaaS/app opportunities.
 *
 * Uses Reddit's public JSON API (no auth required) to search subreddits
 * for posts describing pain points, feature requests, or gaps that could
 * become micro-SaaS products.
 *
 * Body: { subreddits?: string[], query?: string, limit?: number }
 */

const DEFAULT_SUBREDDITS = [
  "SaaS",
  "SideProject",
  "startups",
  "Entrepreneur",
  "indiehackers",
  "webdev",
  "selfhosted",
  "smallbusiness",
];

const PAIN_KEYWORDS = [
  "wish there was",
  "looking for a tool",
  "anyone know",
  "frustrated with",
  "alternative to",
  "is there a",
  "need a solution",
  "pain point",
  "would pay for",
  "built something",
  "scratching my own itch",
  "no good options",
  "existing tools suck",
  "feature request",
];

interface RedditPost {
  data: {
    id: string;
    title: string;
    selftext: string;
    subreddit: string;
    permalink: string;
    score: number;
    num_comments: number;
    created_utc: number;
  };
}

function scorePainSignal(title: string, body: string): number {
  const text = `${title} ${body}`.toLowerCase();
  let score = 0;
  for (const keyword of PAIN_KEYWORDS) {
    if (text.includes(keyword)) score += 15;
  }
  // Bonus for question marks (indicates seeking)
  score += (title.match(/\?/g) || []).length * 5;
  // Bonus for length (detailed posts = real pain)
  if (body.length > 500) score += 10;
  if (body.length > 1500) score += 10;
  return Math.min(100, Math.max(0, score));
}

function extractProblem(title: string, body: string): string {
  // Use first sentence of body if available, otherwise title
  if (body.length > 10) {
    const firstSentence = body.split(/[.!?\n]/).filter((s) => s.trim().length > 10)[0];
    if (firstSentence) return firstSentence.trim().slice(0, 200);
  }
  return title.slice(0, 200);
}

function extractKeywords(title: string, body: string): string[] {
  const text = `${title} ${body}`.toLowerCase();
  const candidates = [
    "saas", "api", "automation", "dashboard", "analytics", "workflow",
    "integration", "monitoring", "scheduling", "billing", "crm", "ai",
    "machine learning", "scraping", "notification", "reporting", "marketplace",
    "plugin", "extension", "template", "boilerplate",
  ];
  return candidates.filter((kw) => text.includes(kw));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const subreddits: string[] = body.subreddits || DEFAULT_SUBREDDITS;
  const query: string = body.query || "looking for tool OR wish there was OR need solution OR alternative to";
  const limit: number = Math.min(body.limit || 10, 25);

  const opportunities: RedditOpportunity[] = [];

  // Search across requested subreddits
  const subredditStr = subreddits.join("+");
  const url = `https://www.reddit.com/r/${subredditStr}/search.json?q=${encodeURIComponent(query)}&sort=relevance&t=week&limit=${limit}&restrict_sr=on`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "HiveRunner/1.0 (factory-scanner)" },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Reddit API returned ${res.status}`, opportunities: [] },
        { status: 502 }
      );
    }

    const data = await res.json();
    const posts: RedditPost[] = data?.data?.children || [];
    const now = new Date().toISOString();

    for (const post of posts) {
      const { id, title, selftext, subreddit, permalink, score, num_comments } = post.data;
      const viabilityScore = scorePainSignal(title, selftext);

      // Only include posts with some pain signal
      if (viabilityScore < 10 && score < 20) continue;

      opportunities.push({
        id: `reddit-${id}`,
        title,
        subreddit,
        url: `https://www.reddit.com${permalink}`,
        score,
        commentCount: num_comments,
        problem: extractProblem(title, selftext),
        targetAudience: `r/${subreddit} community`,
        viabilityScore,
        keywords: extractKeywords(title, selftext),
        scannedAt: now,
      });
    }

    // Sort by viability score descending
    opportunities.sort((a, b) => b.viabilityScore - a.viabilityScore);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to scan Reddit: ${err instanceof Error ? err.message : "unknown"}`, opportunities: [] },
      { status: 502 }
    );
  }

  return NextResponse.json({ opportunities, scannedAt: new Date().toISOString() });
}
