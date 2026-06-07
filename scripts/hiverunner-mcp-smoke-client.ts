#!/usr/bin/env node
import { runHiveRunnerMcpSmokeClient, type HiveRunnerMcpSmokeToolCall } from "@/lib/orchestration/mcp/smoke-client";

type ParsedArgs = {
  company: string;
  actorName?: string;
  transcriptPath?: string;
  readResourceUris: string[];
  toolCalls: HiveRunnerMcpSmokeToolCall[];
};

function usage(): string {
  return [
    "Usage: npm run mcp:smoke -- --company <company-code> [options]",
    "",
    "Options:",
    "  --company <value>       Company code, slug, or id. Defaults to HIVERUNNER_MCP_COMPANY.",
    "  --actor <value>         Actor label sent to the local MCP server.",
    "  --resource <uri>        Resource URI to read. May be repeated.",
    "  --tool-call <json>      Tool call JSON. May be repeated.",
    "  --transcript <path>     Write the compact smoke transcript to a file.",
    "  --help                 Show this help.",
    "",
    "Tool call JSON shape:",
    '  {"label":"optional","name":"hiverunner.approval.request","arguments":{"type":"approve_ceo_strategy"}}',
  ].join("\n");
}

function readFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredStringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`--tool-call JSON must include a non-empty ${field}`);
  }
  return value;
}

function parseToolCall(raw: string): HiveRunnerMcpSmokeToolCall {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("--tool-call JSON must be an object");
  }
  if (parsed.arguments !== undefined && !isRecord(parsed.arguments)) {
    throw new Error("--tool-call arguments must be an object when provided");
  }

  return {
    label: typeof parsed.label === "string" ? parsed.label : undefined,
    name: requiredStringField(parsed, "name"),
    arguments: parsed.arguments,
  };
}

const valueFlagHandlers: Record<string, (parsed: ParsedArgs, value: string) => void> = {
  "--company": (parsed, value) => {
    parsed.company = value;
  },
  "--actor": (parsed, value) => {
    parsed.actorName = value;
  },
  "--resource": (parsed, value) => {
    parsed.readResourceUris.push(value);
  },
  "--tool-call": (parsed, value) => {
    parsed.toolCalls.push(parseToolCall(value));
  },
  "--transcript": (parsed, value) => {
    parsed.transcriptPath = value;
  },
};

function initialParsedArgs(env = process.env): ParsedArgs {
  return {
    company: env.HIVERUNNER_MCP_COMPANY ?? "",
    actorName: env.HIVERUNNER_MCP_ACTOR,
    readResourceUris: [],
    toolCalls: [],
  };
}

function applyArg(parsed: ParsedArgs, argv: string[], index: number): number {
  const arg = argv[index];
  if (arg === "--help" || arg === "-h") {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const handler = valueFlagHandlers[arg];
  if (!handler) throw new Error(`Unknown argument: ${arg}`);
  handler(parsed, readFlagValue(argv, index, arg));
  return index + 1;
}

function validateParsedArgs(parsed: ParsedArgs): void {
  if (!parsed.company.trim()) {
    throw new Error("--company <company-code-or-slug> or HIVERUNNER_MCP_COMPANY is required");
  }
}

function applyDefaultResource(parsed: ParsedArgs): void {
  if (parsed.readResourceUris.length === 0) {
    parsed.readResourceUris.push(`hiverunner://${parsed.company}/mcp/capabilities`);
  }
}

function parseArgs(argv: string[], env = process.env): ParsedArgs {
  const parsed = initialParsedArgs(env);
  for (let index = 0; index < argv.length; index += 1) {
    index = applyArg(parsed, argv, index);
  }
  validateParsedArgs(parsed);
  applyDefaultResource(parsed);
  return parsed;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runHiveRunnerMcpSmokeClient({
    company: options.company,
    actorName: options.actorName,
    readResourceUris: options.readResourceUris,
    toolCalls: options.toolCalls,
    transcriptPath: options.transcriptPath,
  });
  process.stdout.write(`${JSON.stringify(result.transcript, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
