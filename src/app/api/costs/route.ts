import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { resolveOpenClawDir } from "@/lib/workspaces/root";

const OPENCLAW_DIR = resolveOpenClawDir();
const DEFAULT_BUDGET = 100.0;
const TASKS_JSON_PATH = join(process.cwd(), "data", "tasks.json");
const ENABLE_LEGACY_OPENCLAW_COSTS_ENV = "MC_ENABLE_LEGACY_OPENCLAW_COSTS";

interface SessionRecord {
  key?: string;
  updatedAt?: number;
  startedAt?: number;
  model?: string;
  modelProvider?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
}

function legacyOpenClawCostsEnabled(): boolean {
  const value = process.env[ENABLE_LEGACY_OPENCLAW_COSTS_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function getSessionsData(): Record<string, SessionRecord> {
  if (!legacyOpenClawCostsEnabled()) return {};

  const sessionsJsonPath = join(OPENCLAW_DIR, "agents", "main", "sessions", "sessions.json");
  if (!existsSync(sessionsJsonPath)) return {};
  try {
    const raw = readFileSync(sessionsJsonPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function isoDateFromMs(ms: number): string {
  return new Date(ms).toISOString().split("T")[0];
}

function getAgentLabel(key: string): string {
  const parts = key.split(":");
  if (parts[2] === "main") return "Local Assistant (Main)";
  if (parts[2] === "telegram" || parts[2] === "direct") return "Local Assistant (Direct)";
  if (parts[2] === "cron") return "Local Assistant (Cron)";
  if (parts[2] === "subagent") return `Subagent (${parts[3]?.slice(0, 8) || "?"})`;
  return key;
}

function normalizeModel(model: string, provider?: string): string {
  if (!model || model === "unknown") {
    if (provider) return provider;
    return "unknown";
  }
  // Normalize model names
  const m = model.toLowerCase();
  if (m.includes("opus-4")) return "claude-opus-4";
  if (m.includes("sonnet-4")) return "claude-sonnet-4";
  if (m.includes("haiku-3")) return "claude-haiku-3";
  if (m.includes("gpt-4")) return "gpt-4";
  if (m.includes("gpt-3")) return "gpt-3.5";
  return model;
}

function getRoutingStats(): Array<{ tier: string; count: number; avgSavings: number }> {
  if (!legacyOpenClawCostsEnabled()) return [];

  try {
    if (!existsSync(TASKS_JSON_PATH)) return [];
    const raw = readFileSync(TASKS_JSON_PATH, "utf-8");
    const tasks: Array<{ routedTier?: string; routedModel?: string; savingsPercent?: number }> = JSON.parse(raw);
    const byTier: Record<string, { count: number; totalSavings: number }> = {};
    for (const task of tasks) {
      if (!task.routedTier) continue;
      const tier = task.routedTier;
      if (!byTier[tier]) byTier[tier] = { count: 0, totalSavings: 0 };
      byTier[tier].count++;
      byTier[tier].totalSavings += task.savingsPercent || 0;
    }
    return Object.entries(byTier)
      .map(([tier, v]) => ({ tier, count: v.count, avgSavings: v.count > 0 ? Math.round(v.totalSavings / v.count) : 0 }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const timeframe = searchParams.get("timeframe") || "30d";
  const days = parseInt(timeframe.replace(/\D/g, ""), 10) || 30;

  const sessionsData = getSessionsData();
  const now = Date.now();
  const cutoffMs = now - days * 24 * 60 * 60 * 1000;

  const todayStr = isoDateFromMs(now);
  const yesterdayStr = isoDateFromMs(now - 86400000);
  const thisMonthStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
  const lastMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const lastMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0);

  let todayCost = 0;
  let yesterdayCost = 0;
  let thisMonthCost = 0;
  let lastMonthCost = 0;

  const byAgentMap: Record<string, { cost: number; tokens: number; inputTokens: number; outputTokens: number }> = {};
  const byModelMap: Record<string, { cost: number; tokens: number; inputTokens: number; outputTokens: number }> = {};
  const byDateMap: Record<string, { cost: number; input: number; output: number }> = {};
  const topSessions: Array<{ key: string; label: string; cost: number; tokens: number; model: string; date: string }> = [];

  for (const [key, session] of Object.entries(sessionsData)) {
    if (key.includes(":run:")) continue; // skip run duplicates

    const cost = session.estimatedCostUsd || 0;
    const tokens = session.totalTokens || 0;
    const inputTokens = session.inputTokens || 0;
    const outputTokens = session.outputTokens || 0;
    const updatedAt = session.updatedAt || session.startedAt || 0;
    const dateStr = isoDateFromMs(updatedAt);

    // Today / yesterday / month summaries
    if (dateStr === todayStr) todayCost += cost;
    if (dateStr === yesterdayStr) yesterdayCost += cost;
    if (dateStr >= thisMonthStart) thisMonthCost += cost;
    if (dateStr >= lastMonthStart.toISOString().split("T")[0] && dateStr <= lastMonthEnd.toISOString().split("T")[0]) {
      lastMonthCost += cost;
    }

    // By agent
    const agentLabel = getAgentLabel(key);
    if (!byAgentMap[agentLabel]) byAgentMap[agentLabel] = { cost: 0, tokens: 0, inputTokens: 0, outputTokens: 0 };
    byAgentMap[agentLabel].cost += cost;
    byAgentMap[agentLabel].tokens += tokens;
    byAgentMap[agentLabel].inputTokens += inputTokens;
    byAgentMap[agentLabel].outputTokens += outputTokens;

    // By model
    const modelLabel = normalizeModel(session.model || "", session.modelProvider);
    if (!byModelMap[modelLabel]) byModelMap[modelLabel] = { cost: 0, tokens: 0, inputTokens: 0, outputTokens: 0 };
    byModelMap[modelLabel].cost += cost;
    byModelMap[modelLabel].tokens += tokens;
    byModelMap[modelLabel].inputTokens += inputTokens;
    byModelMap[modelLabel].outputTokens += outputTokens;

    // By date (for trend)
    if (updatedAt >= cutoffMs) {
      if (!byDateMap[dateStr]) byDateMap[dateStr] = { cost: 0, input: 0, output: 0 };
      byDateMap[dateStr].cost += cost;
      byDateMap[dateStr].input += inputTokens;
      byDateMap[dateStr].output += outputTokens;
    }

    // Track top sessions
    if (cost > 0) {
      topSessions.push({
        key,
        label: getAgentLabel(key),
        cost,
        tokens,
        model: normalizeModel(session.model || "", session.modelProvider),
        date: dateStr,
      });
    }
  }

  // Project monthly spend
  const daysElapsed = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const avgDaily = daysElapsed > 0 ? thisMonthCost / daysElapsed : 0;
  const projected = avgDaily * daysInMonth;

  // Sort and format arrays
  const byAgent = Object.entries(byAgentMap)
    .map(([agent, v]) => ({ agent, ...v }))
    .sort((a, b) => b.cost - a.cost);

  const byModel = Object.entries(byModelMap)
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.cost - a.cost);

  const daily = Object.entries(byDateMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date: date.slice(5), // YYYY-MM-DD → MM-DD
      cost: parseFloat(v.cost.toFixed(4)),
      input: v.input,
      output: v.output,
    }));

  const topSessionsSorted = topSessions
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);

  // Burndown: budget remaining for each day of the current month
  const year = new Date().getFullYear();
  const month = new Date().getMonth();
  const burndown: Array<{ day: number; remaining: number; projected: boolean }> = [];
  let cumulativeCost = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dateKeyShort = dateKey.slice(5); // MM-DD
    const dayEntry = daily.find((e) => e.date === dateKeyShort);
    const isProjected = d > daysElapsed;
    if (!isProjected) {
      cumulativeCost += dayEntry?.cost || 0;
    } else {
      cumulativeCost += avgDaily;
    }
    burndown.push({
      day: d,
      remaining: parseFloat(Math.max(0, DEFAULT_BUDGET - cumulativeCost).toFixed(4)),
      projected: isProjected,
    });
  }

  // Weekly: last 7 days (actual) + next 7 days (projected)
  const weekly: Array<{ date: string; cost: number; projected: boolean }> = [];
  for (let offset = -6; offset <= 7; offset++) {
    const d = new Date(now + offset * 86400000);
    const dateStr = d.toISOString().split("T")[0];
    const dateShort = dateStr.slice(5);
    const isProjected = offset > 0;
    const dayEntry = daily.find((e) => e.date === dateShort);
    weekly.push({
      date: dateShort,
      cost: isProjected ? parseFloat(avgDaily.toFixed(4)) : parseFloat((dayEntry?.cost || 0).toFixed(4)),
      projected: isProjected,
    });
  }

  const routingStats = getRoutingStats();

  return NextResponse.json({
    today: parseFloat(todayCost.toFixed(4)),
    yesterday: parseFloat(yesterdayCost.toFixed(4)),
    thisMonth: parseFloat(thisMonthCost.toFixed(4)),
    lastMonth: parseFloat(lastMonthCost.toFixed(4)),
    projected: parseFloat(projected.toFixed(4)),
    budget: DEFAULT_BUDGET,
    byAgent,
    byModel,
    daily,
    hourly: [],
    topSessions: topSessionsSorted,
    burndown,
    weekly,
    routingStats,
    avgDaily: parseFloat(avgDaily.toFixed(4)),
    daysElapsed,
    daysInMonth,
  });
}

// POST endpoint to update budget  
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { budget, alerts } = body;
    return NextResponse.json({ success: true, budget, alerts });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update budget" }, { status: 500 });
  }
}
