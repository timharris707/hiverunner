#!/usr/bin/env tsx
/**
 * mc — HiveRunner CLI
 *
 * Usage:
 *   mc tasks list [--status STATUS] [--project PROJECT] [--limit N]
 *   mc tasks assign --task TASK_ID --to AGENT
 *   mc reject --task TASK_ID --reason REASON_TEXT
 *
 * Environment:
 *   MC_API_URL  Base URL of the running HiveRunner server (default: http://localhost:3010)
 */

const BASE_URL = process.env.MC_API_URL?.replace(/\/$/, "") ?? "http://localhost:3010";
const ORCHESTRATION_API_PREFIX = "/api/orchestration";

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  blue:   "\x1b[34m",
  cyan:   "\x1b[36m",
  gray:   "\x1b[90m",
};

const noColor = !process.stdout.isTTY || process.env.NO_COLOR;
const col = (code: string, text: string) => noColor ? text : `${code}${text}${c.reset}`;

function statusColor(status: string): string {
  switch (status) {
    case "in-progress": return col(c.yellow, status);
    case "done":        return col(c.green, status);
    case "review":      return col(c.blue, status);
    case "blocked":     return col(c.red, status);
    case "to-do":     return col(c.gray, status);
    default:            return status;
  }
}

function priorityColor(p: string): string {
  switch (p) {
    case "P0": return col(c.red + c.bold, p);
    case "P1": return col(c.red, p);
    case "P2": return col(c.yellow, p);
    case "P3": return col(c.green, p);
    default:   return p ?? "—";
  }
}

// ── Arg parsing ───────────────────────────────────────────────────────────────
function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function apiHeaders(path: string, headers?: HeadersInit): Headers {
  const resolvedHeaders = new Headers(headers);
  if (!resolvedHeaders.has("Content-Type")) {
    resolvedHeaders.set("Content-Type", "application/json");
  }

  const apiKey = process.env.MC_API_KEY?.trim();
  const pathname = new URL(path, BASE_URL).pathname;
  if (apiKey && pathname.startsWith(ORCHESTRATION_API_PREFIX)) {
    resolvedHeaders.set("x-mc-api-key", apiKey);
  }

  return resolvedHeaders;
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...opts,
      headers: apiHeaders(path, opts?.headers),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    die(`Cannot reach ${BASE_URL} — is the server running?\n  ${msg}`);
  }
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    die(`API error ${res.status}: ${(body as { error?: string }).error ?? JSON.stringify(body)}`);
  }
  return body as T;
}

function die(msg: string): never {
  process.stderr.write(`${col(c.red, "error")} ${msg}\n`);
  process.exit(1);
}

// ── Table rendering ───────────────────────────────────────────────────────────
function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len - 1) + "…" : s;
}

function pad(s: string, len: number): string {
  // Strip ANSI escapes when measuring width
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  return s + " ".repeat(Math.max(0, len - visible.length));
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdTasksList(flags: Record<string, string | boolean>) {
  const { tasks } = await api<{ tasks: Task[] }>("/api/tasks");

  let filtered = tasks;
  if (flags.status) filtered = filtered.filter(t => t.status === flags.status);
  if (flags.project) filtered = filtered.filter(t => t.project === flags.project);

  const limit = flags.limit ? parseInt(String(flags.limit), 10) : 50;
  filtered = filtered.slice(0, limit);

  if (filtered.length === 0) {
    console.log(col(c.dim, "No tasks found."));
    return;
  }

  const ID_W   = 23;
  const STAT_W = 12;
  const PRI_W  = 4;
  const AGT_W  = 12;
  const TTL_W  = 46;

  const header =
    col(c.bold, pad("ID", ID_W)) +
    col(c.bold, pad("STATUS", STAT_W)) +
    col(c.bold, pad("PRI", PRI_W)) +
    col(c.bold, pad("AGENT", AGT_W)) +
    col(c.bold, "TITLE");

  console.log(header);
  console.log(col(c.dim, "─".repeat(ID_W + STAT_W + PRI_W + AGT_W + TTL_W)));

  for (const t of filtered) {
    const agent = t.assignedAgent ?? t.assignee ?? "—";
    const row =
      pad(col(c.cyan, t.id), ID_W + 9) +   // +9 for ANSI codes
      pad(statusColor(t.status), STAT_W + 9) +
      pad(priorityColor(t.priority ?? ""), PRI_W + 9) +
      pad(truncate(agent, AGT_W - 1), AGT_W) +
      truncate(t.title ?? "", TTL_W);
    console.log(row);
  }

  console.log(col(c.dim, `\n${filtered.length} task${filtered.length !== 1 ? "s" : ""}`));
}

async function cmdTasksAssign(flags: Record<string, string | boolean>) {
  const taskId = String(flags.task ?? "");
  const to     = String(flags.to ?? "");

  if (!taskId) die("--task TASK_ID is required");
  if (!to)     die("--to AGENT is required");

  // Resolve agent: try registry match (id or name, case-insensitive)
  let agentId = to.toLowerCase();
  try {
    const { agents } = await api<{ agents: Agent[] }>("/api/agents/registry");
    const match = agents.find(
      a => a.id.toLowerCase() === to.toLowerCase() || a.name.toLowerCase() === to.toLowerCase()
    );
    if (match) agentId = match.id;
  } catch {
    // Registry unavailable — use value as-is
  }

  const { task } = await api<{ task: Task }>("/api/tasks", {
    method: "PATCH",
    body: JSON.stringify({ id: taskId, assignedAgent: agentId }),
  });

  console.log(
    `${col(c.green, "✓")} Assigned ${col(c.cyan, task.id)} → ${col(c.bold, agentId)}`
  );
}

async function cmdReject(flags: Record<string, string | boolean>) {
  const taskId = String(flags.task ?? "");
  const reason = String(flags.reason ?? "");

  if (!taskId) die("--task TASK_ID is required");
  if (!reason) die("--reason TEXT is required");

  // Transition review → in-progress (changes-requested)
  await api<{ task: Task }>("/api/tasks", {
    method: "PATCH",
    body: JSON.stringify({
      id: taskId,
      status: "in-progress",
      reviewStatus: "changes-requested",
    }),
  });

  // Post rejection comment with the reason
  await api("/api/tasks/" + taskId + "/comments", {
    method: "POST",
    body: JSON.stringify({
      author: "mc-cli",
      authorEmoji: "⌨️",
      text: reason,
      type: "rejection",
    }),
  });

  console.log(
    `${col(c.green, "✓")} Rejected ${col(c.cyan, taskId)} — returned to in-progress\n` +
    `  ${col(c.dim, `Reason: ${reason}`)}`
  );
}

// ── Type stubs ────────────────────────────────────────────────────────────────
interface Task {
  id: string;
  title: string;
  status: string;
  priority?: string;
  assignedAgent?: string;
  assignee?: string;
  project?: string;
}

interface Agent {
  id: string;
  name: string;
}

// ── Help ──────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
${col(c.bold, "mc")} — HiveRunner CLI

${col(c.bold, "USAGE")}
  mc tasks list   [--status STATUS] [--project PROJECT] [--limit N]
  mc tasks assign --task TASK_ID --to AGENT
  mc reject       --task TASK_ID --reason "REASON TEXT"

${col(c.bold, "COMMANDS")}
  tasks list      List tasks (default: first 50, all statuses)
  tasks assign    Assign a task to an agent
  reject          Reject a task in review; return it to in-progress

${col(c.bold, "OPTIONS")}
  --status        Filter by status: to-do | in-progress | review | done | blocked
  --project       Filter by project slug
  --limit         Max rows to show (default: 50)
  --task          Task ID (e.g. TASK-1774848763713)
  --to            Agent id or name (e.g. pixel, forge, backend)
  --reason        Rejection reason text (required for reject)

${col(c.bold, "ENV")}
  MC_API_URL      Base URL of the HiveRunner server (default: http://localhost:3010)

${col(c.bold, "EXAMPLES")}
  mc tasks list
  mc tasks list --status in-progress --project hiverunner
  mc tasks assign --task TASK-1774848763713 --to pixel
  mc reject --task TASK-1774848763713 --reason "Acceptance criteria not met"
`);
}

// ── Entry ─────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    return;
  }

  const group = argv[0];
  const sub   = argv[1];
  const flags = parseFlags(argv.slice(2));

  if (group === "tasks") {
    if (sub === "list")   return cmdTasksList(flags);
    if (sub === "assign") return cmdTasksAssign(flags);
    console.error(`Unknown subcommand: tasks ${sub}\nRun mc --help for usage.`);
    process.exit(1);
  }

  if (group === "reject") {
    // Allow flags starting from argv[1]
    const rejectFlags = parseFlags(argv.slice(1));
    return cmdReject(rejectFlags);
  }

  console.error(`Unknown command: ${group}\nRun mc --help for usage.`);
  process.exit(1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${col(c.red, "fatal")} ${msg}\n`);
  process.exit(1);
});
