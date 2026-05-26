import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { ALL_AGENT_NAMES } from "@/config/agents";

const TASKS_FILE = join(process.cwd(), "data/tasks.json");
const BUILD_LOG_FILE = join(process.cwd(), "data/build-log.json");
const OPENCLAW_CONFIG = join(process.env.HOME || "", ".openclaw/openclaw.json");

// Friendly display name from a provider-prefixed model ID
function modelIdToName(modelId: string): string {
  const MAP: Record<string, string> = {
    "anthropic/claude-opus-4-6": "Opus 4.6",
    "anthropic/claude-sonnet-4-6": "Sonnet 4.6",
    "anthropic/claude-haiku-3-5": "Haiku 3.5",
    "google/gemini-3.1-pro-preview": "Gemini 3.1 Pro",
    "google/gemini-3-pro-preview": "Gemini 3 Pro",
    "google/gemini-3-flash-preview": "Gemini 3 Flash",
    "google/gemini-2.5-flash": "Gemini Flash",
    "google/gemini-2.5-pro": "Gemini Pro",
    "openai-codex/gpt-5.4": "GPT 5.4",
    "openai/gpt-4o": "GPT 4o",
    "openrouter/anthropic/claude-opus-4.6": "Opus 4.6",
    "openrouter/auto": "OpenRouter",
  };
  return MAP[modelId] ?? modelId.split("/").pop() ?? modelId;
}

function readJSON<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

interface OpenClawConfig {
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
        fallbacks?: string[];
      };
      models?: Record<string, { alias?: string }>;
    };
  };
}

interface AgentModelEntry {
  modelName: string;
  modelId: string;
  source: "openclaw-config" | "task-history" | "build-log";
  updatedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

function getOpenClawDefault(): { modelId: string; modelName: string } {
  const config = readJSON<OpenClawConfig>(OPENCLAW_CONFIG, {});
  const primary = config?.agents?.defaults?.model?.primary ?? "anthropic/claude-opus-4-6";
  return { modelId: primary, modelName: modelIdToName(primary) };
}

export async function GET() {
  const defaultModel = getOpenClawDefault();

  // ── Task history: most recent routedModel per assignee ──────────────────
  const tasks = readJSON<AnyRecord[]>(TASKS_FILE, []);
  const agentModels: Record<string, AgentModelEntry> = {};

  const sortedTasks = [...tasks]
    .filter((t) => t.assignee && (t.routedModel || t.routedTier))
    .sort(
      (a, b) =>
        new Date(b.updated ?? b.created ?? 0).getTime() -
        new Date(a.updated ?? a.created ?? 0).getTime()
    );

  for (const task of sortedTasks) {
    const key = (task.assignee as string).toLowerCase();
    if (!agentModels[key] && task.routedModel) {
      agentModels[key] = {
        modelName: task.routedModel as string,
        modelId: (task.routedTier as string | undefined) ?? "",
        source: "task-history",
        updatedAt: (task.updated ?? task.created ?? "") as string,
      };
    }
  }

  // ── Build log: most recent completed build routing per agentType ─────────
  const buildLog = readJSON<{ builds?: AnyRecord[] }>(BUILD_LOG_FILE, {});
  const builds = buildLog.builds ?? [];

  const sortedBuilds = [...builds]
    .filter((b) => b.agentType && b.routing?.modelName)
    .sort(
      (a, b) =>
        new Date(b.startedAt ?? b.queuedAt ?? 0).getTime() -
        new Date(a.startedAt ?? a.queuedAt ?? 0).getTime()
    );

  for (const build of sortedBuilds) {
    const key = (build.agentType as string).toLowerCase();
    if (!agentModels[key]) {
      agentModels[key] = {
        modelName: build.routing.modelName as string,
        modelId: (build.routing.modelId as string | undefined) ?? "",
        source: "build-log",
        updatedAt: (build.startedAt ?? build.queuedAt ?? "") as string,
      };
    }
  }

  // ── Fill any agents not yet seen with the OpenClaw default ───────────────
  // Derive known agents from the central registry + build-queue agent types
  const KNOWN_AGENTS = [
    ...ALL_AGENT_NAMES.map((n) => n.toLowerCase()),
    "claude-code", "reviewer",
  ];
  for (const id of KNOWN_AGENTS) {
    if (!agentModels[id]) {
      agentModels[id] = {
        ...defaultModel,
        source: "openclaw-config",
        updatedAt: new Date().toISOString(),
      };
    }
  }

  return NextResponse.json({
    defaultModel,
    agents: agentModels,
  });
}
