import type { HiveRunnerSymphonyTrackerOptions } from "./tracker-adapter";
import { createHiveRunnerSymphonyTracker } from "./tracker-adapter";

export type HiveRunnerSymphonyTrackerOperation =
  | "health"
  | "fetch_candidate_issues"
  | "fetch_issues_by_states"
  | "fetch_issue_states_by_ids"
  | "create_comment"
  | "update_issue_state";

export type HiveRunnerSymphonyTrackerRequest = {
  operation: HiveRunnerSymphonyTrackerOperation;
  options?: Partial<HiveRunnerSymphonyTrackerOptions>;
  stateNames?: string[];
  issueIds?: string[];
  issueId?: string;
  body?: string;
  stateName?: string;
};

export type HiveRunnerSymphonyTrackerResponse =
  | {
      ok: true;
      operation: HiveRunnerSymphonyTrackerOperation;
      result: unknown;
    }
  | {
      ok: false;
      operation?: HiveRunnerSymphonyTrackerOperation;
      error: {
        code: string;
        message: string;
      };
    };

type EnvLike = Record<string, string | undefined>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function operationValue(value: unknown): HiveRunnerSymphonyTrackerOperation | undefined {
  switch (value) {
    case "health":
    case "fetch_candidate_issues":
    case "fetch_issues_by_states":
    case "fetch_issue_states_by_ids":
    case "create_comment":
    case "update_issue_state":
      return value;
    default:
      return undefined;
  }
}

function parseOptions(value: unknown): Partial<HiveRunnerSymphonyTrackerOptions> {
  if (!isRecord(value)) return {};
  const executionEngine = value.executionEngine;
  return {
    ...(stringValue(value.companyIdOrSlug) ? { companyIdOrSlug: stringValue(value.companyIdOrSlug) } : {}),
    ...(stringValue(value.projectIdOrSlug) ? { projectIdOrSlug: stringValue(value.projectIdOrSlug) } : {}),
    ...(stringArrayValue(value.activeStates) ? { activeStates: stringArrayValue(value.activeStates) } : {}),
    ...(stringArrayValue(value.terminalStates) ? { terminalStates: stringArrayValue(value.terminalStates) } : {}),
    ...(executionEngine === "hiverunner" || executionEngine === "symphony" || executionEngine === "manual" || executionEngine === "any"
      ? { executionEngine }
      : {}),
    ...(stringArrayValue(value.workerAgentIds) ? { workerAgentIds: stringArrayValue(value.workerAgentIds) } : {}),
    ...(stringValue(value.appBaseUrl) ? { appBaseUrl: stringValue(value.appBaseUrl) } : {}),
    ...(stringValue(value.actorUserId) ? { actorUserId: stringValue(value.actorUserId) } : {}),
  };
}

function parseRequest(raw: unknown): HiveRunnerSymphonyTrackerRequest {
  if (!isRecord(raw)) {
    throw new Error("Tracker request must be a JSON object.");
  }
  const operation = operationValue(raw.operation);
  if (!operation) {
    throw new Error("Tracker request operation is missing or unsupported.");
  }
  return {
    operation,
    options: parseOptions(raw.options),
    stateNames: stringArrayValue(raw.stateNames),
    issueIds: stringArrayValue(raw.issueIds),
    issueId: stringValue(raw.issueId),
    body: typeof raw.body === "string" ? raw.body : undefined,
    stateName: stringValue(raw.stateName),
  };
}

function enabled(env: EnvLike): boolean {
  return env.HIVERUNNER_SYMPHONY_TRACKER_ENABLED === "1";
}

function requireEnabled(operation: HiveRunnerSymphonyTrackerOperation, env: EnvLike): void {
  if (operation === "health") return;
  if (!enabled(env)) {
    throw new Error("HiveRunner external runner tracker shim is disabled. Set HIVERUNNER_SYMPHONY_TRACKER_ENABLED=1 to enable.");
  }
}

function requireOptions(options: Partial<HiveRunnerSymphonyTrackerOptions> | undefined): HiveRunnerSymphonyTrackerOptions {
  if (!options?.companyIdOrSlug) {
    throw new Error("options.companyIdOrSlug is required.");
  }
  return {
    companyIdOrSlug: options.companyIdOrSlug,
    projectIdOrSlug: options.projectIdOrSlug,
    activeStates: options.activeStates,
    terminalStates: options.terminalStates,
    executionEngine: options.executionEngine,
    workerAgentIds: options.workerAgentIds,
    appBaseUrl: options.appBaseUrl,
    actorUserId: options.actorUserId,
  };
}

function errorResponse(
  error: unknown,
  operation?: HiveRunnerSymphonyTrackerOperation,
): HiveRunnerSymphonyTrackerResponse {
  return {
    ok: false,
    operation,
    error: {
      code: "tracker_shim_error",
      message: error instanceof Error && error.message ? error.message : String(error),
    },
  };
}

export function handleHiveRunnerSymphonyTrackerRequest(
  raw: unknown,
  env: EnvLike = process.env,
): HiveRunnerSymphonyTrackerResponse {
  let request: HiveRunnerSymphonyTrackerRequest | undefined;
  try {
    request = parseRequest(raw);
    requireEnabled(request.operation, env);

    if (request.operation === "health") {
      return {
        ok: true,
        operation: "health",
        result: {
          enabled: enabled(env),
          schema: "hiverunner.symphony.tracker.v1",
          operations: [
            "fetch_candidate_issues",
            "fetch_issues_by_states",
            "fetch_issue_states_by_ids",
            "create_comment",
            "update_issue_state",
          ],
        },
      };
    }

    const tracker = createHiveRunnerSymphonyTracker(requireOptions(request.options));
    switch (request.operation) {
      case "fetch_candidate_issues":
        return { ok: true, operation: request.operation, result: tracker.fetchCandidateIssues() };
      case "fetch_issues_by_states":
        return { ok: true, operation: request.operation, result: tracker.fetchIssuesByStates(request.stateNames ?? []) };
      case "fetch_issue_states_by_ids":
        return { ok: true, operation: request.operation, result: tracker.fetchIssueStatesByIds(request.issueIds ?? []) };
      case "create_comment":
        if (!request.issueId) throw new Error("issueId is required for create_comment.");
        if (request.body === undefined) throw new Error("body is required for create_comment.");
        return { ok: true, operation: request.operation, result: tracker.createComment(request.issueId, request.body) };
      case "update_issue_state":
        if (!request.issueId) throw new Error("issueId is required for update_issue_state.");
        if (!request.stateName) throw new Error("stateName is required for update_issue_state.");
        return { ok: true, operation: request.operation, result: tracker.updateIssueState(request.issueId, request.stateName) };
      default:
        request.operation satisfies never;
        throw new Error("Unsupported tracker operation.");
    }
  } catch (error) {
    return errorResponse(error, request?.operation);
  }
}
