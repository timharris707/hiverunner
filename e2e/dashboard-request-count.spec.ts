import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

type RequestBucket =
  | "companies"
  | "projects"
  | "agents"
  | "tasks"
  | "activity"
  | "approvals"
  | "goals"
  | "snapshot"
  | "activeAgentRuns"
  | "liveStream"
  | "eventsStream"
  | "otherApi";

type RequestRecord = {
  url: string;
  method: string;
  bucket: RequestBucket;
  startedAt: number;
  finishedAt?: number;
  status?: number;
  failed?: string;
};

const OBSERVE_MS = Number(process.env.REQUEST_COUNT_OBSERVE_MS ?? 10_000);
const OUTPUT_PATH = process.env.REQUEST_COUNT_OUTPUT
  ?? path.join(process.cwd(), "output/verification/bundle-6/recovery/request-counts.json");

const EXPECTED_MAX: Record<RequestBucket, number> = {
  // Dashboard and Dock both resolve company/project/agent navigation state.
  companies: 2,
  projects: 5,
  agents: 3,
  // Dashboard data widgets should load once during a 10s steady-state window.
  tasks: 1,
  activity: 1,
  approvals: 1,
  goals: 2,
  // Live widgets may do one initial fetch plus one poll in the 10s window.
  snapshot: 2,
  activeAgentRuns: 2,
  liveStream: 1,
  eventsStream: 4,
  otherApi: 30,
};

function bucketFor(urlString: string): RequestBucket | null {
  const url = new URL(urlString);
  if (!url.pathname.startsWith("/api/")) return null;
  if (url.pathname === "/api/orchestration/companies") return "companies";
  if (/^\/api\/orchestration\/companies\/[^/]+\/projects$/.test(url.pathname)) return "projects";
  if (/^\/api\/orchestration\/companies\/[^/]+\/agents$/.test(url.pathname)) return "agents";
  if (url.pathname === "/api/orchestration/tasks") return "tasks";
  if (url.pathname === "/api/orchestration/activity") return "activity";
  if (/^\/api\/orchestration\/companies\/[^/]+\/approvals$/.test(url.pathname)) return "approvals";
  if (/^\/api\/orchestration\/companies\/[^/]+\/goals$/.test(url.pathname)) return "goals";
  if (url.pathname === "/api/live/snapshot") return "snapshot";
  if (url.pathname === "/api/orchestration/engine/active-agent-runs") return "activeAgentRuns";
  if (url.pathname === "/api/orchestration/engine/live-stream") return "liveStream";
  if (url.pathname === "/api/orchestration/events/stream") return "eventsStream";
  return "otherApi";
}

function isExpectedOpenStream(record: RequestRecord): boolean {
  return record.bucket === "liveStream" || record.bucket === "eventsStream";
}

test("dashboard request volume stays bounded during initial steady state", async ({ page }, testInfo) => {
  const records = new Map<string, RequestRecord>();
  const startedByBucket: Record<RequestBucket, number> = {
    companies: 0,
    projects: 0,
    agents: 0,
    tasks: 0,
    activity: 0,
    approvals: 0,
    goals: 0,
    snapshot: 0,
    activeAgentRuns: 0,
    liveStream: 0,
    eventsStream: 0,
    otherApi: 0,
  };

  page.on("request", (request) => {
    const bucket = bucketFor(request.url());
    if (!bucket) return;
    const id = `${Date.now()}:${Math.random()}:${request.method()}:${request.url()}`;
    records.set(id, {
      url: request.url(),
      method: request.method(),
      bucket,
      startedAt: Date.now(),
    });
    startedByBucket[bucket] += 1;
  });

  page.on("requestfinished", async (request) => {
    const latest = Array.from(records.entries())
      .reverse()
      .find(([, record]) => record.url === request.url() && record.method === request.method() && record.finishedAt == null);
    if (!latest) return;
    const [id, record] = latest;
    records.set(id, {
      ...record,
      finishedAt: Date.now(),
      status: request.response() ? (await request.response())?.status() : undefined,
    });
  });

  page.on("requestfailed", (request) => {
    const latest = Array.from(records.entries())
      .reverse()
      .find(([, record]) => record.url === request.url() && record.method === request.method() && record.finishedAt == null);
    if (!latest) return;
    const [id, record] = latest;
    records.set(id, {
      ...record,
      finishedAt: Date.now(),
      failed: request.failure()?.errorText ?? "request failed",
    });
  });

  const pageResponse = await page.goto("/INS/dashboard", { waitUntil: "domcontentloaded" });
  const pageStatus = pageResponse?.status() ?? null;
  let dashboardHeadingVisible = false;
  try {
    await page.getByRole("heading", { name: "Dashboard" }).first().waitFor({
      state: "visible",
      timeout: 15_000,
    });
    dashboardHeadingVisible = true;
  } catch {
    dashboardHeadingVisible = false;
  }
  await page.waitForTimeout(OBSERVE_MS);

  const all = Array.from(records.values());
  const pending = all.filter((record) => record.finishedAt == null);
  const unexpectedPending = pending.filter((record) => !isExpectedOpenStream(record));
  const byUrl: Record<string, number> = {};
  for (const record of all) {
    const url = new URL(record.url);
    const key = `${record.method} ${url.pathname}${url.search}`;
    byUrl[key] = (byUrl[key] ?? 0) + 1;
  }

  const result = {
    commit: process.env.GIT_COMMIT_UNDER_TEST ?? "unknown",
    baseURL: testInfo.project.use.baseURL,
    page: {
      status: pageStatus,
      url: page.url(),
      dashboardHeadingVisible,
    },
    observedMs: OBSERVE_MS,
    expectedMax: EXPECTED_MAX,
    startedByBucket,
    pendingCount: pending.length,
    unexpectedPendingCount: unexpectedPending.length,
    pending: pending.map((record) => ({ method: record.method, bucket: record.bucket, url: record.url })),
    unexpectedPending: unexpectedPending.map((record) => ({ method: record.method, bucket: record.bucket, url: record.url })),
    byUrl,
    records: all.map((record) => ({
      method: record.method,
      bucket: record.bucket,
      url: record.url,
      status: record.status,
      failed: record.failed,
      durationMs: record.finishedAt ? record.finishedAt - record.startedAt : null,
    })),
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);

  expect(pageStatus, `Dashboard page should load successfully; see ${OUTPUT_PATH}`).not.toBeNull();
  expect(pageStatus as number, `Dashboard page should not return an error; see ${OUTPUT_PATH}`).toBeLessThan(400);
  expect(dashboardHeadingVisible, `Dashboard heading should render; see ${OUTPUT_PATH}`).toBe(true);
  expect(unexpectedPending, `No non-stream API requests should remain pending after ${OBSERVE_MS}ms`).toHaveLength(0);
  for (const [bucket, max] of Object.entries(EXPECTED_MAX) as Array<[RequestBucket, number]>) {
    expect(
      startedByBucket[bucket],
      `${bucket} request count exceeded expected max ${max}; see ${OUTPUT_PATH}`,
    ).toBeLessThanOrEqual(max);
  }
});
