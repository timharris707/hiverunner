#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { parseHiveRunnerMcpLaunchOptions } from "@/lib/orchestration/mcp/cli-options";
import { resolveMcpRequestContext } from "@/lib/orchestration/mcp/context";
import { buildMcpStartupErrorEnvelope } from "@/lib/orchestration/mcp/errors";
import { createHiveRunnerMcpServer } from "@/lib/orchestration/mcp/server";

export async function runHiveRunnerMcpCli(
  argv = process.argv.slice(2),
  env = process.env,
): Promise<void> {
  const options = parseHiveRunnerMcpLaunchOptions(argv, env);
  const context = resolveMcpRequestContext({
    company: options.company,
    actorName: options.actorName,
  });
  const server = createHiveRunnerMcpServer({ context });
  await server.connect(new StdioServerTransport());
}

if (process.argv[1]?.endsWith("hiverunner-mcp.ts")) {
  runHiveRunnerMcpCli().catch((error) => {
    process.stderr.write(`${JSON.stringify(buildMcpStartupErrorEnvelope(error))}\n`);
    process.exitCode = 1;
  });
}
