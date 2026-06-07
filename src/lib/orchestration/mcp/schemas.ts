import { z } from "zod";

import {
  HIVE_RUNNER_MCP_SERVER_NAME,
  HIVE_RUNNER_MCP_SERVER_VERSION,
  HIVE_RUNNER_MCP_TRANSPORT,
} from "@/lib/orchestration/mcp/registry";

export const hiveRunnerMcpCapabilitiesSchema = z.object({
  schema: z.literal("mcp.capabilities.v1"),
  server: z.object({
    name: z.literal(HIVE_RUNNER_MCP_SERVER_NAME),
    version: z.literal(HIVE_RUNNER_MCP_SERVER_VERSION),
    transport: z.literal(HIVE_RUNNER_MCP_TRANSPORT),
  }),
  company: z.object({
    id: z.string(),
    slug: z.string(),
    code: z.string(),
    name: z.string(),
  }),
  registry: z.object({
    resources: z.object({
      count: z.number().int().nonnegative(),
      names: z.array(z.string()),
      capabilitiesUri: z.string(),
    }),
    tools: z.object({
      count: z.number().int().nonnegative(),
      names: z.array(z.string()),
    }),
  }),
  boundaries: z.object({
    transport: z.literal("stdio_only"),
    hostedService: z.literal(false),
    stable3001Changed: z.literal(false),
    globalMcpConfigWrites: z.literal(false),
    runnerMcpConsumption: z.literal(false),
  }),
});

export const hiveRunnerMcpStartupErrorEnvelopeSchema = z.object({
  schema: z.literal("hiverunner.mcp.startup_error.v1"),
  code: z.string(),
  message: z.string(),
});

export type HiveRunnerMcpStartupErrorEnvelope = z.infer<
  typeof hiveRunnerMcpStartupErrorEnvelopeSchema
>;
