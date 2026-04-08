import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { createApproval } from "@/lib/orchestration/service/approval";
import { generateAgentAvatarDataUrl } from "@/lib/orchestration/avatar";

export const dynamic = "force-dynamic";

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await req.json();
    const { name, role, model, emoji, reportsTo, personality, mission } = body;

    if (!name?.trim() || !role?.trim()) {
      return NextResponse.json({ error: "Name and role are required" }, { status: 400 });
    }

    const db = getOrchestrationDb();

    // Find company (alias-aware)
    const resolved = resolveCompanyIdBySlug(slug, db);
    if (!resolved) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    const company = db.prepare("SELECT id, name, description, workspace_root FROM companies WHERE id = ?").get(resolved.id) as { id: string; name: string; description: string; workspace_root: string };

    const agentSlug = slugify(name);
    const agentWorkspacePath = path.join(company.workspace_root, "agents", agentSlug);
    fs.mkdirSync(agentWorkspacePath, { recursive: true });
    const agentModel = model || "anthropic/claude-sonnet-4-6";
    let openclawAgentId: string | null = null;

    try {
      const cmd = `openclaw agents add ${agentSlug} --workspace "${agentWorkspacePath}" --model "${agentModel}" --non-interactive --json`;
      const output = execSync(cmd, { encoding: "utf-8", timeout: 30000 });
      try {
        const parsed = JSON.parse(output);
        openclawAgentId =
          (typeof parsed.id === "string" && parsed.id.trim()) ||
          (typeof parsed.agentId === "string" && parsed.agentId.trim()) ||
          (typeof parsed.agent_id === "string" && parsed.agent_id.trim()) ||
          agentSlug;
      } catch {
        openclawAgentId = agentSlug;
      }
    } catch (e) {
      console.warn("[agents/hire] openclaw agents add failed", e);
    }

    // Ensure openclaw_agent_id uniqueness — if the same agent name exists in
    // another company the UNIQUE constraint would fail. Append company slug to
    // disambiguate when there's a collision.
    if (openclawAgentId) {
      const existing = db.prepare("SELECT 1 FROM agents WHERE openclaw_agent_id = ? LIMIT 1").get(openclawAgentId);
      if (existing) {
        openclawAgentId = `${openclawAgentId}-${resolved.slug.slice(0, 12)}`;
      }
    }

    const now = new Date().toISOString();
    const agentId = randomUUID();

    const resolvedEmoji = typeof emoji === "string" && emoji.trim() ? emoji.trim() : "pixel";
    const requestedReportsTo = typeof reportsTo === "string" && reportsTo.trim() ? reportsTo.trim() : "";
    const normalizedReportsTo = requestedReportsTo.trim();
    const reportingAgent = db.prepare(
      `SELECT id, name FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL
         AND (id = ? OR lower(name) = lower(?) OR openclaw_agent_id = ?)
       LIMIT 1`
    ).get(company.id, normalizedReportsTo, normalizedReportsTo, normalizedReportsTo) as { id: string; name: string } | undefined;
    const reportingToId = reportingAgent?.id ?? null;
    const resolvedReportsTo = reportingAgent?.name ?? (reportingToId ? normalizedReportsTo : "Unassigned");
    const resolvedPersonality = typeof personality === "string" && personality.trim()
      ? personality.trim()
      : `Role: ${role.trim()} at ${company.name}`;
    const resolvedMission = typeof mission === "string" && mission.trim()
      ? mission.trim()
      : `${name.trim()} owns ${role.trim()} responsibilities for ${company.name}.`;

    // Generate a deterministic SVG avatar for the new agent
    const companyTheme = (() => {
      const row = db.prepare(
        `SELECT theme_name, theme_prompt_template, theme_keywords_json FROM companies WHERE id = ? LIMIT 1`
      ).get(company.id) as { theme_name: string | null; theme_prompt_template: string | null; theme_keywords_json: string | null } | undefined;
      return {
        name: row?.theme_name ?? "Corporate Noir",
        promptTemplate: row?.theme_prompt_template ?? "dark premium portrait, cohesive team style",
        keywords: (() => { try { return JSON.parse(row?.theme_keywords_json ?? "[]"); } catch { return []; } })(),
      };
    })();
    const avatarUrl = generateAgentAvatarDataUrl({
      name: name.trim(),
      role: role.trim(),
      personality: resolvedPersonality,
      emoji: resolvedEmoji,
      theme: companyTheme,
    });

    db.prepare(
      `INSERT INTO agents
        (id, company_id, name, emoji, role, personality, model, status, avatar_url, openclaw_agent_id, reporting_to, skills_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'paused', ?, ?, ?, '[]', ?, ?)`
    ).run(
      agentId,
      company.id,
      name.trim(),
      resolvedEmoji,
      role.trim(),
      resolvedPersonality,
      agentModel,
      avatarUrl,
      openclawAgentId,
      reportingToId,
      now,
      now,
    );

    // Create hire approval — agent stays paused until approved
    createApproval({
      companyIdOrSlug: company.id,
      type: "hire_agent",
      requestedByAgentId: reportingToId ?? undefined,
      payload: {
        agentId,
        agentName: name.trim(),
        role: role.trim(),
        model: agentModel,
        emoji: resolvedEmoji,
      },
    });

    // Create instruction files
    const agentDir = agentWorkspacePath;

    fs.writeFileSync(
      path.join(agentDir, "IDENTITY.md"),
      `# IDENTITY.md - Who Am I?\n\n- **Name:** ${name.trim()}\n- **Role:** ${role.trim()}\n- **Company:** ${company.name}\n- **Reports To:** ${resolvedReportsTo}\n- **Emoji:** ${resolvedEmoji}\n`
    );

    fs.writeFileSync(
      path.join(agentDir, "SOUL.md"),
      `# SOUL.md - Who I Am\n\n_I am ${name.trim()}, ${role.trim()} at ${company.name}._\n\n## Core Truths\n- I own ${role.trim()} work for ${company.name}.\n- I report to ${resolvedReportsTo}.\n- I move work forward without waiting around.\n\n## Personality / Focus\n${resolvedPersonality}\n\n## Mission\n${resolvedMission}\n`
    );

    fs.writeFileSync(
      path.join(agentDir, "AGENTS.md"),
      `# AGENTS.md - Working Agreement\n\n## Company\n- **Company:** ${company.name}\n- **Workspace:** ${agentWorkspacePath}\n\n## Role\n- **Agent:** ${name.trim()}\n- **Function:** ${role.trim()}\n- **Reports To:** ${resolvedReportsTo}\n\n## Operating Rule\n- Stay focused on your role, ship clean work, and escalate blockers clearly.\n`
    );

    fs.writeFileSync(
      path.join(agentDir, "HEARTBEAT.md"),
      `# HEARTBEAT.md — Operating Loop\n\n## On Every Wake\n1. Review assigned work\n2. Check for blockers\n3. Advance the highest-value task\n4. Report blockers clearly\n`
    );

    fs.writeFileSync(
      path.join(agentDir, "TOOLS.md"),
      `# TOOLS.md\n\nLocal notes for ${name.trim()} at ${company.name}.\n\n- Add role-specific commands, references, and environment notes here.\n`
    );

    return NextResponse.json({
      success: true,
      agent: { id: agentId, name: name.trim(), openclawAgentId }
    }, { status: 201 });
  } catch (error: unknown) {
    console.error("[agents/hire] error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}