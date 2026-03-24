import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const OPENCLAW_DIR = process.env.OPENCLAW_DIR || "/Users/timharris/.openclaw";
const DEFAULT_BUDGET = 100.0;

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

function getSessionsData(): Record<string, SessionRecord> {
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
  if (parts[2] === "main") return "Henry (Main)";
  if (parts[2] === "telegram" || parts[2] === "direct") return "Henry (Telegram)";
  if (parts[2] === "cron") return "Henry (Cron)";
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
