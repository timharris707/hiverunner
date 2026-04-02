import { test, expect } from "@playwright/test";

test.describe("Dashboard metrics", () => {
  test("dashboard stats API documents every homepage metric", async ({ request }) => {
    const res = await request.get("/api/dashboard/stats");
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("metrics");

    const metricKeys = ["activeAgents", "tasksToday", "activeSessions", "costToday"] as const;
    for (const key of metricKeys) {
      expect(body.metrics[key].label).toBeTruthy();
      expect(body.metrics[key].subtitle).toBeTruthy();
      expect(body.metrics[key].definition).toBeTruthy();
      expect(body.metrics[key].source).toBeTruthy();
      expect(body.metrics[key].timeRange).toBeTruthy();
      expect(body.metrics[key].verification).toBeTruthy();
    }

    expect(body.metrics.activeAgents.definition).toMatch(/online, active, or building/i);
    expect(body.metrics.costToday.timeRange).toMatch(/UTC/i);
  });

  test("homepage metric cards show labels, tooltips, and stable metric semantics", async ({ page }) => {
    await page.route("/api/agents", async (route) => {
      await route.fulfill({
        json: { agents: [] },
      });
    });
    await page.route("/api/dashboard/highlights", async (route) => {
      await route.fulfill({
        json: { todayTasks: [], nextCron: null, providers: [] },
      });
    });
    await page.route("/api/dashboard/stats", async (route) => {
      await route.fulfill({
        json: {
          activeSessions: 4,
          totalSessions: 11,
          tasksToday: 199,
          costToday: 53.1,
          costByAgentToday: [
            { agent: "Pixel", cost: 5.85 },
            { agent: "Forge", cost: 1.8 },
            { agent: "Vigil", cost: 1.35 },
          ],
          activeAgents: 3,
          metrics: {
            activeAgents: {
              label: "Active Agents",
              subtitle: "Status = online, active, or building",
              definition: "Counts agents whose computed live status is online, active, or building. Pending and offline agents are excluded.",
              source: "/Users/timharris/.openclaw/agents/main/sessions/sessions.json",
              timeRange: "Rolling 2 hours from the latest session update",
              verification: "Computed directly from live session records on each dashboard request.",
            },
            tasksToday: {
              label: "Task Log Entries",
              subtitle: "Logged under 2026-03-30",
              definition: "Counts task log lines in today's tasks-log section, including completed, in-progress, and failed entries that were appended for the current date.",
              source: "/Users/timharris/.openclaw/workspace/memory/tasks-log.md",
              timeRange: "tasks-log.md section for 2026-03-30",
              verification: "Read directly from the append-only task log on each dashboard request.",
            },
            activeSessions: {
              label: "Sessions Updated",
              subtitle: "Non-run sessions touched in the last 2 hours",
              definition: "Counts OpenClaw sessions whose updatedAt timestamp is within the last 2 hours. Run transcript sessions are excluded.",
              source: "/Users/timharris/.openclaw/agents/main/sessions/sessions.json",
              timeRange: "Rolling 2 hours from now",
              verification: "Computed from sessions.json at request time with the same filter used by the agent status snapshot.",
            },
            costToday: {
              label: "Approved Spend",
              subtitle: "Quota state for 2026-03-30 UTC",
              definition: "Shows quota-approved estimated build spend accumulated in the daily quota ledger, not downstream provider invoices.",
              source: "/Users/timharris/.openclaw/workspace/projects/mission-control-app/data/quota-state.json",
              timeRange: "2026-03-30 UTC quota day (March 30, 2026 local when rendered)",
              verification: "Read from the live quota ledger and summed with the same normalization used on the Costs page.",
            },
          },
        },
      });
    });
    await page.route("/api/advisory/sessions", async (route) => {
      await route.fulfill({
        json: { sessions: [] },
      });
    });
    await page.route("/api/agents/status", async (route) => {
      await route.fulfill({
        json: { agents: [], gatewayReachable: true, updatedAt: Date.now() },
      });
    });
    await page.route("/api/tasks", async (route) => {
      await route.fulfill({
        json: { tasks: [] },
      });
    });
    await page.route("/api/projects", async (route) => {
      await route.fulfill({
        json: { projects: [] },
      });
    });

    await page.goto("/");

    await expect(page.getByTestId("metric-active-agents")).toContainText("Active Agents");
    await expect(page.getByTestId("metric-task-log-entries")).toContainText("Task Log Entries");
    await expect(page.getByTestId("metric-active-sessions")).toContainText("Sessions Updated");
    await expect(page.getByTestId("metric-approved-spend")).toContainText("Approved Spend");

    await page.getByLabel("Explain Active Agents").click();
    await expect(page.getByRole("tooltip")).toContainText("online, active, or building");
    await expect(page.getByRole("tooltip")).toContainText("Rolling 2 hours");
    await page.mouse.click(0, 0);

    await page.getByLabel("Explain Approved Spend").click();
    await expect(page.getByRole("tooltip")).toContainText(/UTC quota day|UTC/i);
    await expect(page.getByRole("tooltip")).toContainText("quota ledger");
    await page.mouse.click(0, 0);

    await expect(page.getByTestId("metric-active-agents-value")).toContainText(/^\d+$/);
    await expect(page.getByTestId("metric-task-log-entries-value")).toContainText(/^\d+$/);
    await expect(page.getByTestId("metric-active-sessions-value")).toContainText(/^\d+$/);
    await expect(page.getByTestId("metric-approved-spend-value")).toContainText(/^\$/);
  });
});
