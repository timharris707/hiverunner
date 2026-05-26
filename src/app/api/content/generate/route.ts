import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readFileSync } from "fs";
import { AGENT_CONFIGS } from "@/config/agents";
import type { ContentDraft, ContentType, ContentPlatform } from "@/types/content";

const DRAFTS_FILE = path.join(process.cwd(), "data", "content-drafts.json");

// ─── Gateway config ─────────────────────────────────────────────────────────────

function getGatewayConfig(): { url: string; token: string } {
  if (process.env.GATEWAY_URL && process.env.GATEWAY_TOKEN) {
    return { url: process.env.GATEWAY_URL, token: process.env.GATEWAY_TOKEN };
  }
  try {
    const configPath = path.join(process.env.HOME || "", ".openclaw/openclaw.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const port = config?.gateway?.port || 18789;
    const token = config?.gateway?.auth?.token || "";
    return { url: `http://127.0.0.1:${port}/v1/chat/completions`, token };
  } catch {
    return { url: "http://127.0.0.1:18789/v1/chat/completions", token: "" };
  }
}

async function callQuill(systemPrompt: string, userPrompt: string): Promise<string> {
  const gateway = getGatewayConfig();
  const response = await fetch(gateway.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${gateway.token}`,
    },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gateway error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ─── System prompts per content type ──────────────────────────────────────────

function buildSystemPrompt(type: ContentType, context?: string): string {
  const quillConfig = AGENT_CONFIGS.find((a) => a.id === "quill");
  const quillPersona = quillConfig?.persona || "You are Quill, a creative writer and marketing strategist.";

  const contextLine = context?.trim()
    ? `\n\nBrand context: ${context.trim()}`
    : "";

  const typeInstructions: Record<ContentType, string> = {
    tweet: `You draft punchy, high-engagement tweets for posting on X (Twitter). Rules:
- Maximum 280 characters for the main tweet (you may add a thread continuation if warranted)
- Hook immediately — no fluff
- End with 2–4 relevant hashtags on a new line
- Tone: direct, bold, opinionated
- Output format (JSON):
{
  "content": "main tweet text (no hashtags inline — put them at end)",
  "hashtags": ["#tag1", "#tag2"],
  "thread": "optional thread continuation (null if not needed)"
}`,

    linkedin: `You draft professional yet compelling LinkedIn posts. Rules:
- 150–400 words
- Hook in first line (no "I am excited to announce" garbage)
- Paragraph breaks every 2–3 sentences for scrollability
- Story-driven: problem → insight → takeaway
- 3–5 hashtags at the end
- Output format (JSON):
{
  "content": "full post text",
  "hashtags": ["#tag1", "#tag2"]
}`,

    "youtube-idea": `You generate a complete YouTube video concept. Output format (JSON):
{
  "title": "compelling click-worthy title (under 70 chars)",
  "content": "2–3 paragraph video description for YouTube (includes what the video covers)",
  "hook": "opening 15-second hook script — what you say to grab the viewer",
  "videoTags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "thumbnailIdea": "describe the thumbnail concept (text, imagery, colors)"
}`,

    "blog-intro": `You draft the opening section of a blog post (title + intro + first section). Rules:
- Title: magnetic, SEO-friendly
- Intro: 2–3 sentences max — hook them hard
- First section: 200–300 words, establish the core insight
- Output format (JSON):
{
  "title": "blog post title",
  "content": "intro + first section text",
  "hashtags": ["#tag1", "#tag2"]
}`,
  };

  return `${quillPersona}

You are generating marketing content for a mortgage/lending intelligence platform. Write as if you are the brand voice — authoritative, sharp, not corporate-speak.${contextLine}

Content type instructions:
${typeInstructions[type]}

Respond ONLY with valid JSON matching the format above. No markdown fences. No explanation outside the JSON.`;
}

// ─── Draft persistence ─────────────────────────────────────────────────────────

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

// ─── POST /api/content/generate ───────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, topic, context } = body as {
      type: ContentType;
      topic: string;
      context?: string;
    };

    if (!type || !topic?.trim()) {
      return NextResponse.json({ error: "type and topic are required" }, { status: 400 });
    }

    const validTypes: ContentType[] = ["tweet", "linkedin", "youtube-idea", "blog-intro"];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: `type must be one of: ${validTypes.join(", ")}` }, { status: 400 });
    }

    const systemPrompt = buildSystemPrompt(type, context);
    const userPrompt = `Generate ${type} content about: ${topic.trim()}`;

    const raw = await callQuill(systemPrompt, userPrompt);

    // Parse Quill's JSON response
    let parsed: Record<string, unknown>;
    try {
      // Strip potential markdown fences if model included them despite instruction
      const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // If parsing fails, wrap raw text as content
      parsed = { content: raw };
    }

    const platformMap: Record<ContentType, ContentPlatform> = {
      tweet: "x",
      linkedin: "linkedin",
      "youtube-idea": "youtube",
      "blog-intro": "blog",
    };

    const now = new Date().toISOString();
    const draft: ContentDraft = {
      id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      platform: platformMap[type],
      topic: topic.trim(),
      content: (parsed.content as string) || raw,
      hashtags: (parsed.hashtags as string[]) || [],
      title: (parsed.title as string) || undefined,
      videoTags: (parsed.videoTags as string[]) || (parsed.tags as string[]) || undefined,
      hook: (parsed.hook as string) || undefined,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };

    const drafts = loadDrafts();
    drafts.unshift(draft);
    saveDrafts(drafts);

    return NextResponse.json({ draft });
  } catch (err) {
    console.error("[content/generate] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
