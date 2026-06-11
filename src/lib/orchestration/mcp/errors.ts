import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
  hiveRunnerMcpStartupErrorEnvelopeSchema,
  type HiveRunnerMcpStartupErrorEnvelope,
} from "@/lib/orchestration/mcp/schemas";

export type HiveRunnerMcpStartupErrorCode =
  | "missing_company"
  | "company_not_found"
  | "invalid_arguments"
  | "startup_failed";

export class HiveRunnerMcpStartupError extends Error {
  code: HiveRunnerMcpStartupErrorCode;

  constructor(code: HiveRunnerMcpStartupErrorCode, message: string) {
    super(message);
    this.name = "HiveRunnerMcpStartupError";
    this.code = code;
  }
}

export function buildMcpStartupErrorEnvelope(error: unknown): HiveRunnerMcpStartupErrorEnvelope {
  if (error instanceof HiveRunnerMcpStartupError) {
    return hiveRunnerMcpStartupErrorEnvelopeSchema.parse({
      schema: "hiverunner.mcp.startup_error.v1",
      code: error.code,
      message: error.message,
    });
  }

  return hiveRunnerMcpStartupErrorEnvelopeSchema.parse({
    schema: "hiverunner.mcp.startup_error.v1",
    code: "startup_failed",
    message: error instanceof Error ? error.message : String(error),
  });
}

export function mcpToolUnavailableResult(toolName: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            schema: "mcp.tool.error.v1",
            code: "tool_not_implemented",
            message: `${toolName} is registered by the local scaffold; governed write behavior is not implemented in this scaffold.`,
          },
          null,
          2,
        ),
      },
    ],
  };
}
