import assert from "node:assert";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { createProject, createProjectAgent } from "@/lib/orchestration/service";
import {
  GET as getCompanyExecutionSettingsRoute,
  PATCH as patchCompanyExecutionSettingsRoute,
} from "@/app/api/orchestration/companies/[slug]/settings/execution/route";

let passed = 0;
let failed = 0;

const originalFetch = globalThis.fetch;
const originalEnv = {
  PAPERCLIP_API_URL: process.env.PAPERCLIP_API_URL,
  PAPERCLIP_API_KEY: process.env.PAPERCLIP_API_KEY,
};

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  \u2717 ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nOrchestration Company Execution Settings Route Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  process.env.PAPERCLIP_API_URL = "http://paperclip.test";
  process.env.PAPERCLIP_API_KEY = "test-key";

  const company = createCompany({
    name: `Execution Company ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  const project = createProject({
    companyId: company.id,
    name: `Execution Project ${Date.now()}`,
    description: "fixture",
    color: "#0ea5e9",
    emoji: "\ud83d\udee0\ufe0f",
    status: "active",
  }).project;

  const agent = createProjectAgent({
    projectId: project.id,
    name: "Forge",
    emoji: "\ud83d\udd27",
    role: "Backend Engineer",
    personality: "Systematic",
    model: "gpt-5.3-codex",
    paperclipAgentId: "pc-forge-1",
    status: "idle",
    skills: [],
  }).agent;

  const otherCompany = createCompany({
    name: `Execution Other Company ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  const otherProject = createProject({
    companyId: otherCompany.id,
    name: `Execution Other Project ${Date.now()}`,
    description: "fixture",
    color: "#f97316",
    emoji: "🧪",
    status: "active",
  }).project;

  const otherAgent = createProjectAgent({
    projectId: otherProject.id,
    name: "Scout",
    emoji: "🧭",
    role: "QA Engineer",
    personality: "Thorough",
    model: "gpt-5.4-mini",
    paperclipAgentId: "pc-scout-1",
    status: "idle",
    skills: [],
  }).agent;

  await test("GET returns company-scoped execution settings rows", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `http://paperclip.test/api/companies/${company.id}/agents`) {
        return new Response(
          JSON.stringify([
            {
              id: "pc-forge-1",
              companyId: company.id,
              name: "Forge",
              role: "engineer",
              title: "Backend Engineer",
              status: "running",
              adapterType: "codex_local",
              adapterConfig: {
                model: "gpt-5.3-codex",
              },
              runtimeConfig: {
                heartbeat: {
                  enabled: true,
                  intervalSec: 120,
                },
                execution: {
                  timeoutSec: 1800,
                  graceSec: 60,
                },
                executionProvider: "paperclip",
                openclawAgentId: "forge",
              },
              lastHeartbeatAt: "2026-04-02T07:40:00.000Z",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    }) as typeof fetch;

    const req = {
      nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.slug}/settings/execution`),
    };

    const res = await getCompanyExecutionSettingsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 200);
    const payload = (await res.json()) as {
      company: { id: string };
      agents: Array<{
        agentId: string;
        modelId: string;
        adapterType?: string;
        timeoutSeconds: number | null;
        graceSeconds: number | null;
        pauseStatus: { isPaused: boolean; status: string };
        safeRuntimeConfig: {
          heartbeatEnabled?: boolean;
          heartbeatIntervalSeconds?: number;
          executionProvider?: string;
          openclawAgentId?: string;
        };
      }>;
    };

    assert.strictEqual(payload.company.id, company.id);
    const row = payload.agents.find((entry) => entry.agentId === agent.id);
    assert.ok(row, "Expected Forge row in execution settings response");
    assert.strictEqual(row?.adapterType, "codex_local");
    assert.strictEqual(row?.modelId, "gpt-5.3-codex");
    assert.strictEqual(row?.timeoutSeconds, 1800);
    assert.strictEqual(row?.graceSeconds, 60);
    assert.strictEqual(row?.pauseStatus.isPaused, false);
    assert.strictEqual(row?.safeRuntimeConfig.heartbeatEnabled, true);
    assert.strictEqual(row?.safeRuntimeConfig.heartbeatIntervalSeconds, 120);
    assert.strictEqual(row?.safeRuntimeConfig.executionProvider, "paperclip");
    assert.strictEqual(row?.safeRuntimeConfig.openclawAgentId, "forge");
    assert.ok(
      !payload.agents.some((entry) => entry.agentId === otherAgent.id),
      "Expected scoped execution response to exclude other-company agents"
    );
  });

  await test("PATCH updates model and execution timeout settings when control plane allows it", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });

      if (url === `http://paperclip.test/api/companies/${company.id}/agents`) {
        return new Response(
          JSON.stringify([
            {
              id: "pc-forge-1",
              companyId: company.id,
              name: "Forge",
              status: "running",
              adapterType: "codex_local",
              adapterConfig: { model: "gpt-5.3-codex" },
              runtimeConfig: {
                heartbeat: { enabled: true, intervalSec: 120 },
                execution: { timeoutSec: 1800, graceSec: 60 },
              },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url === "http://paperclip.test/api/agents/pc-forge-1" && method === "PATCH") {
        return new Response(JSON.stringify({ id: "pc-forge-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch request: ${method} ${url}`);
    }) as typeof fetch;

    const req = {
      async json() {
        return {
          agentId: agent.id,
          modelId: "gpt-5.4",
          timeoutSeconds: 2400,
          graceSeconds: 120,
        };
      },
    };

    const res = await patchCompanyExecutionSettingsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 200);
    const payload = (await res.json()) as {
      agent: { modelId: string; timeoutSeconds: number | null; graceSeconds: number | null };
    };

    assert.strictEqual(payload.agent.modelId, "gpt-5.4");
    assert.strictEqual(payload.agent.timeoutSeconds, 2400);
    assert.strictEqual(payload.agent.graceSeconds, 120);

    const patchCall = calls.find(
      (call) => call.url === "http://paperclip.test/api/agents/pc-forge-1" && call.method === "PATCH"
    );

    assert.ok(patchCall, "Expected Paperclip PATCH call");
    assert.deepStrictEqual(patchCall?.body, {
      adapterConfig: {
        model: "gpt-5.4",
      },
      runtimeConfig: {
        heartbeat: {
          enabled: true,
          intervalSec: 120,
        },
        execution: {
          timeoutSec: 2400,
          graceSec: 120,
        },
      },
    });
  });

  await test("PATCH returns clear forbidden error when updates are not permitted", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === `http://paperclip.test/api/companies/${company.id}/agents`) {
        return new Response(
          JSON.stringify([
            {
              id: "pc-forge-1",
              companyId: company.id,
              name: "Forge",
              status: "running",
              adapterConfig: { model: "gpt-5.3-codex" },
              runtimeConfig: { execution: { timeoutSec: 1800, graceSec: 60 } },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url === "http://paperclip.test/api/agents/pc-forge-1" && method === "PATCH") {
        return new Response(
          JSON.stringify({ error: { code: "forbidden", message: "not allowed" } }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Unexpected fetch request: ${method} ${url}`);
    }) as typeof fetch;

    const req = {
      async json() {
        return {
          agentId: agent.id,
          timeoutSeconds: 2000,
        };
      },
    };

    const res = await patchCompanyExecutionSettingsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 403);
    const payload = (await res.json()) as { error: { code: string } };
    assert.strictEqual(payload.error.code, "execution_settings_update_forbidden");
  });

  await test("PATCH rejects cross-company agent updates", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === `http://paperclip.test/api/companies/${company.id}/agents`) {
        return new Response(
          JSON.stringify([
            {
              id: "pc-forge-1",
              companyId: company.id,
              name: "Forge",
              status: "running",
              adapterConfig: { model: "gpt-5.3-codex" },
              runtimeConfig: { execution: { timeoutSec: 1800, graceSec: 60 } },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Unexpected fetch request: ${method} ${url}`);
    }) as typeof fetch;

    const req = {
      async json() {
        return {
          agentId: otherAgent.id,
          timeoutSeconds: 3000,
        };
      },
    };

    const res = await patchCompanyExecutionSettingsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 404);
    const payload = (await res.json()) as { error: { code: string } };
    assert.strictEqual(payload.error.code, "agent_not_found");
  });

  await test("PATCH validates payload shape", async () => {
    const req = {
      async json() {
        return {
          agentId: agent.id,
        };
      },
    };

    const res = await patchCompanyExecutionSettingsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.strictEqual(payload.error.code, "validation_error");
  });

  await test("GET validates query params", async () => {
    const req = {
      nextUrl: new URL(
        `http://localhost/api/orchestration/companies/${company.slug}/settings/execution?includeNonProduction=maybe`
      ),
    };

    const res = await getCompanyExecutionSettingsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.strictEqual(payload.error.code, "validation_error");
  });

  globalThis.fetch = originalFetch;
  process.env.PAPERCLIP_API_URL = originalEnv.PAPERCLIP_API_URL;
  process.env.PAPERCLIP_API_KEY = originalEnv.PAPERCLIP_API_KEY;

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    globalThis.fetch = originalFetch;
    process.env.PAPERCLIP_API_URL = originalEnv.PAPERCLIP_API_URL;
    process.env.PAPERCLIP_API_KEY = originalEnv.PAPERCLIP_API_KEY;
  });
