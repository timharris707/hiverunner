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
    const [dashboard, agentsData, issuesData] = await Promise.all([
      fetchPaperclip<Record<string, unknown>>(`/api/companies/${PAPERCLIP_COMPANY_ID}/dashboard`),
      fetchPaperclip<{ agents: Agent[] }>(`/api/companies/${PAPERCLIP_COMPANY_ID}/agents`),
      fetchPaperclip<{ issues: Issue[] }>(
        `/api/companies/${PAPERCLIP_COMPANY_ID}/issues?status=in_progress,todo,blocked&limit=20`
      ),
    ]);

    const agents: Agent[] = agentsData?.agents ?? [];
    const issues: Issue[] = issuesData?.issues ?? [];

    // Compute agent status buckets
    const agentStats = {
      total: agents.length,
      active: agents.filter((a) => a.status === "active" || a.currentIssueId).length,
      idle: agents.filter((a) => (a.status === "idle" || a.status === "online") && !a.currentIssueId).length,
      paused: agents.filter((a) => a.status === "paused" || a.status === "offline").length,
    };

    // Issue counts by status
    const issueCounts = {
      in_progress: issues.filter((i) => i.status === "in_progress").length,
      todo: issues.filter((i) => i.status === "todo").length,
      blocked: issues.filter((i) => i.status === "blocked").length,
    };

    // Recent issues (newest first, top 15 for display)
    const recentIssues = issues
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
      .slice(0, 15)
      .map((i) => ({
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        status: i.status,
        priority: i.priority,
        assigneeAgentId: i.assigneeAgentId,
        projectId: i.projectId,
        updatedAt: i.updatedAt || i.createdAt,
      }));

    return NextResponse.json({
      configured: true,
      agentStats,
      issueCounts,
      recentIssues,
      dashboard,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[paperclip/status] fetch error:", error);
    return NextResponse.json({ configured: true, error: "Failed to fetch Paperclip data" }, { status: 502 });
  }
}

// Minimal types for the Paperclip API responses
interface Agent {
  id: string;
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
  projectId?: string | null;
  createdAt: string;
  updatedAt?: string;
}
