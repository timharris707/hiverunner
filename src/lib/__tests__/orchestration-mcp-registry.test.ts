import assert from "node:assert";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createCompany } from "@/lib/orchestration/company-service";
import { parseHiveRunnerMcpLaunchOptions } from "@/lib/orchestration/mcp/cli-options";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveMcpRequestContext } from "@/lib/orchestration/mcp/context";
import { buildMcpStartupErrorEnvelope } from "@/lib/orchestration/mcp/errors";
import {
  HIVE_RUNNER_MCP_PUBLIC_RESOURCE_DEFINITIONS,
  HIVE_RUNNER_MCP_TOOL_DEFINITIONS,
  listHiveRunnerMcpResourceNames,
  listHiveRunnerMcpToolNames,
} from "@/lib/orchestration/mcp/registry";
import {
  buildHiveRunnerMcpCapabilitiesResourceUri,
  createHiveRunnerMcpServer,
} from "@/lib/orchestration/mcp/server";

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

async function run() {
  console.log("\nHiveRunner MCP Registry Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "orchestration-mcp-registry-"));
  const homeDir = path.join(tempRoot, "home");
  const workspaceRoot = path.join(tempRoot, "workspaces");
  mkdirSync(homeDir, { recursive: true });
  process.env.HOME = homeDir;
  process.env.MC_WORKSPACE_ROOT = workspaceRoot;
  process.env.ORCHESTRATION_DB_PATH = path.join(tempRoot, "orchestration.db");
  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

  const company = createCompany({
    name: "Insight MCP Registry",
    description: "MCP registry test fixture.",
    status: "active",
  }).company;
  const db = getOrchestrationDb();
  const companyCode = company.code;

  const context = resolveMcpRequestContext({ company: companyCode, db });
  const server = createHiveRunnerMcpServer({ context });

  await test("registry exposes the approved public resources and tools", () => {
    assert.deepEqual(listHiveRunnerMcpResourceNames(), [
      "hiverunner.goals.list",
      "hiverunner.tasks.list",
      "hiverunner.task.read",
      "hiverunner.trace.read",
      "hiverunner.trace.export",
      "hiverunner.evals.list",
      "hiverunner.eval.read",
      "hiverunner.experiment_reports.list",
      "hiverunner.experiment_report.read",
      "hiverunner.improve.list",
      "hiverunner.improve.read",
      "hiverunner.team.list",
      "hiverunner.team.bench",
      "hiverunner.templates.list",
      "hiverunner.template.read",
    ]);
    assert.equal(HIVE_RUNNER_MCP_PUBLIC_RESOURCE_DEFINITIONS.length, 15);
    assert.deepEqual(listHiveRunnerMcpToolNames(), [
      "hiverunner.eval.save_case",
      "hiverunner.evidence.attach",
      "hiverunner.improve.create_recommendation",
      "hiverunner.approval.request",
    ]);
    assert.equal(HIVE_RUNNER_MCP_TOOL_DEFINITIONS.length, 4);
    assert.equal(HIVE_RUNNER_MCP_TOOL_DEFINITIONS.some((tool) => /experiment/i.test(tool.name)), false);
  });

  await test("server scaffold advertises resources and tools through MCP handlers", async () => {
    const resources = await server.server._requestHandlers.get("resources/list")?.(
      { method: "resources/list", params: {} },
      {} as never,
    );
    const tools = await server.server._requestHandlers.get("tools/list")?.(
      { method: "tools/list", params: {} },
      {} as never,
    );

    assert.deepEqual(
      (resources as { resources: { name: string }[] }).resources.map((resource) => resource.name),
      listHiveRunnerMcpResourceNames(),
    );
    assert.deepEqual(
      (tools as { tools: { name: string }[] }).tools.map((tool) => tool.name),
      listHiveRunnerMcpToolNames(),
    );
  });

  await test("capabilities resource gives clients a connection-state check", async () => {
    const uri = buildHiveRunnerMcpCapabilitiesResourceUri(context);
    const result = await server.server._requestHandlers.get("resources/read")?.(
      { method: "resources/read", params: { uri } },
      {} as never,
    );
    const text = (result as { contents: { text: string }[] }).contents[0]?.text;
    const payload = JSON.parse(text ?? "{}");

    assert.equal(payload.schema, "mcp.capabilities.v1");
    assert.equal(payload.server.name, "hiverunner");
    assert.equal(payload.server.version, "1.0.0");
    assert.equal(payload.server.transport, "stdio");
    assert.equal(payload.company.code, companyCode);
    assert.equal(payload.registry.resources.count, 15);
    assert.equal(payload.registry.tools.count, 4);
    assert.equal(payload.boundaries.stable3001Changed, false);
    assert.equal(payload.boundaries.globalMcpConfigWrites, false);
  });

  await test("local MCP client can connect, list capabilities, and exit cleanly", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const connectedServer = createHiveRunnerMcpServer({ context });
    const client = new Client({ name: "hiverunner-mcp-registry-test", version: "1.0.0" });

    await connectedServer.connect(serverTransport);
    try {
      await client.connect(clientTransport);

      assert.deepEqual(client.getServerVersion(), {
        name: "hiverunner",
        version: "1.0.0",
      });

      const resources = await client.listResources();
      const tools = await client.listTools();
      assert.deepEqual(
        resources.resources.map((resource) => resource.name),
        listHiveRunnerMcpResourceNames(),
      );
      assert.deepEqual(
        tools.tools.map((tool) => tool.name),
        listHiveRunnerMcpToolNames(),
      );

      const capabilities = await client.readResource({
        uri: buildHiveRunnerMcpCapabilitiesResourceUri(context),
      });
      const content = capabilities.contents[0];
      assert.ok(content && "text" in content);
      const payload = JSON.parse(content.text);
      assert.equal(payload.schema, "mcp.capabilities.v1");
      assert.equal(payload.company.code, companyCode);
    } finally {
      await client.close().catch(() => undefined);
      await connectedServer.close().catch(() => undefined);
    }
  });

  await test("startup failure envelopes are structured", () => {
    assert.deepEqual(buildMcpStartupErrorEnvelope(new Error("boom")), {
      schema: "hiverunner.mcp.startup_error.v1",
      code: "startup_failed",
      message: "boom",
    });
    assert.deepEqual(
      parseHiveRunnerMcpLaunchOptions(["--company", companyCode, "--actor", "Registry Test"], {}),
      {
        company: companyCode,
        actorName: "Registry Test",
      },
    );
    assert.throws(() => resolveMcpRequestContext({ company: "", db }), /--company/);
    assert.throws(() => resolveMcpRequestContext({ company: "NOPE", db }), /No active HiveRunner company/);
  });

  await test("scaffold does not write global MCP client configuration", () => {
    const homeEntries = readdirSync(homeDir, { recursive: true });
    assert.deepEqual(homeEntries, []);
  });

  rmSync(tempRoot, { recursive: true, force: true });
  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
