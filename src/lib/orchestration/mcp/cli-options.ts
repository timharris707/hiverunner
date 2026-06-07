import { HiveRunnerMcpStartupError } from "@/lib/orchestration/mcp/errors";

export type HiveRunnerMcpLaunchOptions = {
  company: string;
  actorName?: string;
};

type ParsedCliOption = {
  key: "company" | "actorName";
  value?: string;
};

const HELP_FLAGS = new Set(["--help", "-h"]);
const OPTION_KEYS: Record<string, ParsedCliOption["key"] | undefined> = {
  "--company": "company",
  "--actor": "actorName",
};

function parseCliOption(arg: string): ParsedCliOption {
  if (HELP_FLAGS.has(arg)) {
    throw new HiveRunnerMcpStartupError("invalid_arguments", usageText());
  }

  const equalsIndex = arg.indexOf("=");
  const flag = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
  const key = OPTION_KEYS[flag];
  if (!key) {
    throw new HiveRunnerMcpStartupError("invalid_arguments", `Unknown HiveRunner MCP argument: ${arg}`);
  }

  return {
    key,
    value: equalsIndex >= 0 ? arg.slice(equalsIndex + 1) : undefined,
  };
}

function readCliOptionValue(
  option: ParsedCliOption,
  argv: readonly string[],
  index: number,
): { value: string; consumed: number } {
  if (option.value !== undefined) {
    return { value: option.value, consumed: 0 };
  }

  return { value: argv[index + 1] ?? "", consumed: 1 };
}

function assertLaunchCompany(company: string): void {
  if (company.trim()) return;
  throw new HiveRunnerMcpStartupError(
    "missing_company",
    "Start the HiveRunner MCP server with --company <company-code-or-slug> or HIVERUNNER_MCP_COMPANY.",
  );
}

function launchOptionsFromEnv(env: NodeJS.ProcessEnv): Required<HiveRunnerMcpLaunchOptions> {
  return {
    company: env.HIVERUNNER_MCP_COMPANY ?? env.MC_MCP_COMPANY ?? "",
    actorName: env.HIVERUNNER_MCP_ACTOR ?? "",
  };
}

function applyCliOption(
  options: Required<HiveRunnerMcpLaunchOptions>,
  option: ParsedCliOption,
  value: string,
): Required<HiveRunnerMcpLaunchOptions> {
  return {
    ...options,
    [option.key]: value,
  };
}

function applyCliOptions(
  argv: readonly string[],
  initialOptions: Required<HiveRunnerMcpLaunchOptions>,
): Required<HiveRunnerMcpLaunchOptions> {
  let options = initialOptions;

  for (let i = 0; i < argv.length; i += 1) {
    const option = parseCliOption(argv[i] ?? "");
    const parsedValue = readCliOptionValue(option, argv, i);
    options = applyCliOption(options, option, parsedValue.value);
    i += parsedValue.consumed;
  }

  return options;
}

export function parseHiveRunnerMcpLaunchOptions(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): HiveRunnerMcpLaunchOptions {
  const options = applyCliOptions(argv, launchOptionsFromEnv(env));
  assertLaunchCompany(options.company);

  return {
    company: options.company,
    actorName: options.actorName.trim() || undefined,
  };
}

function usageText(): string {
  return [
    "Usage: npm run mcp:local -- --company <company-code-or-slug>",
    "",
    "Environment alternative:",
    "  HIVERUNNER_MCP_COMPANY=INS npm run mcp:local",
    "",
    "This process speaks MCP over stdio only and does not write global MCP client configuration.",
  ].join("\n");
}
