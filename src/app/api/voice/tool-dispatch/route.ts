/**
 * /api/voice/tool-dispatch — Server-side tool executor for voice runtime.
 *
 * Phase 10: Executes allowlisted tools requested by the voice runtime's
 * structured action-intent seam. The model suggests tool calls via
 * <voice_action> tags; the client parses them and POSTs here for execution.
 *
 * Security model:
 *   - Server maintains its own allowlist (independent of client)
 *   - No shell exec — all tools are pure TypeScript functions
 *   - Results are structured, never raw command output
 *   - Tool execution is logged for observability
 */

import { NextRequest, NextResponse } from "next/server";
import { OrchestrationApiError } from "@/lib/orchestration/api";
import {
  isVoiceToolName,
  type VoiceToolName,
  VOICE_TOOL_DESCRIPTIONS,
  VOICE_TOOL_NAMES,
} from "@/lib/voice-tool-manifest";
import { normalizeResolvedVoiceBinding } from "@/lib/voice-binding";
import {
  buildCurrentVoiceContext,
  searchVoiceMemory,
  searchWorkspaceMemory,
} from "@/lib/voice-memory";
import { appendAgentMemory } from "@/lib/voice-agent-memory";
import { executeVoiceActionTool, type VoiceActionToolName } from "@/lib/voice-task-action-execution";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolRequest {
  tool: string;
  params?: Record<string, unknown>;
  binding?: Record<string, unknown>;
  sessionId?: string;
  intentId?: string;
}

interface ToolResult {
  tool: string;
  status: "success" | "error" | "rejected";
  output: unknown;
  durationMs: number;
  executedAt: number;
}

type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

function localOrchestrationHeaders(): Headers {
  const headers = new Headers();
  const apiKey = process.env.MC_API_KEY?.trim();
  if (apiKey) {
    headers.set("x-mc-api-key", apiKey);
  }
  return headers;
}

// ─── Tool Implementations ────────────────────────────────────────────────────

async function getCurrentTime(): Promise<unknown> {
  const now = new Date();
  return {
    iso: now.toISOString(),
    unix: Math.floor(now.getTime() / 1000),
    local: now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
    timezone: "America/Los_Angeles",
    dayOfWeek: now.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "America/Los_Angeles",
    }),
  };
}

async function getSystemStatus(): Promise<unknown> {
  const uptime = process.uptime();
  const mem = process.memoryUsage();
  return {
    nodeUptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    rssMb: Math.round(mem.rss / 1024 / 1024),
    platform: process.platform,
    nodeVersion: process.version,
    env: process.env.NODE_ENV || "development",
  };
}

async function getProjectSummary(): Promise<unknown> {
  // Safe, read-only summary of active projects from known state.
  // Future: query HiveRunner runtime state for live data.
  return {
    organization: "HiveRunner",
    activeProjects: [
      {
        name: "HiveRunner",
        status: "active",
        description: "Command center dashboard for tasks, teams, workspaces, and local execution",
      },
      {
        name: "Product Studio",
        status: "active",
        description: "Workspace for product planning, building, and review",
      },
      {
        name: "Research Lab",
        status: "live",
        description: "Research workspace for synthesis and strategy",
      },
      {
        name: "Operations Desk",
        status: "active",
        description: "Operational workspace for execution and support",
      },
    ],
    agentCount: 10,
    note: "Summary is from cached project metadata. For live task counts, use search_tasks.",
  };
}

async function getWeather(params: Record<string, unknown>): Promise<unknown> {
  const location = typeof params.location === "string" ? params.location : "Santa Rosa, CA";
  try {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(location)}?format=j1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`wttr.in returned ${res.status}`);
    const data = await res.json();
    const current = data.current_condition?.[0];
    if (!current) throw new Error("No current conditions");
    return {
      location,
      tempF: current.temp_F,
      tempC: current.temp_C,
      description: current.weatherDesc?.[0]?.value || "Unknown",
      humidity: current.humidity,
      windMph: current.windspeedMiles,
      feelsLikeF: current.FeelsLikeF,
      source: "wttr.in",
    };
  } catch (err) {
    return {
      location,
      error: err instanceof Error ? err.message : "Weather fetch failed",
      source: "wttr.in",
    };
  }
}

async function searchTasks(params: Record<string, unknown>): Promise<unknown> {
  // Lightweight task search — queries the local orchestration API
  const query = typeof params.query === "string" ? params.query : "";
  const status = typeof params.status === "string" ? params.status : undefined;
  try {
    const url = new URL("/api/orchestration/tasks", `http://localhost:${process.env.PORT || "3010"}`);
    if (status) url.searchParams.set("status", status);
    if (query) url.searchParams.set("search", query);
    url.searchParams.set("limit", "10");
    const res = await fetch(url.toString(), {
      headers: localOrchestrationHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { tasks: [], note: `Task API returned ${res.status}` };
    const data = await res.json();
    const tasks = Array.isArray(data.tasks) ? data.tasks : Array.isArray(data) ? data : [];
    return {
      count: tasks.length,
      tasks: tasks.slice(0, 10).map((t: Record<string, unknown>) => ({
        key: t.key || t.id,
        title: t.title || t.name,
        status: t.status,
        assignee: t.assignee,
      })),
      query: query || undefined,
      statusFilter: status || undefined,
    };
  } catch {
    return { tasks: [], note: "Task search unavailable" };
  }
}

async function searchWorkspaceMemoryTool(params: Record<string, unknown>): Promise<unknown> {
  const query = typeof params.query === "string" ? params.query.trim() : "";
  const limit = typeof params.limit === "number" ? params.limit : 5;
  if (!query) {
    return { count: 0, results: [], note: "Provide a query string" };
  }
  return searchWorkspaceMemory(query, Math.max(1, Math.min(limit, 10)));
}

async function searchVoiceMemoryTool(params: Record<string, unknown>): Promise<unknown> {
  const query = typeof params.query === "string" ? params.query.trim() : "";
  const limit = typeof params.limit === "number" ? params.limit : 5;
  if (!query) {
    return { count: 0, results: [], note: "Provide a query string" };
  }
  return searchVoiceMemory(query, Math.max(1, Math.min(limit, 10)));
}

async function getCurrentContext(): Promise<unknown> {
  return {
    generatedAt: Date.now(),
    context: await buildCurrentVoiceContext(),
  };
}

// ─── Allowlist + Registry ────────────────────────────────────────────────────

const TOOL_REGISTRY: Record<string, ToolHandler> = {
  get_current_time: getCurrentTime,
  get_system_status: getSystemStatus,
  get_project_summary: getProjectSummary,
  get_weather: getWeather,
  search_tasks: searchTasks,
  search_workspace_memory: searchWorkspaceMemoryTool,
  search_voice_memory: searchVoiceMemoryTool,
  get_current_context: getCurrentContext,
};

const ACTION_TOOL_NAMES: ReadonlySet<VoiceActionToolName> = new Set([
  "add_task_comment",
  "start_task_work",
  "move_task_status",
  "reassign_task",
  "set_task_priority",
]);

async function rememberTool(
  params: Record<string, unknown>,
  binding: { companySlug?: string; agentId?: string } | undefined,
): Promise<unknown> {
  const subject = typeof params.subject === "string" ? params.subject.trim() : "";
  const detail = typeof params.detail === "string" ? params.detail.trim() : "";
  if (!subject || !detail) {
    return { saved: false, reason: "missing_subject_or_detail" };
  }
  if (!binding?.agentId || !binding.companySlug) {
    return { saved: false, reason: "no_agent_binding" };
  }
  const result = await appendAgentMemory(
    { companySlug: binding.companySlug, agentId: binding.agentId },
    { subject, detail },
  );
  return { ...result, subject, detail };
}

const ALLOWED_TOOLS: ReadonlySet<VoiceToolName> = new Set(VOICE_TOOL_NAMES);

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const start = Date.now();

  let body: ToolRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { tool, params = {}, binding, sessionId, intentId } = body;

  if (!tool || typeof tool !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'tool' field" },
      { status: 400 }
    );
  }

  const normalizedBinding = binding ? normalizeResolvedVoiceBinding(binding) : undefined;

  // Server-side allowlist check (trust boundary)
  if (!isVoiceToolName(tool) || !ALLOWED_TOOLS.has(tool)) {
    const result: ToolResult = {
      tool,
      status: "rejected",
      output: {
        reason: "not_allowed",
        message: `Tool '${tool}' is not in the server allowlist`,
        allowedTools: [...ALLOWED_TOOLS],
      },
      durationMs: Date.now() - start,
      executedAt: start,
    };
    return NextResponse.json(result, { status: 403 });
  }

  try {
    let output: unknown;
    if (ACTION_TOOL_NAMES.has(tool as VoiceActionToolName)) {
      output = await executeVoiceActionTool({
        tool: tool as VoiceActionToolName,
        params,
        binding: normalizedBinding,
        sessionId,
        intentId,
      });
    } else if (tool === "remember") {
      output = await rememberTool(params, normalizedBinding);
    } else {
      output = await TOOL_REGISTRY[tool]!(params);
    }
    const result: ToolResult = {
      tool,
      status: "success",
      output,
      durationMs: Date.now() - start,
      executedAt: start,
    };

    console.log(
      `[voice-tool-dispatch] ${tool} completed in ${result.durationMs}ms`
    );

    return NextResponse.json(result);
  } catch (err) {
    const result: ToolResult = {
      tool,
      status: err instanceof OrchestrationApiError && err.status < 500 ? "rejected" : "error",
      output: {
        error: err instanceof Error ? err.message : "Tool execution failed",
        ...(err instanceof OrchestrationApiError ? { code: err.code } : {}),
      },
      durationMs: Date.now() - start,
      executedAt: start,
    };

    console.error(`[voice-tool-dispatch] ${tool} failed:`, err);

    const status = err instanceof OrchestrationApiError ? err.status : 500;
    return NextResponse.json(result, { status });
  }
}

/** GET returns the tool manifest (for introspection/docs) */
export async function GET() {
  return NextResponse.json({
    tools: [...ALLOWED_TOOLS].map((name) => ({
      name,
      description: VOICE_TOOL_DESCRIPTIONS[name],
    })),
  });
}
