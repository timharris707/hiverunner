import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { agentProfileQuerySchema } from "@/lib/orchestration/contracts";
import { getCompanyAgentProfile } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; agentId: string }> }
) {
  try {
    const { slug, agentId } = await params;
    const query = agentProfileQuerySchema.parse({
      executionLimit: req.nextUrl.searchParams.get("executionLimit") ?? undefined,
      activityLimit: req.nextUrl.searchParams.get("activityLimit") ?? undefined,
    });

    return NextResponse.json(
      getCompanyAgentProfile({
        companyIdOrSlug: slug,
        agentId,
        executionLimit: query.executionLimit,
        activityLimit: query.activityLimit,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid agent profile query", error.flatten());
    }
    return handleRouteError(error, "company-agent-profile:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; agentId: string }> }
) {
  try {
    const { slug, agentId } = await params;
    const body = await req.json();
    const db = getOrchestrationDb();

    // Resolve company by id OR slug (scoped update)
    const company = db
      .prepare(
        `SELECT id, slug, name
         FROM companies
         WHERE archived_at IS NULL
           AND (id = ? OR slug = ?)
         LIMIT 1`
      )
      .get(slug, slug) as { id: string; slug: string; name: string } | undefined;

    if (!company) {
      return errorResponse(404, "company_not_found", "Company not found");
    }

    // Resolve agent within the company by id OR slug OR exact lower(name)
    const agent = db
      .prepare(
        `SELECT id
         FROM agents
         WHERE archived_at IS NULL
           AND company_id = ?
           AND (
             id = ?
             OR lower(slug) = lower(?)
             OR lower(name) = lower(?)
           )
         LIMIT 1`
      )
      .get(company.id, agentId, agentId, agentId) as { id: string } | undefined;

    if (!agent) {
      return errorResponse(404, "agent_not_found", "Agent not found");
    }

    const now = new Date().toISOString();

    // Avatar update (supports clearing with null/empty string)
    if ("avatarUrl" in body) {
      const avatarUrl = body.avatarUrl === null || body.avatarUrl === "" ? null : String(body.avatarUrl);
      db.prepare("UPDATE agents SET avatar_url = ?, updated_at = ? WHERE id = ?").run(avatarUrl, now, agent.id);
    }

    // Optional emoji update (back-compat)
    if (typeof body.emoji === "string" && body.emoji.length > 0) {
      db.prepare("UPDATE agents SET emoji = ?, updated_at = ? WHERE id = ?").run(body.emoji, now, agent.id);
    }

    // Personality / system prompt update
    if (typeof body.personality === "string") {
      db.prepare("UPDATE agents SET personality = ?, updated_at = ? WHERE id = ?").run(body.personality, now, agent.id);
    }

    // Avatar identity fields (all optional, independently updatable). Passing null
    // or empty string clears the field; omitting the key leaves it untouched.
    const updateTextField = (column: string, bodyKey: string) => {
      if (!(bodyKey in body)) return;
      const raw = body[bodyKey];
      const value = raw === null || raw === undefined || raw === "" ? null : String(raw).slice(0, 200);
      db.prepare(`UPDATE agents SET ${column} = ?, updated_at = ? WHERE id = ?`).run(value, now, agent.id);
    };

    updateTextField("avatar_style_id", "avatarStyleId");
    updateTextField("avatar_gender", "avatarGender");
    updateTextField("avatar_hair_color", "avatarHairColor");
    updateTextField("avatar_hair_length", "avatarHairLength");
    updateTextField("avatar_eye_color", "avatarEyeColor");
    updateTextField("avatar_vibe", "avatarVibe");
    updateTextField("voice_id", "voiceId");

    if ("avatarAge" in body) {
      const raw = body.avatarAge;
      let ageValue: number | null = null;
      if (raw !== null && raw !== undefined && raw !== "") {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 120) {
          return errorResponse(400, "avatar_age_invalid", "avatarAge must be a number between 1 and 120");
        }
        ageValue = Math.round(parsed);
      }
      db.prepare("UPDATE agents SET avatar_age = ?, updated_at = ? WHERE id = ?").run(ageValue, now, agent.id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, "company-agent:patch");
  }
}
