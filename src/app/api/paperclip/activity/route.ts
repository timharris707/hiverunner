import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || "http://localhost:3100";
const PAPERCLIP_API_KEY = process.env.PAPERCLIP_API_KEY || "";
const PAPERCLIP_COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID || "";

function paperclipHeaders() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (PAPERCLIP_API_KEY) h["Authorization"] = `Bearer ${PAPERCLIP_API_KEY}`;
  return h;
}

async function fetchPaperclip<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${PAPERCLIP_API_URL}${path}`, {
      headers: paperclipHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

export async function GET() {
  if (!PAPERCLIP_COMPANY_ID) {
    return NextResponse.json({ configured: false, error: "PAPERCLIP_COMPANY_ID not set" });
  }

  try {
    const [doneData, activeData, agentsData] = await Promise.all([
      fetchPaperclip<{ issues: Issue[] }>(
        `/api/companies/${PAPERCLIP_COMPANY_ID}/issues?status=done&limit=50`
      ),
      fetchPaperclip<{ issues: Issue[] }>(
        `/api/companies/${PAPERCLIP_COMPANY_ID}/issues?status=in_progress,todo,blocked&limit=50`
      ),
      fetchPaperclip<{ agents: Agent[] }>(`/api/companies/${PAPERCLIP_COMPANY_ID}/agents`),
    ]);

    const doneIssues: Issue[] = doneData?.issues ?? [];
    const activeIssues: Issue[] = activeData?.issues ?? [];
    const agents: Agent[] = agentsData?.agents ?? [];

    // Build agent lookup by id
    const agentById: Record<string, Agent> = {};
    for (const a of agents) agentById[a.id] = a;

    // Filter completions from today (UTC day)
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const completedToday = doneIssues.filter((i) => {
      const ts = i.updatedAt || i.createdAt;
      return ts && new Date(ts) >= todayStart;
    });

    // Sprint % = done / (done + in_progress + todo + blocked)
    // Use full counts from both fetches
    const totalIssues = doneIssues.length + activeIssues.length;
    const sprintPercent = totalIssues > 0 ? Math.round((doneIssues.length / totalIssues) * 100) : 0;

    // Issue counts by status
    const issueCounts = {
      done: doneIssues.length,
      in_progress: activeIssues.filter((i) => i.status === "in_progress").length,
      todo: activeIssues.filter((i) => i.status === "todo").length,
      blocked: activeIssues.filter((i) => i.status === "blocked").length,
    };

    // Agents currently working (have a current issue)
    const workingAgents = agents.filter((a) => a.currentIssueId).map((a) => ({
      id: a.id,
      name: a.name,
      shortName: a.shortName,
      currentIssueId: a.currentIssueId,
    }));

    // Build feed: recent completions (newest first) + in-progress items
    const completionEntries: FeedEntry[] = doneIssues
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
      .slice(0, 15)
      .map((i) => ({
        type: "completed" as const,
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        priority: i.priority,
        assigneeAgentId: i.assigneeAgentId,
        assigneeName: i.assigneeAgentId ? (agentById[i.assigneeAgentId]?.shortName ?? agentById[i.assigneeAgentId]?.name ?? null) : null,
        timestamp: i.updatedAt || i.createdAt,
        isToday: !!completedToday.find((c) => c.id === i.id),
      }));

    const activeEntries: FeedEntry[] = activeIssues
      .filter((i) => i.status === "in_progress")
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
      .slice(0, 10)
      .map((i) => ({
        type: "active" as const,
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        priority: i.priority,
        assigneeAgentId: i.assigneeAgentId,
        assigneeName: i.assigneeAgentId ? (agentById[i.assigneeAgentId]?.shortName ?? agentById[i.assigneeAgentId]?.name ?? null) : null,
        timestamp: i.updatedAt || i.createdAt,
        isToday: false,
      }));

    const blockedEntries: FeedEntry[] = activeIssues
      .filter((i) => i.status === "blocked")
      .map((i) => ({
        type: "blocked" as const,
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        priority: i.priority,
        assigneeAgentId: i.assigneeAgentId,
        assigneeName: i.assigneeAgentId ? (agentById[i.assigneeAgentId]?.shortName ?? agentById[i.assigneeAgentId]?.name ?? null) : null,
        timestamp: i.updatedAt || i.createdAt,
        isToday: false,
      }));

    return NextResponse.json({
      configured: true,
      issueCounts,
      completedToday: completedToday.length,
      sprintPercent,
      workingAgents,
      feed: [...blockedEntries, ...activeEntries, ...completionEntries].slice(0, 25),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[paperclip/activity] fetch error:", error);
    return NextResponse.json({ configured: true, error: "Failed to fetch Paperclip activity" }, { status: 502 });
  }
}

interface Agent {
  id: string;
  name?: string;
  shortName?: string;
  status?: string;
  currentIssueId?: string | null;
}

interface Issue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority?: string;
  assigneeAgentId?: string | null;
  createdAt: string;
  updatedAt?: string;
}

interface FeedEntry {
  type: "completed" | "active" | "blocked";
  id: string;
  identifier: string;
  title: string;
  priority?: string;
  assigneeAgentId?: string | null;
  assigneeName?: string | null;
  timestamp: string;
  isToday: boolean;
}
