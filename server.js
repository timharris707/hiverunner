const http = require("http");
const next = require("next");
const { WebSocketServer } = require("ws");
const v8 = require("v8");
const { execFileSync } = require("child_process");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3010", 10);

if (port === 3000 && process.env.MC_ALLOW_PORT_3000_COMPAT !== "1") {
  console.error("");
  console.error("[hr-runtime] Port 3000 is retired for HiveRunner.");
  console.error("[hr-runtime] Use port 3010 for dev or port 3001 for stable.");
  console.error("[hr-runtime] If you intentionally need a one-off compatibility run, set MC_ALLOW_PORT_3000_COMPAT=1.");
  console.error("");
  process.exit(1);
}

function isCodexManagedAncestor(pid) {
  let currentPid = pid;
  let depth = 0;
  while (Number.isInteger(currentPid) && currentPid > 1 && depth < 12) {
    try {
      const output = execFileSync("ps", ["-p", String(currentPid), "-o", "ppid=,command="], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (!output) return false;
      const match = output.match(/^\s*(\d+)\s+(.*)$/s);
      if (!match) return false;
      const nextPid = Number.parseInt(match[1], 10);
      const command = match[2] || "";
      if (command.includes("/Applications/Codex.app/Contents/Resources/codex app-server")) {
        return true;
      }
      if (!Number.isInteger(nextPid) || nextPid <= 0 || nextPid === currentPid) {
        return false;
      }
      currentPid = nextPid;
      depth += 1;
    } catch {
      return false;
    }
  }
  return false;
}

if (
  port === 3010 &&
  process.env.HIVERUNNER_MANAGED_START !== "1" &&
  isCodexManagedAncestor(process.ppid)
) {
  console.error("");
  console.error("[mc-dev] Refusing to start port 3010 under a Codex-managed exec session.");
  console.error("[mc-dev] Use scripts/start_dev_service.sh so the dev lane is script-managed.");
  console.error("");
  process.exit(1);
}

if (
  port === 3001 &&
  process.env.HIVERUNNER_MANAGED_START !== "1" &&
  isCodexManagedAncestor(process.ppid)
) {
  console.error("");
  console.error("[mc-stable] Refusing to start port 3001 under a Codex-managed exec session.");
  console.error("[mc-stable] Use scripts/start_stable_service.sh so the stable lane is script-managed.");
  console.error("");
  process.exit(1);
}

// ── Dev-lane heap guard ──
// Webpack dev mode for this app uses 2–3 GB RSS. The default Node heap
// limit (~4 GB) leaves almost no headroom and causes OOM crashes after
// ~2 hours. We can't set the limit from inside the process, but we can
// detect it and warn loudly so unmanaged starts are immediately visible.
if (dev) {
  const heapLimitMB = Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024);
  if (heapLimitMB < 6000) {
    console.warn("");
    console.warn("╔════════════════════════════════════════════════════════════╗");
    console.warn("║  ⚠  LOW HEAP LIMIT — dev server will likely OOM crash     ║");
    console.warn(`║  Current: ${String(heapLimitMB).padEnd(5)}MB — Recommended: 8192MB${" ".repeat(15)}║`);
    console.warn("║                                                            ║");
    console.warn("║  Fix: node --max-old-space-size=8192 server.js             ║");
    console.warn("║   Or: npm run dev                                          ║");
    console.warn("╚════════════════════════════════════════════════════════════╝");
    console.warn("");
  }
}

// ── Engine tick ownership ──
// MC_ENGINE_TICK controls whether this instance runs the autonomous
// execution loop that claims and executes queued heartbeat runs.
//
// Values:
//   "on"   — tick loop active (default for stable/production)
//   "off"  — tick loop disabled; this instance is observer-only
//   "auto" — tick if production, skip if development (default)
//
// In a two-lane setup:
//   Dev  (:3010) → MC_ENGINE_TICK=off  (build/UI lane, no execution)
//   Stable (:3001) → MC_ENGINE_TICK=on (operator lane, owns execution)
//
// The atomic claim mechanism (UPDATE WHERE status='queued') prevents
// duplicate execution even if both lanes tick, but disabling the dev
// lane's tick loop is cleaner and avoids noisy log competition.
const engineTickSetting = (process.env.MC_ENGINE_TICK || "auto").toLowerCase();
const baseEngineTickEnabled =
  engineTickSetting === "on" ? true :
  engineTickSetting === "off" ? false :
  /* auto */ !dev;
const devExecutionTestModeGateEnabled =
  dev &&
  port === 3010 &&
  (process.env.MC_DEV_EXECUTION_TEST_MODE || "").trim() === "1";
const engineTickEnabled = baseEngineTickEnabled || devExecutionTestModeGateEnabled;

// ── Bundler selection ──
// Next.js 16 defaults to Turbopack for dev. Turbopack's persistent cache
// (4–5 GB) has been the primary crash source for the dev lane — it panics
// when spawning PostCSS subprocesses after cache corruption (76 panic logs
// accumulated since March 27). Default to webpack for dev stability.
// Set NEXT_TURBOPACK=1 to re-enable Turbopack if you want to test it.
const useWebpack = dev && process.env.NEXT_TURBOPACK !== "1";
const app = next({ dev, hostname, port, ...(useWebpack ? { webpack: true } : {}) });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const handleUpgrade = app.getUpgradeHandler();
  const server = http.createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();
  let lastSnapshotJson = "";
  let heartbeatCount = 0;
  const taskEventsWss = new WebSocketServer({ noServer: true });
  const taskEventClients = new Set();

  const origin = `http://127.0.0.1:${port}`;

  async function fetchSnapshot() {
    const response = await fetch(`${origin}/api/live/snapshot`, {
      headers: { "x-hiverunner-live": "1" },
    });
    if (!response.ok) {
      throw new Error(`Snapshot request failed with ${response.status}`);
    }
    return response.json();
  }

  function broadcast(raw) {
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(raw);
      }
    }
  }

  async function sendLatestSnapshot(ws) {
    try {
      const snapshot = await fetchSnapshot();
      const payload = JSON.stringify({ type: "snapshot", snapshot });
      if (ws.readyState === 1) {
        ws.send(payload);
      }
      lastSnapshotJson = payload;
    } catch (error) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
          ts: new Date().toISOString(),
        }));
      }
    }
  }

  // Dev lane polls slower (15s) to reduce GC pressure — snapshot is ~1.3 MB
  // and each cycle allocates ≈2.6 MB (fetch response + JSON.stringify).
  // At 5s that's ~1.9 GB/hr of allocation churn; at 15s it's ~0.6 GB/hr.
  const snapshotIntervalMs = dev ? 15_000 : 5_000;

  const broadcastInterval = setInterval(async () => {
    if (clients.size === 0) return;

    try {
      const snapshot = await fetchSnapshot();
      const payload = JSON.stringify({ type: "snapshot", snapshot });
      if (payload !== lastSnapshotJson) {
        broadcast(payload);
        lastSnapshotJson = payload;
        heartbeatCount = 0;
        return;
      }

      heartbeatCount += 1;
      if (heartbeatCount >= 3) {
        broadcast(JSON.stringify({ type: "heartbeat", ts: new Date().toISOString() }));
        heartbeatCount = 0;
      }
    } catch (error) {
      broadcast(JSON.stringify({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        ts: new Date().toISOString(),
      }));
    }
  }, snapshotIntervalMs);

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: "connected", ts: new Date().toISOString() }));
    void sendLatestSnapshot(ws);

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  function taskKeyFromRow(row) {
    return row.task_key || (row.task_number != null && row.company_code
      ? `${row.company_code}-${row.task_number}`
      : undefined);
  }

  function queryTaskEventPayloads(companySlug, sinceIso) {
    const Database = require("better-sqlite3");
    const path = require("path");
    const db = new Database(path.join(mcDataDir, "orchestration.db"), { readonly: true });
    try {
      const events = db.prepare(
        `SELECT
          te.id,
          te.event_type,
          te.task_id,
          t.title AS task_title,
          t.task_number,
          t.task_key,
          te.project_id,
          p.slug AS project_slug,
          p.name AS project_name,
          c.slug AS company_slug,
          c.company_code,
          te.from_status,
          te.to_status,
          te.metadata_json,
          te.agent_id,
          a.name AS agent_name,
          te.created_at AS timestamp
         FROM task_events te
         LEFT JOIN tasks t ON t.id = te.task_id
         LEFT JOIN projects p ON p.id = te.project_id
         LEFT JOIN companies c ON c.id = p.company_id
         LEFT JOIN agents a ON a.id = te.agent_id
         WHERE te.created_at > ?
           AND (c.slug = ? OR UPPER(c.company_code) = UPPER(?) OR ? = '')
         ORDER BY te.created_at ASC
         LIMIT 50`
      ).all(sinceIso, companySlug, companySlug, companySlug);

      const comments = db.prepare(
        `SELECT
          cm.id,
          cm.task_id,
          t.title AS task_title,
          t.task_number,
          t.task_key,
          COALESCE(ag.name, cm.author_user_id, 'Agent') AS author_name,
          cm.body,
          cm.type,
          cm.created_at AS timestamp,
          cm.updated_at,
          p.slug AS project_slug,
          p.name AS project_name,
          c.slug AS company_slug,
          c.company_code
         FROM comments cm
         JOIN tasks t ON t.id = cm.task_id
         JOIN projects p ON p.id = t.project_id
         JOIN companies c ON c.id = p.company_id
         LEFT JOIN agents ag ON ag.id = cm.author_agent_id
         WHERE cm.created_at > ?
           AND (c.slug = ? OR UPPER(c.company_code) = UPPER(?) OR ? = '')
         ORDER BY cm.created_at ASC
         LIMIT 50`
      ).all(sinceIso, companySlug, companySlug, companySlug);

      let latestTime = sinceIso;
      const payloads = [];

      for (const event of events) {
        let metadata = {};
        try {
          metadata = event.metadata_json ? JSON.parse(String(event.metadata_json)) : {};
        } catch {
          metadata = {};
        }

        payloads.push({
          type: "activity",
          id: String(event.id),
          eventType: String(event.event_type),
          taskId: event.task_id ? String(event.task_id) : undefined,
          taskTitle: event.task_title ? String(event.task_title) : undefined,
          taskKey: taskKeyFromRow(event),
          projectSlug: event.project_slug ? String(event.project_slug) : undefined,
          projectName: event.project_name ? String(event.project_name) : undefined,
          agentId: event.agent_id ? String(event.agent_id) : undefined,
          agentName: event.agent_name ? String(event.agent_name) : undefined,
          fromStatus: event.from_status ? String(event.from_status) : undefined,
          toStatus: event.to_status ? String(event.to_status) : undefined,
          metadata,
          message: "",
          timestamp: String(event.timestamp),
        });
        if (String(event.timestamp) > latestTime) latestTime = String(event.timestamp);
      }

      for (const comment of comments) {
        payloads.push({
          type: "comment",
          id: String(comment.id),
          taskId: String(comment.task_id),
          taskTitle: comment.task_title ? String(comment.task_title) : undefined,
          taskKey: taskKeyFromRow(comment),
          author: String(comment.author_name || "Agent"),
          body: String(comment.body || ""),
          commentType: String(comment.type || "comment"),
          projectSlug: comment.project_slug ? String(comment.project_slug) : undefined,
          projectName: comment.project_name ? String(comment.project_name) : undefined,
          timestamp: String(comment.timestamp),
        });
        if (String(comment.timestamp) > latestTime) latestTime = String(comment.timestamp);
      }

      payloads.sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
      return { payloads, latestTime };
    } finally {
      db.close();
    }
  }

  const taskEventsInterval = setInterval(() => {
    if (taskEventClients.size === 0) return;

    for (const client of Array.from(taskEventClients)) {
      if (client.ws.readyState !== 1) {
        taskEventClients.delete(client);
        continue;
      }

      try {
        const result = queryTaskEventPayloads(client.companySlug, client.lastEventTime);
        client.lastEventTime = result.latestTime;
        for (const payload of result.payloads) {
          if (client.ws.readyState === 1) {
            client.ws.send(JSON.stringify(payload));
          }
        }
      } catch (error) {
        if (client.ws.readyState === 1) {
          client.ws.send(JSON.stringify({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
            ts: new Date().toISOString(),
          }));
        }
      }
    }
  }, 3000);

  taskEventsWss.on("connection", (ws, req) => {
    const url = new URL(req.url || "/", origin);
    const companySlug = url.searchParams.get("company") || "";
    const since = url.searchParams.get("since") || new Date(Date.now() - 5 * 60 * 1000).toISOString();
    if (!companySlug) {
      ws.send(JSON.stringify({ type: "error", message: "company query param required" }));
      ws.close();
      return;
    }

    const client = { ws, companySlug, lastEventTime: since };
    taskEventClients.add(client);
    ws.send(JSON.stringify({ type: "connected", since, transport: "websocket" }));

    ws.on("close", () => {
      taskEventClients.delete(client);
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url || "/", origin).pathname;
    if (pathname === "/api/live") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
      return;
    }

    if (pathname === "/api/orchestration/events/ws") {
      taskEventsWss.handleUpgrade(req, socket, head, (ws) => {
        taskEventsWss.emit("connection", ws, req);
      });
      return;
    }

    handleUpgrade(req, socket, head);
  });

  // ── Engine tick loop ──
  // Automatically claims and executes queued heartbeat runs every 10 seconds.
  // Only runs if engineTickEnabled (controlled by MC_ENGINE_TICK env var).
  let engineTickRunning = false;
  let engineTickInterval = null;

  if (engineTickEnabled) {
    engineTickInterval = setInterval(async () => {
      if (engineTickRunning) return;
      engineTickRunning = true;
      try {
        const response = await fetch(`${origin}/api/orchestration/engine/tick`, {
          method: "POST",
          headers: {
            "x-engine-tick": "internal",
            "Content-Type": "application/json",
          },
        });
        if (response.ok) {
          const result = await response.json();
          if (result.claimed) {
            const runs = Array.isArray(result.runs) ? result.runs : null;
            if (runs && runs.length > 1) {
              const summary = runs
                .map((r) => `${r.runId?.slice(0, 8)}→${r.status}`)
                .join(", ");
              console.log(
                `[engine:tick] executed ${runs.length} runs concurrently [${summary}] [${result.durationMs}ms]`
              );
            } else {
              console.log(
                `[engine:tick] executed run ${result.runId?.slice(0, 8)} → ${result.status}` +
                (result.error ? ` (${result.error.slice(0, 80)})` : "") +
                ` [${result.durationMs}ms]`
              );
            }
          }
          if (result.staleRunsRecovered > 0) {
            console.log(`[engine:tick] recovered ${result.staleRunsRecovered} stale run(s)`);
          }
        }
      } catch {
        // Tick failed — suppress to avoid flooding logs
      } finally {
        engineTickRunning = false;
      }
    }, 10_000);
  }

  const path = require("path");
  const mcAppRoot = process.env.MC_APP_ROOT
    ? path.resolve(process.env.MC_APP_ROOT)
    : path.resolve(process.cwd());
  const mcAppRootSource = process.env.MC_APP_ROOT ? "MC_APP_ROOT" : "process.cwd()";
  const mcDataDir = process.env.MC_DATA_DIR
    ? path.resolve(process.env.MC_DATA_DIR)
    : path.join(mcAppRoot, "data");
  const mcDataDirSource = process.env.MC_DATA_DIR
    ? "MC_DATA_DIR"
    : `default via ${mcAppRootSource}`;
  const mcLane = process.env.MC_WORKSPACE_ROOT
    ? process.env.MC_WORKSPACE_ROOT.includes(`${path.sep}.hiverunner${path.sep}dev${path.sep}`)
      || process.env.MC_WORKSPACE_ROOT.includes(`${path.sep}.mission-control${path.sep}dev${path.sep}`)
      ? "dev"
      : process.env.MC_WORKSPACE_ROOT.includes(`${path.sep}.hiverunner${path.sep}stable${path.sep}`)
        || process.env.MC_WORKSPACE_ROOT.includes(`${path.sep}.mission-control${path.sep}stable${path.sep}`)
        ? "stable"
        : (dev ? "dev" : "stable")
    : (dev ? "dev" : "stable");
  const mcWorkspaceRoot = process.env.MC_WORKSPACE_ROOT
    ? path.resolve(process.env.MC_WORKSPACE_ROOT)
    : path.join(require("os").homedir(), ".hiverunner", "workspace");
  const mcWorkspaceRootSource = process.env.MC_WORKSPACE_ROOT ? "MC_WORKSPACE_ROOT" : "default";

  server.listen(port, hostname, () => {
    const heapMB = Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024);
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Mode: ${dev ? "development" : "production"}`);
    console.log(`> App root: ${mcAppRoot} (${mcAppRootSource})`);
    console.log(`> Data dir: ${mcDataDir} (${mcDataDirSource})`);
    console.log(`> Workspace root: ${mcWorkspaceRoot} (${mcWorkspaceRootSource}, lane=${mcLane})`);
    console.log(`> Heap limit: ${heapMB}MB`);
    console.log(`> Bundler: ${useWebpack ? "webpack" : "turbopack"}`);
    console.log(`> Engine tick: ${engineTickEnabled ? "ACTIVE (every 10s)" : "DISABLED (observer-only)"} (MC_ENGINE_TICK=${engineTickSetting})`);
    if (dev && port === 3010) {
      console.log(`> Dev execution test mode: ${devExecutionTestModeGateEnabled ? "AVAILABLE (company-scoped, auto-expiring)" : "DISABLED"}`);
    }
    console.log(`> Snapshot poll: ${snapshotIntervalMs / 1000}s`);

    // ── DB health check ──
    // Log critical row counts at boot so unexpected drops (e.g. tasks going
    // to 0 after a cleanup or promotion) are immediately visible in the log.
    setTimeout(() => {
      try {
        const Database = require("better-sqlite3");
        const orchDbPath = path.join(mcDataDir, "orchestration.db");
        const db = new Database(orchDbPath, { readonly: true });
        const q = (sql) => db.prepare(sql).get().n;
        const counts = {
          companies: q("SELECT COUNT(*) as n FROM companies"),
          projects: q("SELECT COUNT(*) as n FROM projects"),
          agents: q("SELECT COUNT(*) as n FROM agents WHERE archived_at IS NULL"),
          tasks: q("SELECT COUNT(*) as n FROM tasks"),
        };
        db.close();
        console.log(`> DB health: ${counts.companies} companies, ${counts.projects} projects, ${counts.agents} agents, ${counts.tasks} tasks`);
        if (counts.tasks === 0 && counts.projects > 0) {
          console.warn("> WARNING: 0 tasks in a system with active projects — verify this is intentional");
        }
      } catch (e) {
        console.warn("> DB health check failed:", e.message || e);
      }
    }, 500);

    // Pre-warm edge route maps: populate the globalThis cache so the middleware
    // can resolve canonical company-code routes (e.g. /MER/org → /companies/meridian-labs/org)
    // without needing a self-fetch. The middleware and server share globalThis.
    setTimeout(async () => {
      try {
        const resp = await fetch(`${origin}/api/orchestration/edge-route-maps`, {
          headers: { "x-mc-internal": "startup-prewarm" },
        });
        if (resp.ok) {
          const maps = await resp.json();
          globalThis.__mcEdgeRouteMapCache = {
            maps,
            expiresAt: Date.now() + 120_000,
            version: globalThis.__mcEdgeRouteMapVersion ?? 0,
          };
          console.log(`> Edge route maps: ${Object.keys(maps.companyCodeToSlug || {}).length} companies loaded`);
        }
      } catch (e) {
        console.warn("> Edge route maps pre-warm failed:", e.message || e);
      }
    }, 1500);

    // Pre-warm models cache so the wizard dropdown loads instantly.
    setTimeout(async () => {
      try {
        await fetch(`${origin}/api/orchestration/models`);
        console.log("> Models cache: pre-warmed");
      } catch {
        // Non-critical
      }
    }, 2000);

    // Pre-warm: hit the SSE endpoint once to trigger adapter registry initialization.
    // This ensures provider adapters (including the OpenClaw gateway WS connection)
    // are established before the operator opens the dashboard, reducing first-event latency.
    setTimeout(async () => {
      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 2000); // don't hold the connection
        await fetch(`${origin}/api/orchestration/engine/live-stream?company=__prewarm__`, {
          signal: controller.signal,
        });
      } catch {
        // Expected: abort signal fires. Bridge is now initialized.
      }
    }, 3000);
  });

  const cleanup = () => {
    clearInterval(broadcastInterval);
    if (engineTickInterval) clearInterval(engineTickInterval);
    for (const client of clients) {
      try {
        client.close();
      } catch {}
    }
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
