const http = require("http");
const next = require("next");
const { WebSocketServer } = require("ws");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
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

  const origin = `http://127.0.0.1:${port}`;

  async function fetchSnapshot() {
    const response = await fetch(`${origin}/api/live/snapshot`, {
      headers: { "x-mission-control-live": "1" },
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
  }, 5000);

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: "connected", ts: new Date().toISOString() }));
    void sendLatestSnapshot(ws);

    ws.on("close", () => {
      clients.delete(ws);
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

    handleUpgrade(req, socket, head);
  });

  // ── Engine tick loop ──
  // Automatically claims and executes queued heartbeat runs every 10 seconds.
  // This is the autonomous execution layer that makes queued wakeups actually fire.
  let engineTickRunning = false;

  const engineTickInterval = setInterval(async () => {
    if (engineTickRunning) return; // Skip if previous tick is still executing
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
          console.log(
            `[engine:tick] executed run ${result.runId?.slice(0, 8)} → ${result.status}` +
            (result.error ? ` (${result.error.slice(0, 80)})` : "") +
            ` [${result.durationMs}ms]`
          );
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

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Engine tick loop active (every 10s)`);
  });

  const cleanup = () => {
    clearInterval(broadcastInterval);
    clearInterval(engineTickInterval);
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
