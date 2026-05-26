import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { syncAgentCoreFiles } from "@/lib/orchestration/agent-core-files";
import { agentProfileQuerySchema } from "@/lib/orchestration/contracts";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { getAgentProfile } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().trim().min(1),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = paramsSchema.parse(await params);
    const query = agentProfileQuerySchema.parse({
      company: req.nextUrl.searchParams.get("company") ?? undefined,
      executionLimit: req.nextUrl.searchParams.get("executionLimit") ?? undefined,
      activityLimit: req.nextUrl.searchParams.get("activityLimit") ?? undefined,
    });

    return NextResponse.json(
      getAgentProfile({
        agentId: id,
        companyIdOrSlug: query.company,
        executionLimit: query.executionLimit,
        activityLimit: query.activityLimit,
      })
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(400, "validation_error", "Invalid agent profile query", error.flatten());
    }
    return handleRouteError(error, "agent-profile:get");
  }
}

async function readJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    throw new SyntaxError("invalid_json_body");
  }
}

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = paramsSchema.parse(await params);
    const body = await readJsonBody(req);
    const db = getOrchestrationDb();
    const existingAgent = db
      .prepare(
        `SELECT id, company_id, runtime_config_json, permissions_json
         FROM agents
         WHERE archived_at IS NULL
           AND (id = @id OR slug = @id OR lower(name) = lower(@id))
         LIMIT 1`,
      )
      .get({ id }) as {
        id: string;
        company_id: string;
        runtime_config_json: string | null;
        permissions_json: string | null;
      } | undefined;

    if (!existingAgent) {
      return errorResponse(404, "agent_not_found", `Agent "${id}" not found`);
    }

    const updates: string[] = [];
    const values: Record<string, unknown> = { rowId: existingAgent.id };
    const fieldMap: Record<string, string> = {
      name: "name",
      emoji: "emoji",
      title: "role",
      personality: "personality",
      model: "model",
      avatarStyleId: "avatar_style_id",
      avatarGender: "avatar_gender",
      avatarHairColor: "avatar_hair_color",
      avatarHairLength: "avatar_hair_length",
      avatarEyeColor: "avatar_eye_color",
      avatarVibe: "avatar_vibe",
      voiceId: "voice_id",
    };

    if ("name" in body && (body.name === null || body.name === undefined || String(body.name).trim() === "")) {
      return errorResponse(400, "agent_name_required", "Agent name cannot be blank");
    }

    for (const [bodyKey, column] of Object.entries(fieldMap)) {
      if (bodyKey in body) {
        updates.push(`${column} = @${column}`);
        values[column] = typeof body[bodyKey] === "string" && body[bodyKey].trim()
          ? body[bodyKey].trim()
          : null;
      }
    }

    if ("avatarUrl" in body) {
      updates.push("avatar_url = @avatar_url");
      values.avatar_url = typeof body.avatarUrl === "string" && body.avatarUrl.trim()
        ? body.avatarUrl.trim()
        : null;
    }

    if ("avatarAge" in body) {
      let ageValue: number | null = null;
      const raw = body.avatarAge;
      if (raw !== null && raw !== undefined && raw !== "") {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 120) {
          return errorResponse(400, "avatar_age_invalid", "avatarAge must be a number between 1 and 120");
        }
        ageValue = Math.round(parsed);
      }
      updates.push("avatar_age = @avatar_age");
      values.avatar_age = ageValue;
    }

    if ("reportsTo" in body) {
      const requestedReportsTo = typeof body.reportsTo === "string" ? body.reportsTo.trim() : "";
      if (requestedReportsTo) {
        const reportingAgent = db
          .prepare(
            `SELECT id
             FROM agents
             WHERE company_id = @companyId
               AND archived_at IS NULL
               AND (id = @reportsTo OR slug = @reportsTo OR lower(name) = lower(@reportsTo) OR openclaw_agent_id = @reportsTo)
             LIMIT 1`,
          )
          .get({
            companyId: existingAgent.company_id,
            reportsTo: requestedReportsTo,
          }) as { id: string } | undefined;

        if (!reportingAgent) {
          return errorResponse(400, "manager_not_found", `Could not resolve reportsTo target "${requestedReportsTo}" within this company`);
        }
        if (reportingAgent.id === existingAgent.id) {
          return errorResponse(400, "self_reporting", "Agent cannot report to itself");
        }

        updates.push("reporting_to = @reporting_to");
        values.reporting_to = reportingAgent.id;
      } else {
        updates.push("reporting_to = NULL");
      }
    }

    if ("runtimeConfig" in body) {
      const runtimeConfigPatch = bodyRecord(body, "runtimeConfig");
      if (!runtimeConfigPatch) {
        return errorResponse(400, "runtime_config_invalid", "runtimeConfig must be an object");
      }
      updates.push("runtime_config_json = @runtime_config_json");
      values.runtime_config_json = JSON.stringify({
        ...parseRecordJson(existingAgent.runtime_config_json),
        ...runtimeConfigPatch,
      });
    }

    if ("permissions" in body) {
      const permissionsPatch = bodyRecord(body, "permissions");
      if (!permissionsPatch) {
        return errorResponse(400, "permissions_invalid", "permissions must be an object");
      }
      updates.push("permissions_json = @permissions_json");
      values.permissions_json = JSON.stringify({
        ...parseRecordJson(existingAgent.permissions_json),
        ...permissionsPatch,
      });
    }

    if (updates.length > 0) {
      updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      db.prepare(`UPDATE agents SET ${updates.join(", ")} WHERE id = @rowId`).run(values);
    }

    const coreFiles = syncAgentCoreFiles(db, existingAgent.id);

    return NextResponse.json({ ok: true, agentId: existingAgent.id, updated: Object.keys(body), coreFiles });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(400, "validation_error", "Invalid agent profile request", error.flatten());
    }
    if (error instanceof SyntaxError && error.message === "invalid_json_body") {
      return errorResponse(400, "invalid_json", "Request body must be valid JSON");
    }
    return handleRouteError(error, "agent-profile:patch");
  }
}
