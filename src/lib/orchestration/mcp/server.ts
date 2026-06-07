import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type ListResourcesResult,
  type ListToolsResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";

import type { McpRequestContext } from "@/lib/orchestration/mcp/context";
import { buildHiveRunnerMcpCapabilities } from "@/lib/orchestration/mcp/resources/capabilities";
import { readHiveRunnerMcpResource } from "@/lib/orchestration/mcp/resources/readers";
import { executeGovernedMcpTool } from "@/lib/orchestration/mcp/tools/governed";
import {
  HIVE_RUNNER_MCP_CAPABILITIES_RESOURCE,
  HIVE_RUNNER_MCP_PUBLIC_RESOURCE_DEFINITIONS,
  HIVE_RUNNER_MCP_SERVER_NAME,
  HIVE_RUNNER_MCP_SERVER_VERSION,
  HIVE_RUNNER_MCP_TOOL_DEFINITIONS,
  type HiveRunnerMcpPublicResourceName,
  type HiveRunnerMcpToolName,
  materializeMcpUri,
} from "@/lib/orchestration/mcp/registry";

type ResourceReader = (input: {
  uri: string;
  definitionName: HiveRunnerMcpPublicResourceName;
  context: McpRequestContext;
}) => ReadResourceResult | Promise<ReadResourceResult>;

type ToolHandler = (input: {
  name: HiveRunnerMcpToolName;
  args: Record<string, unknown>;
  context: McpRequestContext;
}) => CallToolResult | Promise<CallToolResult>;

export type CreateHiveRunnerMcpServerInput = {
  context: McpRequestContext;
  resourceReaders?: Partial<Record<HiveRunnerMcpPublicResourceName, ResourceReader>>;
  toolHandlers?: Partial<Record<HiveRunnerMcpToolName, ToolHandler>>;
};

function jsonResource(uri: string, payload: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function concreteResourceUri(definition: { uriTemplate: string }, companyCode: string): string {
  return materializeMcpUri(definition.uriTemplate, companyCode);
}

function resourceUriPattern(definition: { uriTemplate: string }, companyCode: string): RegExp {
  const escaped = concreteResourceUri(definition, companyCode).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withVariables = escaped.replace(/\\\{[A-Za-z0-9_]+\\\}/g, "[^/]+");
  return new RegExp(`^${withVariables}$`);
}

function listResources(context: McpRequestContext): ListResourcesResult {
  return {
    resources: HIVE_RUNNER_MCP_PUBLIC_RESOURCE_DEFINITIONS.map((resource) => ({
      name: resource.name,
      title: resource.title,
      description: resource.description,
      uri: concreteResourceUri(resource, context.companyCode),
      mimeType: "application/json",
      _meta: {
        schema: resource.schema,
      },
    })),
  };
}

function listTools(): ListToolsResult {
  return {
    tools: HIVE_RUNNER_MCP_TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: tool.governance === "approval_request",
      },
      _meta: {
        inputSchemaName: tool.inputSchemaName,
        outputSchemaName: tool.outputSchemaName,
        governance: tool.governance,
      },
    })),
  };
}

function readRegisteredResource(
  uri: string,
  context: McpRequestContext,
  readers: Partial<Record<HiveRunnerMcpPublicResourceName, ResourceReader>>,
): ReadResourceResult | Promise<ReadResourceResult> {
  const capabilitiesUri = materializeMcpUri(
    HIVE_RUNNER_MCP_CAPABILITIES_RESOURCE.uriTemplate,
    context.companyCode,
  );
  if (uri === capabilitiesUri) {
    return jsonResource(uri, buildHiveRunnerMcpCapabilities(context));
  }

  for (const definition of HIVE_RUNNER_MCP_PUBLIC_RESOURCE_DEFINITIONS) {
    if (!resourceUriPattern(definition, context.companyCode).test(uri)) continue;
    const name = definition.name;
    const reader = readers[name];
    if (reader) return reader({ uri, definitionName: name, context });
    return readHiveRunnerMcpResource({ uri, definitionName: name, context });
  }

  throw new Error(`resource_not_found: ${uri}`);
}

function callRegisteredTool(
  name: string,
  args: Record<string, unknown>,
  context: McpRequestContext,
  handlers: Partial<Record<HiveRunnerMcpToolName, ToolHandler>>,
): CallToolResult | Promise<CallToolResult> {
  const definition = HIVE_RUNNER_MCP_TOOL_DEFINITIONS.find((tool) => tool.name === name);
  if (!definition) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              schema: "mcp.tool.error.v1",
              code: "tool_not_found",
              message: `Unknown HiveRunner MCP tool: ${name}`,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const toolName = definition.name;
  const handler = handlers[toolName];
  if (handler) return handler({ name: toolName, args, context });
  return executeGovernedMcpTool({ name: toolName, args, context });
}

export function createHiveRunnerMcpServer(input: CreateHiveRunnerMcpServerInput): McpServer {
  const server = new McpServer(
    {
      name: HIVE_RUNNER_MCP_SERVER_NAME,
      version: HIVE_RUNNER_MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
      instructions:
        "HiveRunner local MCP exposes the agent-work control plane over stdio. Reads are redacted by service code; governed writes must route through HiveRunner approval rules.",
    },
  );

  server.server.setRequestHandler(ListResourcesRequestSchema, () => listResources(input.context));
  server.server.setRequestHandler(ReadResourceRequestSchema, (request) =>
    readRegisteredResource(request.params.uri, input.context, input.resourceReaders ?? {}),
  );
  server.server.setRequestHandler(ListToolsRequestSchema, () => listTools());
  server.server.setRequestHandler(CallToolRequestSchema, (request) => {
    const args =
      request.params.arguments && typeof request.params.arguments === "object"
        ? request.params.arguments
        : {};
    return callRegisteredTool(request.params.name, args, input.context, input.toolHandlers ?? {});
  });

  return server;
}

export function buildHiveRunnerMcpCapabilitiesResourceUri(context: McpRequestContext): string {
  return materializeMcpUri(HIVE_RUNNER_MCP_CAPABILITIES_RESOURCE.uriTemplate, context.companyCode);
}
