import { spawn, spawnSync } from "child_process";
import { randomBytes } from "crypto";
import path from "path";

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError, OrchestrationApiError } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { resolveExecutionRoute, runtimeProviderLabel } from "@/lib/orchestration/execution-route-resolver";
import { handleHiveRunnerSymphonyTrackerRequest } from "@/lib/orchestration/symphony/tracker-shim";
import { resolveHiveRunnerLane } from "@/lib/workspaces/root";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const updateSymphonySettingsSchema = z.object({
  trackerEnabled: z.boolean().optional(),
  trackerTokenRequired: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  restartDevLane: z.boolean().optional().default(false),
});

type LaunchdValue = string | null;

function appRoot(): string {
  return process.env.MC_APP_ROOT?.trim() || process.cwd();
}

function supported(): boolean {
  return resolveHiveRunnerLane() === "dev" && (process.env.PORT || "3010") === "3010";
}

function launchctlGetenv(name: string): LaunchdValue {
  const result = spawnSync("launchctl", ["getenv", name], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return value || null;
}

function launchctlSetenv(name: string, value: string): void {
  const result = spawnSync("launchctl", ["setenv", name, value], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new OrchestrationApiError(
      500,
      "launchctl_setenv_failed",
      `Could not update ${name} in the dev service environment.`,
      result.stderr.trim() || undefined,
    );
  }
}

function launchctlUnsetenv(name: string): void {
  const result = spawnSync("launchctl", ["unsetenv", name], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new OrchestrationApiError(
      500,
      "launchctl_unsetenv_failed",
      `Could not clear ${name} from the dev service environment.`,
      result.stderr.trim() || undefined,
    );
  }
}

function boolFromEnv(value: LaunchdValue | undefined, fallback: boolean): boolean {
  if (value === "1") return true;
  if (value === "0") return false;
  return fallback;
}

function currentView(companyIdOrSlug: string, restartQueued = false) {
  const company = resolveCompanyIdBySlug(companyIdOrSlug, undefined, { includeArchived: false });
  const defaultRoute = company
    ? resolveExecutionRoute({ companyId: company.id, modelLane: "default" })
    : null;
  const defaultProvider = defaultRoute?.primary.runtimeProvider ?? null;
  const trackerHealth = handleHiveRunnerSymphonyTrackerRequest({ operation: "health" });
  const nextTrackerEnabled = launchctlGetenv("HIVERUNNER_SYMPHONY_TRACKER_ENABLED");
  const nextToken = launchctlGetenv("HIVERUNNER_SYMPHONY_TRACKER_TOKEN");
  const nextDryRun = launchctlGetenv("HIVERUNNER_SYMPHONY_DRY_RUN");
  const nextExecCommand = launchctlGetenv("SYMPHONY_EXEC_COMMAND");
  const nextCodexCommand = launchctlGetenv("HIVERUNNER_SYMPHONY_CODEX_COMMAND");

  return {
    companyIdOrSlug,
    lane: resolveHiveRunnerLane(),
    available: supported(),
    reason: supported() ? undefined : "External runner local controls are only available on the dev lane at port 3010.",
    tracker: {
      enabled: Boolean(trackerHealth.ok && (trackerHealth.result as { enabled?: boolean } | undefined)?.enabled),
      authRequired: Boolean(process.env.HIVERUNNER_SYMPHONY_TRACKER_TOKEN?.trim()),
      schema: trackerHealth.ok ? (trackerHealth.result as { schema?: string } | undefined)?.schema : undefined,
    },
    runner: {
      dryRun: process.env.HIVERUNNER_SYMPHONY_DRY_RUN === "1",
      defaultProvider,
      providerLabel: defaultProvider ? runtimeProviderLabel(defaultProvider) : null,
      execCommandConfigured: Boolean(process.env.SYMPHONY_EXEC_COMMAND?.trim()),
      codexCommandConfigured: Boolean(process.env.HIVERUNNER_SYMPHONY_CODEX_COMMAND?.trim()),
      providers: [
        { provider: "codex", label: "Codex", status: "available" },
        { provider: "anthropic", label: "Claude Code", status: "available" },
        { provider: "gemini", label: "Gemini", status: "available" },
        { provider: "hermes", label: "HERMES", status: "available" },
        { provider: "openclaw", label: "OpenClaw Gateway", status: "available" },
      ],
    },
    nextRestart: {
      trackerEnabled: boolFromEnv(nextTrackerEnabled, process.env.HIVERUNNER_SYMPHONY_TRACKER_ENABLED === "1"),
      trackerTokenConfigured: Boolean(nextToken),
      dryRun: boolFromEnv(nextDryRun, process.env.HIVERUNNER_SYMPHONY_DRY_RUN === "1"),
      execCommandConfigured: Boolean(nextExecCommand),
      codexCommandConfigured: Boolean(nextCodexCommand),
    },
    restartQueued,
  };
}

function queueDevRestart(): void {
  const root = appRoot();
  const logPath = path.join(root, "data", "symphony-settings-restart.log");
  const child = spawn(
    "/bin/sh",
    [
      "-lc",
      `sleep 0.5; cd ${JSON.stringify(root)} && scripts/lane.sh dev restart >> ${JSON.stringify(logPath)} 2>&1`,
    ],
    {
      cwd: root,
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const company = resolveCompanyIdBySlug(slug, undefined, { includeArchived: false });
    if (!company) return errorResponse(404, "company_not_found", "Company not found");
    return NextResponse.json(currentView(company.id));
  } catch (error) {
    return handleRouteError(error, "company-symphony-settings:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const company = resolveCompanyIdBySlug(slug, undefined, { includeArchived: false });
    if (!company) return errorResponse(404, "company_not_found", "Company not found");
    if (!supported()) {
      return errorResponse(404, "not_found", "External runner local controls are unavailable on this lane.");
    }

    const parsed = updateSymphonySettingsSchema.parse(await req.json());

    if (parsed.trackerEnabled !== undefined) {
      launchctlSetenv("HIVERUNNER_SYMPHONY_TRACKER_ENABLED", parsed.trackerEnabled ? "1" : "0");
      if (!parsed.trackerEnabled) {
        launchctlUnsetenv("HIVERUNNER_SYMPHONY_TRACKER_TOKEN");
      }
    }

    if (parsed.trackerTokenRequired !== undefined) {
      if (parsed.trackerTokenRequired) {
        const currentToken = launchctlGetenv("HIVERUNNER_SYMPHONY_TRACKER_TOKEN");
        launchctlSetenv("HIVERUNNER_SYMPHONY_TRACKER_TOKEN", currentToken || randomBytes(24).toString("hex"));
      } else {
        launchctlUnsetenv("HIVERUNNER_SYMPHONY_TRACKER_TOKEN");
      }
    }

    if (parsed.dryRun !== undefined) {
      launchctlSetenv("HIVERUNNER_SYMPHONY_DRY_RUN", parsed.dryRun ? "1" : "0");
    }

    if (parsed.restartDevLane) {
      queueDevRestart();
    }

    return NextResponse.json(currentView(company.id, parsed.restartDevLane));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid external runner settings payload", error.flatten());
    }
    return handleRouteError(error, "company-symphony-settings:patch");
  }
}
