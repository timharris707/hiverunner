/**
 * /api/voice/tool-dispatch — Server-side tool executor for voice runtime.
 *
 * Phase 10: Executes allowlisted tools requested by the voice runtime's
 * structured action-intent seam. The model suggests tool calls via
 * <henry_action> tags; the client parses them and POSTs here for execution.
 *
 * Security model:
 *   - Server maintains its own allowlist (independent of client)
 *   - No shell exec — all tools are pure TypeScript functions
 *   - Results are structured, never raw command output
 *   - Tool execution is logged for observability
 */

import { NextRequest, NextResponse } from "next/server";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolRequest {
  tool: string;
  params?: Record<string, unknown>;
}

interface ToolResult {
  tool: string;
  status: "success" | "error" | "rejected";
  output: unknown;
  durationMs: number;
  executedAt: number;
}

type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

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
  // Future: query Supabase or Paperclip for live data.
  return {
    organization: "Harris Autonomous",
    activeProjects: [
      {
        name: "Mission Control",
        status: "active",
        description: "Command center dashboard — task board, advisory, trading desk",
      },
      {
        name: "Crypto Trading Bot",
        status: "active",
        description: "8 phases complete, paper trading with real Binance data",
      },
      {
        name: "Weather Trading",
        status: "live",
        description: "Live on Kalshi with real trades",
      },
      {
        name: "Stock & Options",
        status: "active",
        description: "Phase 1 complete, Polygon API live",
      },
      {
        name: "BoardRunner",
        status: "in-development",
        description: "AI Advisory Board product",
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

// ─── Allowlist + Registry ────────────────────────────────────────────────────

const TOOL_REGISTRY: Record<string, ToolHandler> = {
  get_current_time: getCurrentTime,
  get_system_status: getSystemStatus,
  get_project_summary: getProjectSummary,
  get_weather: getWeather,
  search_tasks: searchTasks,
};

const ALLOWED_TOOLS = new Set(Object.keys(TOOL_REGISTRY));

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

  const { tool, params = {} } = body;

  if (!tool || typeof tool !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'tool' field" },
      { status: 400 }
    );
  }

  // Server-side allowlist check (trust boundary)
  if (!ALLOWED_TOOLS.has(tool)) {
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
    const handler = TOOL_REGISTRY[tool];
    const output = await handler(params);
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
      status: "error",
      output: {
        error: err instanceof Error ? err.message : "Tool execution failed",
      },
      durationMs: Date.now() - start,
      executedAt: start,
    };

    console.error(`[voice-tool-dispatch] ${tool} failed:`, err);

    return NextResponse.json(result, { status: 500 });
  }
}

/** GET returns the tool manifest (for introspection/docs) */
export async function GET() {
  return NextResponse.json({
    tools: Object.keys(TOOL_REGISTRY).map((name) => ({
      name,
      description: TOOL_DESCRIPTIONS[name] || name,
    })),
  });
}

const TOOL_DESCRIPTIONS: Record<string, string> = {
  get_current_time: "Get current date, time, and timezone info",
  get_system_status: "Get server health: uptime, memory, Node version",
  get_project_summary: "Get a summary of active Harris Autonomous projects",
  get_weather: "Get current weather for a location (default: Santa Rosa, CA)",
  search_tasks: "Search orchestration tasks by query or status",
};
