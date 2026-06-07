import type { McpRequestContext } from "@/lib/orchestration/mcp/context";
import { hiveRunnerMcpCapabilitiesSchema } from "@/lib/orchestration/mcp/schemas";
import {
  HIVE_RUNNER_MCP_CAPABILITIES_RESOURCE,
  HIVE_RUNNER_MCP_PUBLIC_RESOURCE_DEFINITIONS,
  HIVE_RUNNER_MCP_SERVER_NAME,
  HIVE_RUNNER_MCP_SERVER_VERSION,
  HIVE_RUNNER_MCP_TOOL_DEFINITIONS,
  HIVE_RUNNER_MCP_TRANSPORT,
  listHiveRunnerMcpResourceNames,
  listHiveRunnerMcpToolNames,
  materializeMcpUri,
} from "@/lib/orchestration/mcp/registry";

export function buildHiveRunnerMcpCapabilities(context: McpRequestContext) {
  return hiveRunnerMcpCapabilitiesSchema.parse({
    schema: "mcp.capabilities.v1",
    server: {
      name: HIVE_RUNNER_MCP_SERVER_NAME,
      version: HIVE_RUNNER_MCP_SERVER_VERSION,
      transport: HIVE_RUNNER_MCP_TRANSPORT,
    },
    company: {
      id: context.companyId,
      slug: context.companySlug,
      code: context.companyCode,
      name: context.companyName,
    },
    registry: {
      resources: {
        count: HIVE_RUNNER_MCP_PUBLIC_RESOURCE_DEFINITIONS.length,
        names: listHiveRunnerMcpResourceNames(),
        capabilitiesUri: materializeMcpUri(
          HIVE_RUNNER_MCP_CAPABILITIES_RESOURCE.uriTemplate,
          context.companyCode,
        ),
      },
      tools: {
        count: HIVE_RUNNER_MCP_TOOL_DEFINITIONS.length,
        names: listHiveRunnerMcpToolNames(),
      },
    },
    boundaries: {
      transport: "stdio_only",
      hostedService: false,
      stable3001Changed: false,
      globalMcpConfigWrites: false,
      runnerMcpConsumption: false,
    },
  });
}
