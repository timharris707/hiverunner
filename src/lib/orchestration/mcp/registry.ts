export const HIVE_RUNNER_MCP_SERVER_NAME = "hiverunner";
export const HIVE_RUNNER_MCP_SERVER_VERSION = "1.0.0";
export const HIVE_RUNNER_MCP_TRANSPORT = "stdio";

type HiveRunnerMcpResourceDefinition = {
  name: string;
  title: string;
  description: string;
  uriTemplate: string;
  schema: string;
};

type HiveRunnerMcpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchemaName: string;
  outputSchemaName: string;
  governance: "append_only" | "approval_request";
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
};

export const HIVE_RUNNER_MCP_PUBLIC_RESOURCE_DEFINITIONS = [
  {
    name: "hiverunner.goals.list",
    title: "HiveRunner Goals",
    description: "List goals and sprint planning context for the launch company.",
    uriTemplate: "hiverunner://{cc}/goals",
    schema: "mcp.goals.v1",
  },
  {
    name: "hiverunner.tasks.list",
    title: "HiveRunner Tasks",
    description: "List tasks for the launch company.",
    uriTemplate: "hiverunner://{cc}/tasks",
    schema: "mcp.tasks.v1",
  },
  {
    name: "hiverunner.task.read",
    title: "HiveRunner Task",
    description: "Read one task by task key.",
    uriTemplate: "hiverunner://{cc}/tasks/{taskKey}",
    schema: "mcp.task.v1",
  },
  {
    name: "hiverunner.trace.read",
    title: "HiveRunner Run Trace",
    description: "Read a redacted run trace view.",
    uriTemplate: "hiverunner://{cc}/runs/{runId}/trace",
    schema: "hiverunner.run_trace_view.v1",
  },
  {
    name: "hiverunner.trace.export",
    title: "HiveRunner Run Trace Export",
    description: "Read a redacted run trace export.",
    uriTemplate: "hiverunner://{cc}/runs/{runId}/trace/export",
    schema: "hiverunner.run_trace_redacted_export.v1",
  },
  {
    name: "hiverunner.evals.list",
    title: "HiveRunner Eval Cases",
    description: "List eval cases for the launch company.",
    uriTemplate: "hiverunner://{cc}/eval-cases",
    schema: "mcp.eval_cases.v1",
  },
  {
    name: "hiverunner.eval.read",
    title: "HiveRunner Eval Case",
    description: "Read one eval case by id.",
    uriTemplate: "hiverunner://{cc}/eval-cases/{caseId}",
    schema: "mcp.eval_case.v1",
  },
  {
    name: "hiverunner.experiment_reports.list",
    title: "HiveRunner Experiment Reports",
    description: "List redacted experiment comparison reports for the launch company.",
    uriTemplate: "hiverunner://{cc}/experiment-reports",
    schema: "mcp.experiment_reports.v1",
  },
  {
    name: "hiverunner.experiment_report.read",
    title: "HiveRunner Experiment Report",
    description: "Read one redacted experiment comparison report by id.",
    uriTemplate: "hiverunner://{cc}/experiment-reports/{reportId}",
    schema: "mcp.experiment_report.v1",
  },
  {
    name: "hiverunner.improve.list",
    title: "HiveRunner Improve Queue",
    description: "List improvement recommendations for the launch company.",
    uriTemplate: "hiverunner://{cc}/improve",
    schema: "mcp.improve.v1",
  },
  {
    name: "hiverunner.improve.read",
    title: "HiveRunner Improvement Recommendation",
    description: "Read one improvement recommendation by id.",
    uriTemplate: "hiverunner://{cc}/improve/{recId}",
    schema: "mcp.improvement.v1",
  },
  {
    name: "hiverunner.team.list",
    title: "HiveRunner Team",
    description: "List company agents and readiness context.",
    uriTemplate: "hiverunner://{cc}/team",
    schema: "mcp.team.v1",
  },
  {
    name: "hiverunner.team.bench",
    title: "HiveRunner Bench",
    description: "List bench agents for the launch company.",
    uriTemplate: "hiverunner://{cc}/team/bench",
    schema: "mcp.team.v1",
  },
  {
    name: "hiverunner.templates.list",
    title: "HiveRunner Starter Templates",
    description: "List built-in starter sprint templates.",
    uriTemplate: "hiverunner://{cc}/templates",
    schema: "mcp.templates.v1",
  },
  {
    name: "hiverunner.template.read",
    title: "HiveRunner Starter Template",
    description: "Read one starter sprint template by version id.",
    uriTemplate: "hiverunner://{cc}/templates/{templateVersionId}",
    schema: "mcp.template.v1",
  },
] as const satisfies readonly HiveRunnerMcpResourceDefinition[];

export const HIVE_RUNNER_MCP_CAPABILITIES_RESOURCE = {
  name: "hiverunner.mcp.capabilities",
  title: "HiveRunner MCP Capabilities",
  description: "Connection-state and registry summary for the local MCP process.",
  uriTemplate: "hiverunner://{cc}/mcp/capabilities",
  schema: "mcp.capabilities.v1",
} as const satisfies HiveRunnerMcpResourceDefinition;

const companyCodeProperty = {
  type: "string",
  description: "Company code, slug, or id. Defaults to the launch company when omitted.",
};

export const HIVE_RUNNER_MCP_TOOL_DEFINITIONS = [
  {
    name: "hiverunner.eval.save_case",
    title: "Save Eval Case",
    description: "Append a redacted review-backed eval case.",
    inputSchemaName: "mcp.tool.save_eval_case.input.v1",
    outputSchemaName: "mcp.tool.save_eval_case.output.v1",
    governance: "append_only",
    inputSchema: {
      type: "object",
      properties: {
        companyCode: companyCodeProperty,
        projectId: { type: "string" },
        sourceTask: { type: "object" },
        sourceRun: { type: "object" },
        review: { type: "object" },
        captureQuality: { type: "string", enum: ["complete", "partial", "minimal", "failed"] },
        evidenceGaps: { type: "array" },
        redactedSnapshot: { type: "object" },
        idempotencyKey: { type: "string" },
      },
      required: ["sourceTask", "sourceRun", "review", "captureQuality", "redactedSnapshot"],
      additionalProperties: true,
    },
  },
  {
    name: "hiverunner.evidence.attach",
    title: "Attach Evidence",
    description: "Append redacted evidence summaries to an eval case or improvement recommendation.",
    inputSchemaName: "mcp.tool.attach_evidence.input.v1",
    outputSchemaName: "mcp.tool.attach_evidence.output.v1",
    governance: "append_only",
    inputSchema: {
      type: "object",
      properties: {
        companyCode: companyCodeProperty,
        target: { type: "object" },
        evidence: { type: "array" },
      },
      required: ["target", "evidence"],
      additionalProperties: true,
    },
  },
  {
    name: "hiverunner.improve.create_recommendation",
    title: "Create Improvement Recommendation",
    description: "Append a suggested improvement recommendation without changing runtime behavior.",
    inputSchemaName: "mcp.tool.create_recommendation.input.v1",
    outputSchemaName: "mcp.tool.create_recommendation.output.v1",
    governance: "append_only",
    inputSchema: {
      type: "object",
      properties: {
        companyCode: companyCodeProperty,
        triggerClass: { type: "string" },
        triggerKey: { type: "string" },
        scope: { type: "object" },
        title: { type: "string" },
        rationale: { type: "string" },
        proposedChange: { type: "string" },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        evidence: { type: "array" },
        idempotencyKey: { type: "string" },
      },
      required: ["scope", "title"],
      additionalProperties: true,
    },
  },
  {
    name: "hiverunner.approval.request",
    title: "Request Approval",
    description: "Create a pending approval request through existing HiveRunner governance.",
    inputSchemaName: "mcp.tool.request_approval.input.v1",
    outputSchemaName: "mcp.tool.request_approval.output.v1",
    governance: "approval_request",
    inputSchema: {
      type: "object",
      properties: {
        companyCode: companyCodeProperty,
        type: {
          type: "string",
          enum: [
            "hire_agent",
            "approve_ceo_strategy",
            "budget_override_required",
            "provider_switch",
            "protected_runtime_command",
          ],
        },
        payload: { type: "object" },
        linkedTaskId: { type: "string" },
        linkedTaskKey: { type: "string" },
        recommendationIds: { type: "array" },
        riskNotes: { type: "string" },
        rollbackNotes: { type: "string" },
      },
      required: ["type"],
      additionalProperties: true,
    },
  },
] as const satisfies readonly HiveRunnerMcpToolDefinition[];

export type HiveRunnerMcpPublicResourceName =
  (typeof HIVE_RUNNER_MCP_PUBLIC_RESOURCE_DEFINITIONS)[number]["name"];

export type HiveRunnerMcpToolName = (typeof HIVE_RUNNER_MCP_TOOL_DEFINITIONS)[number]["name"];

export function normalizeMcpCompanyCode(companyCode: string): string {
  return companyCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 8) || "HIVE";
}

export function materializeMcpUri(uriTemplate: string, companyCode: string): string {
  return uriTemplate.replace("{cc}", encodeURIComponent(normalizeMcpCompanyCode(companyCode)));
}

export function listHiveRunnerMcpResourceNames(): string[] {
  return HIVE_RUNNER_MCP_PUBLIC_RESOURCE_DEFINITIONS.map((resource) => resource.name);
}

export function listHiveRunnerMcpToolNames(): string[] {
  return HIVE_RUNNER_MCP_TOOL_DEFINITIONS.map((tool) => tool.name);
}
