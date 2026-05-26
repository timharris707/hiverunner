import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { agentProfileQuerySchema } from "@/lib/orchestration/contracts";
import { syncAgentCoreFiles } from "@/lib/orchestration/agent-core-files";
import { getCompanyAgentProfile } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

function parseRecordJson(raw: string | null): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function bodyRecord(body: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = body[key];
  if (value === null || value === undefined) return {};
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

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
    const parsedBody = await req.json();
    const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
      ? parsedBody as Record<string, unknown>
      : {};
    const db = getOrchestrationDb();

    // Resolve company by id, slug, or company code (scoped update)
    const company = db
      .prepare(
        `SELECT id, slug, name
         FROM companies
         WHERE archived_at IS NULL
           AND (id = ? OR slug = ? OR company_code = ?)
         LIMIT 1`
      )
      .get(slug, slug, slug) as { id: string; slug: string; name: string } | undefined;

    if (!company) {
      return errorResponse(404, "company_not_found", "Company not found");
    }

    // Resolve agent within the company by id OR slug OR exact lower(name)
    const agent = db
      .prepare(
        `SELECT id, runtime_config_json, permissions_json
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
      .get(company.id, agentId, agentId, agentId) as {
        id: string;
        runtime_config_json: string | null;
        permissions_json: string | null;
      } | undefined;

    if (!agent) {
      return errorResponse(404, "agent_not_found", "Agent not found");
    }

    const now = new Date().toISOString();

    if ("name" in body && (body.name === null || body.name === undefined || String(body.name).trim() === "")) {
      return errorResponse(400, "agent_name_required", "Agent name cannot be blank");
    }

    const updateScalarField = (column: string, bodyKey: string, maxLength = 500) => {
      if (!(bodyKey in body)) return;
      const raw = body[bodyKey];
      const value = raw === null || raw === undefined || raw === "" ? null : String(raw).trim().slice(0, maxLength);
      db.prepare(`UPDATE agents SET ${column} = ?, updated_at = ? WHERE id = ?`).run(value, now, agent.id);
    };

    updateScalarField("name", "name", 160);
    updateScalarField("role", "title", 240);
    updateScalarField("role", "role", 240);
    updateScalarField("model", "model", 240);

    if ("reportsTo" in body) {
      const requestedReportsTo = typeof body.reportsTo === "string" ? body.reportsTo.trim() : "";
      if (requestedReportsTo) {
        const reportingAgent = db
          .prepare(
            `SELECT id
             FROM agents
             WHERE company_id = ?
               AND archived_at IS NULL
               AND (id = ? OR slug = ? OR lower(name) = lower(?) OR openclaw_agent_id = ?)
             LIMIT 1`
          )
          .get(company.id, requestedReportsTo, requestedReportsTo, requestedReportsTo, requestedReportsTo) as { id: string } | undefined;
        if (!reportingAgent) {
          return errorResponse(400, "manager_not_found", `Could not resolve reportsTo target "${requestedReportsTo}" within this company`);
        }
        if (reportingAgent.id === agent.id) {
          return errorResponse(400, "self_reporting", "Agent cannot report to itself");
        }
        db.prepare("UPDATE agents SET reporting_to = ?, updated_at = ? WHERE id = ?").run(reportingAgent.id, now, agent.id);
      } else {
        db.prepare("UPDATE agents SET reporting_to = NULL, updated_at = ? WHERE id = ?").run(now, agent.id);
      }
    }

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
    const updateTextField = (column: string, bodyKey: string) => updateScalarField(column, bodyKey, 200);

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

    if ("runtimeConfig" in body) {
      const runtimeConfigPatch = bodyRecord(body, "runtimeConfig");
      if (!runtimeConfigPatch) {
        return errorResponse(400, "runtime_config_invalid", "runtimeConfig must be an object");
      }
      db
        .prepare("UPDATE agents SET runtime_config_json = ?, updated_at = ? WHERE id = ?")
        .run(
          JSON.stringify({
            ...parseRecordJson(agent.runtime_config_json),
            ...runtimeConfigPatch,
          }),
          now,
          agent.id,
        );
    }

    if ("permissions" in body) {
      const permissionsPatch = bodyRecord(body, "permissions");
      if (!permissionsPatch) {
        return errorResponse(400, "permissions_invalid", "permissions must be an object");
      }
      db
        .prepare("UPDATE agents SET permissions_json = ?, updated_at = ? WHERE id = ?")
        .run(
          JSON.stringify({
            ...parseRecordJson(agent.permissions_json),
            ...permissionsPatch,
          }),
          now,
          agent.id,
        );
    }

    const coreFiles = syncAgentCoreFiles(db, agent.id);

    return NextResponse.json({ success: true, coreFiles });
  } catch (error) {
    return handleRouteError(error, "company-agent:patch");
  }
}
