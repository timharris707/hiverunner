import { after, NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  assignDefaultSkillsForAgent,
  ensureDefaultCompanySkills,
} from "@/lib/orchestration/default-skills";
import { generateAgentDossier, writeAgentDossierFiles } from "@/lib/orchestration/agent-dossier";
import { defaultAgentIconToken } from "@/lib/orchestration/avatar-icons";
import { createCompany } from "@/lib/orchestration/company-service";
import { refreshEdgeRouteMapCache } from "@/lib/orchestration/edge-route-map-service";
import { triggerTaskExecution } from "@/lib/orchestration/execution";
import { ensureOpenClawAgentScaffold } from "@/lib/orchestration/openclaw-agent-scaffold";
import { upsertCompanyRuntime } from "@/lib/orchestration/runtime-registry";
import { provisionSelectedStarterAgentsForCreateFull } from "@/lib/orchestration/create-full-starter-team-provisioning";
import {
  buildOpenClawRuntimeId,
  ensureUniqueAgentRuntimeSlug,
  resolveProvisionedOpenClawAgentId,
} from "@/lib/orchestration/runtime-identifiers";
import {
  buildCanonicalCompanyPath,
  buildCanonicalDashboardPath,
} from "@/lib/orchestration/route-paths";
import { canAutonomouslyExecuteCompany } from "@/lib/orchestration/service/dev-execution-test-mode";
import {
  defaultCommandForRuntimeProvider,
  normalizeModelForRuntimeProvider,
  normalizeRuntimeProvider,
} from "@/lib/orchestration/service/company-agent-provisioning";
import { readSelectedStarterAgents } from "@/lib/orchestration/starter-team-templates";
import { createTask } from "@/lib/orchestration/service/task";
import { resolveRequestCompanyOwnerUserId } from "@/lib/orchestration/request-auth";
import {
  ensureAgentSourceWorkspaceLink,
  ensureCompanySourceWorkspaceLink,
  ensureCompanyWorkspaceScaffold,
  resolveCompanyAgentWorkspacePath,
} from "@/lib/workspaces/company-paths";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const APP_ROOT = process.env.MC_APP_ROOT?.trim() || process.cwd();

function slugify(s: string) {
  return s
    .replace(/'/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function readRuntimeProviderInput(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["runtimeProvider", "provider", "adapterType"]) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  return null;
}

function inferRuntimeProviderFromModel(model: unknown): string | null {
  if (typeof model !== "string") return null;
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith("openai-codex/") || normalized.startsWith("openai/") || normalized.startsWith("codex/")) return "codex";
  if (normalized.startsWith("anthropic/")) return "anthropic";
  if (normalized.startsWith("google/gemini-") || normalized.startsWith("gemini-")) return "gemini";
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveCeoRuntimeProvider(ceo: unknown): string {
  const explicitProvider = readRuntimeProviderInput(ceo);
  if (explicitProvider) {
    return normalizeRuntimeProvider({ runtimeProvider: explicitProvider });
  }
  const inferredProvider = typeof ceo === "object" && ceo !== null
    ? inferRuntimeProviderFromModel((ceo as Record<string, unknown>).model)
    : null;
  return inferredProvider ?? "manual";
}

async function triggerImmediateHeartbeatRun(runId: string) {
  try {
    const { executeHeartbeatRun } = await import("@/lib/orchestration/engine/engine");
    const result = await executeHeartbeatRun(runId);
    if (result.status === "failed") {
      console.warn("[create-full] immediate heartbeat execution failed:", result.error);
    }
  } catch (error) {
    console.warn("[create-full] immediate heartbeat execution failed (non-fatal):", error);
  }
}

function generateWorkspaceAgentsMd(
  companyName: string,
  companyDescription: string,
  ceoName: string,
  teammates: Array<{ name: string; role: string }> = [],
): string {
  return `# AGENTS.md - ${companyName}

## Company
${companyDescription || "Mission to be defined."}

## Team
- **${ceoName}** \u{1F3AF} — CEO
${teammates.map((agent) => `- **${agent.name}** — ${agent.role}`).join("\n")}

## Workspace
This is the workspace for ${companyName}.
`;
}

async function resolveCreateFullOwnerUserId(req: NextRequest): Promise<string | undefined> {
  if (!req.headers || typeof req.headers.get !== "function") return undefined;
  return resolveRequestCompanyOwnerUserId(req);
}

/* ------------------------------------------------------------------ */
/*  POST handler                                                       */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { company, owner, project, ceo, task, starterTeam } = body;

    // ---------- Validate required fields ----------
    if (!company?.name?.trim()) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }
    if (!ceo?.name?.trim()) {
      return NextResponse.json({ error: "CEO name is required" }, { status: 400 });
    }
    if (!task?.title?.trim()) {
      return NextResponse.json({ error: "Task title is required" }, { status: 400 });
    }
    if (!owner?.displayName?.trim()) {
      return NextResponse.json({ error: "Owner name is required" }, { status: 400 });
    }
    if (!owner?.email?.trim() || !String(owner.email).includes("@")) {
      return NextResponse.json({ error: "Owner email is required" }, { status: 400 });
    }
    let selectedStarterAgents: ReturnType<typeof readSelectedStarterAgents>;
    try {
      selectedStarterAgents = readSelectedStarterAgents(starterTeam, { ceoName: ceo.name.trim() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid starter team payload";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const db = getOrchestrationDb();
    const now = new Date().toISOString();
    const requestOwnerUserId = await resolveCreateFullOwnerUserId(req);

    // ---------- Derive slugs ----------
    const companySlug = slugify(company.slug || company.name);
    if (!companySlug) {
      return NextResponse.json({ error: "Unable to derive company slug" }, { status: 400 });
    }

    // Check slug uniqueness against both current slugs and historical aliases.
    const existingSlug = db.prepare("SELECT 1 FROM companies WHERE slug = ? LIMIT 1").get(companySlug);
    const existingAlias = db.prepare("SELECT 1 FROM company_slug_aliases WHERE slug_alias = ? LIMIT 1").get(companySlug);
    if (existingSlug || existingAlias) {
      return NextResponse.json({ error: `Company slug "${companySlug}" already exists` }, { status: 409 });
    }

    // ---------- 1. Create company via canonical workspace contract ----------
    const createdCompany = createCompany({
      name: company.name.trim(),
      slug: companySlug,
      description: company.description?.trim() || "",
      status: "active",
      owner: {
        displayName: owner.displayName.trim(),
        email: owner.email.trim(),
      },
      ownerUserId: requestOwnerUserId,
    }).company;
    const companyId = createdCompany.id;
    const workspacePath = createdCompany.workspace.root;
    ensureCompanyWorkspaceScaffold(workspacePath);
    ensureCompanySourceWorkspaceLink(workspacePath);
    ensureDefaultCompanySkills(companyId);

    // ---------- 2. Create project ----------
    // If the user provided a project, use it. Otherwise auto-create a
    // default "Operations" project so the first task always has a home.
    const projectSourceWorkspaceRoot =
      project && typeof project === "object" && typeof project.sourceWorkspaceRoot === "string"
        ? project.sourceWorkspaceRoot.trim()
        : "";
    const effectiveProject = (project && project.name?.trim())
      ? {
          name: project.name.trim(),
          description: project.description?.trim() || "",
          status: project.status || "active",
          sourceWorkspaceRoot: projectSourceWorkspaceRoot || null,
        }
      : {
          name: "Operations",
          description: "Default project for company operations and CEO directives.",
          status: "active",
          sourceWorkspaceRoot: null,
        };

    const projectId = randomUUID();
    // Slug uniqueness is company-scoped (migration v40).
    const rootProjectSlug = slugify(effectiveProject.name);
    let projectSlug = rootProjectSlug;
    let slugSuffix = 1;
    while (
      db.prepare(
        "SELECT 1 FROM projects WHERE company_id = ? AND slug = ? AND archived_at IS NULL LIMIT 1"
      ).get(companyId, projectSlug)
    ) {
      slugSuffix++;
      projectSlug = `${rootProjectSlug}-${slugSuffix}`;
    }
    const projectDir = path.join(workspacePath, "projects", projectSlug);
    fs.mkdirSync(projectDir, { recursive: true });
    const projectSettings = effectiveProject.sourceWorkspaceRoot
      ? {
          workspace: {
            sourceRoot: path.resolve(effectiveProject.sourceWorkspaceRoot),
          },
        }
      : {};

    db.prepare(
      `INSERT INTO projects
        (id, slug, name, description, status, company_id, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      projectId,
      projectSlug,
      effectiveProject.name,
      effectiveProject.description,
      effectiveProject.status,
      companyId,
      JSON.stringify(projectSettings),
      now,
      now,
    );

    // ---------- 3. Register CEO agent ----------
    const ceoSlug = slugify(ceo.name.trim());
    const ceoWorkspacePath = resolveCompanyAgentWorkspacePath(workspacePath, ceoSlug);
    if (!ceoWorkspacePath) {
      return NextResponse.json({ error: "Company workspace root is missing" }, { status: 500 });
    }
    fs.mkdirSync(ceoWorkspacePath, { recursive: true });
    ensureAgentSourceWorkspaceLink(ceoWorkspacePath, workspacePath);
    const requestedRuntimeProvider = resolveCeoRuntimeProvider(ceo ?? {});
    const explicitOpenClawAgentId = typeof ceo === "object" && ceo !== null
      ? readString((ceo as Record<string, unknown>).openclawAgentId) ??
        readString((ceo as Record<string, unknown>).openclaw_agent_id)
      : null;
    const runtimeProvider =
      requestedRuntimeProvider === "openclaw" &&
      !explicitOpenClawAgentId &&
      process.env.MC_ENABLE_OPENCLAW_AGENT_PROVISIONING !== "1"
        ? "manual"
        : requestedRuntimeProvider;
    const model = normalizeModelForRuntimeProvider(runtimeProvider, ceo.model);
    const runtimeCommand = defaultCommandForRuntimeProvider(runtimeProvider);

    const agentId = randomUUID();
    const agentRuntimeSlug = ensureUniqueAgentRuntimeSlug(db, companyId, ceo.name.trim());
    const shouldProvisionOpenClaw =
      runtimeProvider === "openclaw" &&
      !explicitOpenClawAgentId &&
      process.env.MC_ENABLE_OPENCLAW_AGENT_PROVISIONING === "1";
    const openclawRuntimeId = shouldProvisionOpenClaw
      ? buildOpenClawRuntimeId({
          db,
          companyId,
          companyRuntimeSlug: createdCompany.runtimeSlug,
          agentId,
          agentRuntimeSlug,
        })
      : null;
    let openclawAgentId: string | null = runtimeProvider === "openclaw" ? explicitOpenClawAgentId : null;

    if (shouldProvisionOpenClaw && openclawRuntimeId) {
      try {
        const cmd = `openclaw agents add ${openclawRuntimeId} --workspace "${ceoWorkspacePath}" --model "${model}" --non-interactive --json`;
        const output = execSync(cmd, { encoding: "utf-8", timeout: 60000 });
        openclawAgentId = resolveProvisionedOpenClawAgentId(output, openclawRuntimeId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[create-full] openclaw agents add failed for "${openclawRuntimeId}": ${msg}`);
      }
      openclawAgentId = openclawAgentId ?? openclawRuntimeId;
    } else if (requestedRuntimeProvider === "openclaw" && runtimeProvider === "manual") {
      console.warn(
        "[create-full] skipped openclaw agents add; set MC_ENABLE_OPENCLAW_AGENT_PROVISIONING=1 only in an isolated OpenClaw config environment.",
      );
    }

    // ---------- 4. Create agent in orchestration DB ----------
    const companyDesc = company.description?.trim() || "";
    const guidance = ceo.guidance?.trim() || "";
    const ceoDossier = generateAgentDossier({
      name: ceo.name.trim(),
      role: "CEO",
      companyName: company.name.trim(),
      projectName: effectiveProject.name,
      projectSlug,
      reportsTo: "Board / Local Owner",
      emoji: defaultAgentIconToken("CEO"),
      personality: guidance || null,
      mission: companyDesc || `Build and operate ${company.name.trim()}.`,
      reason: guidance || null,
    });
    db.prepare(
      `INSERT INTO agents
        (id, company_id, project_id, name, slug, runtime_slug, emoji, role, personality, avatar_url,
         avatar_style_id, avatar_gender, avatar_age, avatar_hair_color, avatar_hair_length,
         avatar_eye_color, avatar_vibe, voice_id, model, adapter_type, status, openclaw_agent_id, skills_json,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'CEO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, '[]', ?, ?)`,
    ).run(
      agentId,
      companyId,
      projectId,
      ceo.name.trim(),
      ceoSlug,
      agentRuntimeSlug,
      ceoDossier.emoji,
      ceoDossier.personality,
      null,
      ceoDossier.avatar.styleId,
      ceoDossier.avatar.gender,
      ceoDossier.avatar.age,
      ceoDossier.avatar.hairColor,
      ceoDossier.avatar.hairLength,
      ceoDossier.avatar.eyeColor,
      ceoDossier.avatar.vibe,
      ceoDossier.voice.voiceId,
      model,
      runtimeProvider,
      openclawAgentId,
      now,
      now,
    );

    // ---------- 5. Generate CEO instruction files ----------
    const agentDir = ceoWorkspacePath;

    writeAgentDossierFiles({
      agentWorkspacePath: agentDir,
      dossier: ceoDossier,
    });
    if (openclawAgentId) {
      ensureOpenClawAgentScaffold({
        openclawAgentId,
        name: ceo.name.trim(),
        role: "CEO",
        personality: ceoDossier.personality,
        projectName: effectiveProject.name,
        projectSlug,
        model,
        skills: ceoDossier.capabilities,
        soulMarkdown: ceoDossier.files.soulMd,
        voiceId: ceoDossier.voice.voiceId,
        avatar: ceoDossier.avatar,
      });
    }
    upsertCompanyRuntime({
      companyIdOrSlug: companyId,
      agentId,
      provider: runtimeProvider,
      runtimeSlug: agentRuntimeSlug,
      displayName: `${ceo.name.trim()} runtime`,
      runtimeKind: runtimeProvider === "manual" ? "manual" : "cli",
      scope: "agent",
      command: runtimeCommand || null,
      status: "unknown",
      workspaceRoot: ceoWorkspacePath,
      metadata: {
        source: "create-full",
        requestedRuntimeProvider,
        ...(openclawAgentId ? { openclawAgentId } : {}),
        model,
      },
    });
    assignDefaultSkillsForAgent(companyId, agentId);

    const {
      agents: provisionedStarterAgents,
      warnings: starterTeamProvisioningWarnings,
    } = provisionSelectedStarterAgentsForCreateFull({
      selectedStarterAgents,
      companyId,
      requestedByAgentId: agentId,
      projectId,
      db,
    });

    // ---------- 6. Create workspace-level files ----------
    fs.writeFileSync(
      path.join(workspacePath, "AGENTS.md"),
      generateWorkspaceAgentsMd(company.name.trim(), companyDesc, ceo.name.trim(), provisionedStarterAgents),
    );
    
    // Create mc-tool CLI shortcut for agents
    const mcToolTarget = path.join(workspacePath, "scripts", "mc-tool");
    const mcToolSource = path.join(APP_ROOT, "scripts", "mc-tool.js");
    fs.writeFileSync(
      mcToolTarget,
      `#!/bin/sh\nexec node "${mcToolSource}" "$@"\n`
    );
    fs.chmodSync(mcToolTarget, "755");

    // ---------- 7. Create and start first task ----------
    const createdTask = createTask({
      projectId,
      title: task.title.trim(),
      description: task.description?.trim() || "",
      priority: task.priority || "P1",
      type: "directive",
      status: "in-progress",
      assignee: agentId,
      labels: [],
      createdBy: createdCompany.owner?.id ?? owner.displayName.trim(),
    });
    const taskId = createdTask.task.id;
    const taskKey = createdTask.task.key;
    if (!taskKey) {
      throw new Error("Initial company task was created without a task key.");
    }

    // ---------- 8. Refresh edge route map cache ----------
    refreshEdgeRouteMapCache();

    // ---------- 8b. Kick off execution for the first task ----------
    let initialExecution: Awaited<ReturnType<typeof triggerTaskExecution>>;
    try {
      initialExecution = await triggerTaskExecution({
        taskId,
        idempotencyKey: `company-launch:${companyId}:initial-task`,
        reason: "company_creation_kickoff",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[create-full] initial task execution was not queued: ${message}`);
      initialExecution = {
        status: "skipped",
        reason: "company_creation_kickoff",
        mode: "manual",
        error: message,
      } as unknown as Awaited<ReturnType<typeof triggerTaskExecution>>;
    }

    // Claim the queued run immediately so dashboard-first landing feels alive.
    if (
      initialExecution.status === "queued" &&
      initialExecution.runId &&
      canAutonomouslyExecuteCompany(companyId)
    ) {
      after(async () => {
        await triggerImmediateHeartbeatRun(initialExecution.runId!);
      });
    }

    // ---------- 9. Return success ----------
    const dashboardHref = buildCanonicalDashboardPath(createdCompany.code);
    const taskHref = buildCanonicalCompanyPath(
      createdCompany.code,
      `/tasks/${encodeURIComponent(taskKey)}`,
    );

    return NextResponse.json(
      {
        success: true,
        company: {
          id: companyId,
          slug: createdCompany.slug,
          code: createdCompany.code,
          name: company.name.trim(),
          owner: createdCompany.owner,
        },
        project: { id: projectId, slug: projectSlug, name: effectiveProject.name },
        agent: { id: agentId, name: ceo.name.trim(), runtimeProvider, openclawAgentId },
        starterTeam: {
          selectedCount: provisionedStarterAgents.length,
          failedCount: starterTeamProvisioningWarnings.length,
          agents: provisionedStarterAgents,
          warnings: starterTeamProvisioningWarnings,
        },
        task: { id: taskId, key: taskKey, title: task.title.trim(), href: taskHref },
        taskKey,
        taskHref,
        dashboardHref,
        initialExecution,
        workspace: workspacePath,
        agentDir,
        filesCreated: [
          path.join(agentDir, "IDENTITY.md"),
          path.join(agentDir, "SOUL.md"),
          path.join(agentDir, "AGENTS.md"),
          path.join(agentDir, "HEARTBEAT.md"),
          path.join(workspacePath, "AGENTS.md"),
        ],
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    console.error("[create-full] error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
