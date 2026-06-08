import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  CallToolResult,
  ListResourcesResult,
  ListToolsResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";

import { HIVE_RUNNER_MCP_SERVER_NAME } from "@/lib/orchestration/mcp/registry";

export type HiveRunnerMcpSmokeToolCall = {
  label?: string;
  name: string;
  arguments?: Record<string, unknown>;
};

export type HiveRunnerMcpSmokeClientInput = {
  company: string;
  actorName?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  readResourceUris?: string[];
  toolCalls?: HiveRunnerMcpSmokeToolCall[];
  transcriptPath?: string;
  command?: string;
  args?: string[];
};

export type HiveRunnerMcpSmokeOperation = {
  name: "initialize" | "resources/list" | "resources/read" | "tools/list" | "tools/call";
  ok: boolean;
  label?: string;
  uri?: string;
  tool?: string;
  error?: string;
  result?: Record<string, unknown>;
};

export type HiveRunnerMcpSmokeTranscript = {
  schema: "hiverunner.mcp.smoke_transcript.v1";
  generatedAt: string;
  company: string;
  server: {
    name: string | null;
    version: string | null;
  };
  operations: HiveRunnerMcpSmokeOperation[];
  summary: {
    resourceCount: number;
    toolCount: number;
    resourceReadCount: number;
    toolCallCount: number;
    successfulToolCallCount: number;
    errorToolCallCount: number;
    credentialFixturesPresent: boolean;
  };
};

export type HiveRunnerMcpSmokeClientResult = {
  transcript: HiveRunnerMcpSmokeTranscript;
  resources: ListResourcesResult;
  tools: ListToolsResult;
  resourcePayloads: Record<string, unknown>;
  toolPayloads: Record<string, unknown>;
};

const credentialFixturePatterns = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/i,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

function safeEnv(env: Record<string, string | undefined> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env ?? process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseJsonTextContent(result: ReadResourceResult | CallToolResult): {
  text: string;
  payload: unknown;
} {
  const content = "content" in result ? result.content : result.contents;
  const first = Array.isArray(content) ? content[0] : undefined;
  if (!first || !("text" in first) || typeof first.text !== "string") {
    return { text: "", payload: null };
  }

  try {
    return { text: first.text, payload: JSON.parse(first.text) };
  } catch {
    return { text: first.text, payload: null };
  }
}

function payloadSchema(payload: unknown): string | null {
  return payload && typeof payload === "object" && typeof (payload as { schema?: unknown }).schema === "string"
    ? (payload as { schema: string }).schema
    : null;
}

function safeResourceSummary(uri: string, text: string, payload: unknown): Record<string, unknown> {
  const serialized = JSON.stringify(payload ?? null);
  const credentialFixturesPresent = credentialFixturePatterns.some((pattern) => pattern.test(serialized));
  return {
    uri,
    schema: payloadSchema(payload),
    textSha256: sha256(text),
    byteLength: Buffer.byteLength(text),
    credentialFixturesPresent,
    count: payload && typeof payload === "object" && "count" in payload
      ? (payload as { count?: unknown }).count
      : undefined,
    total: payload && typeof payload === "object" && "total" in payload
      ? (payload as { total?: unknown }).total
      : undefined,
    redactionPolicy: payload && typeof payload === "object"
      ? (payload as { redaction?: { policy?: unknown } }).redaction?.policy
      : undefined,
  };
}

function safeToolSummary(result: CallToolResult, payload: unknown): Record<string, unknown> {
  const objectPayload = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const governance = objectPayload.governance && typeof objectPayload.governance === "object"
    ? objectPayload.governance as Record<string, unknown>
    : undefined;

  return {
    isError: result.isError === true,
    schema: payloadSchema(payload),
    code: typeof objectPayload.code === "string" ? objectPayload.code : undefined,
    status: typeof objectPayload.status === "string" ? objectPayload.status : undefined,
    recommendationId: typeof objectPayload.recommendationId === "string" ? objectPayload.recommendationId : undefined,
    evidenceSetId: typeof objectPayload.evidenceSetId === "string" ? objectPayload.evidenceSetId : undefined,
    approvalId: typeof objectPayload.approvalId === "string" ? objectPayload.approvalId : undefined,
    governance,
  };
}

function defaultServerArgs(company: string, actorName: string): string[] {
  return [
    "--silent",
    "run",
    "mcp:local",
    "--",
    "--company",
    company,
    "--actor",
    actorName,
  ];
}

export async function runHiveRunnerMcpSmokeClient(
  input: HiveRunnerMcpSmokeClientInput,
): Promise<HiveRunnerMcpSmokeClientResult> {
  const actorName = input.actorName?.trim() || "HiveRunner MCP smoke client";
  const client = new Client({ name: "hiverunner-mcp-smoke-client", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: input.command ?? "npm",
    args: input.args ?? defaultServerArgs(input.company, actorName),
    cwd: input.cwd ?? process.cwd(),
    env: safeEnv(input.env),
    stderr: "pipe",
  });

  const operations: HiveRunnerMcpSmokeOperation[] = [];
  const resourcePayloads: Record<string, unknown> = {};
  const toolPayloads: Record<string, unknown> = {};
  let resources: ListResourcesResult = { resources: [] };
  let tools: ListToolsResult = { tools: [] };
  let connectedServerVersion: { name?: string; version?: string } | undefined;

  try {
    await client.connect(transport);
    const serverVersion = client.getServerVersion();
    connectedServerVersion = serverVersion;
    operations.push({
      name: "initialize",
      ok: serverVersion?.name === HIVE_RUNNER_MCP_SERVER_NAME,
      result: {
        server: serverVersion,
      },
    });

    resources = await client.listResources();
    operations.push({
      name: "resources/list",
      ok: true,
      result: {
        count: resources.resources.length,
        names: resources.resources.map((resource) => resource.name),
      },
    });

    for (const uri of input.readResourceUris ?? []) {
      try {
        const result = await client.readResource({ uri });
        const parsed = parseJsonTextContent(result);
        resourcePayloads[uri] = parsed.payload;
        operations.push({
          name: "resources/read",
          ok: true,
          uri,
          result: safeResourceSummary(uri, parsed.text, parsed.payload),
        });
      } catch (error) {
        operations.push({
          name: "resources/read",
          ok: false,
          uri,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    tools = await client.listTools();
    operations.push({
      name: "tools/list",
      ok: true,
      result: {
        count: tools.tools.length,
        names: tools.tools.map((tool) => tool.name),
        governance: tools.tools.map((tool) => ({
          name: tool.name,
          governance: tool._meta?.governance,
        })),
      },
    });

    for (const call of input.toolCalls ?? []) {
      try {
        const result = await client.callTool({
          name: call.name,
          arguments: call.arguments ?? {},
        });
        const parsed = parseJsonTextContent(result as CallToolResult);
        const key = call.label ?? call.name;
        toolPayloads[key] = parsed.payload;
        operations.push({
          name: "tools/call",
          ok: result.isError !== true,
          label: call.label,
          tool: call.name,
          result: safeToolSummary(result as CallToolResult, parsed.payload),
        });
      } catch (error) {
        operations.push({
          name: "tools/call",
          ok: false,
          label: call.label,
          tool: call.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await client.close().catch(() => undefined);
  }

  const resourceReadOperations = operations.filter((operation) => operation.name === "resources/read");
  const toolCallOperations = operations.filter((operation) => operation.name === "tools/call");
  const transcript: HiveRunnerMcpSmokeTranscript = {
    schema: "hiverunner.mcp.smoke_transcript.v1",
    generatedAt: new Date().toISOString(),
    company: input.company,
    server: {
      name: connectedServerVersion?.name ?? null,
      version: connectedServerVersion?.version ?? null,
    },
    operations,
    summary: {
      resourceCount: resources.resources.length,
      toolCount: tools.tools.length,
      resourceReadCount: resourceReadOperations.filter((operation) => operation.ok).length,
      toolCallCount: toolCallOperations.length,
      successfulToolCallCount: toolCallOperations.filter((operation) => operation.ok).length,
      errorToolCallCount: toolCallOperations.filter((operation) => !operation.ok).length,
      credentialFixturesPresent: operations.some((operation) =>
        JSON.stringify(operation.result ?? {}).includes("credentialFixturesPresent\":true"),
      ),
    },
  };

  if (input.transcriptPath) {
    mkdirSync(path.dirname(input.transcriptPath), { recursive: true });
    writeFileSync(input.transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`);
  }

  return {
    transcript,
    resources,
    tools,
    resourcePayloads,
    toolPayloads,
  };
}
