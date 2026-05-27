export type CommentVisibilityInput = {
  source?: string | null;
  type?: string | null;
  text?: string | null;
};

export type OperationalStatusTag =
  | "REVIEW_WATCHDOG"
  | "AWAITING_HUMAN"
  | "CIRCUIT_BREAKER"
  | "ESCALATION"
  | "APPROVAL_BLOCKED"
  | "STUCK_AGENT_WATCHDOG"
  | "HARNESS_WARNING"
  | "CLI_FAILURE"
  | "OPERATIONAL";

const OPERATOR_FACING_COMMENT_TYPES = new Set(["comment", "review", "blocker", "imported_report"]);

export function getOperationalStatusTag(input: CommentVisibilityInput): OperationalStatusTag | null {
  const text = (input.text ?? "").trim();
  const source = (input.source ?? "").trim().toLowerCase();
  if (/^\[REVIEW_WATCHDOG\]/i.test(text)) return "REVIEW_WATCHDOG";
  if (/^\[AWAITING_HUMAN\]/i.test(text)) return "AWAITING_HUMAN";
  if (/^\[CIRCUIT_BREAKER\]/i.test(text) || /circuit breaker/i.test(text)) return "CIRCUIT_BREAKER";
  if (/^\[ESCALATION\]/i.test(text) || source === "escalation") return "ESCALATION";
  if (/^\[APPROVAL_BLOCKED\]/i.test(text) || /approval.*(blocked|required|pending)/i.test(text)) return "APPROVAL_BLOCKED";
  if (/^\[STUCK_AGENT_WATCHDOG\]/i.test(text)) return "STUCK_AGENT_WATCHDOG";
  if (/^\[HARNESS_WARNING\]/i.test(text)) return "HARNESS_WARNING";
  if (/^\[CLI_FAILURE\]/i.test(text)) return "CLI_FAILURE";
  if (source === "engine" || source === "mission_control") return "OPERATIONAL";
  return null;
}

function hasExecutionTelemetry(text: string): boolean {
  return /^([A-Z][A-Za-z]+|Codex|Anthropic|Gemini|Hermes|OpenClaw) execution (completed|failed|cancelled)\./i.test(text) &&
    (
      /\nCommand:\s/.test(text) ||
      /\nWorkspace:\s/.test(text) ||
      /\nWritable roots:\s/.test(text) ||
      /\nStdout:\s/.test(text) ||
      /\nStderr:\s/.test(text) ||
      /```mc-action\b/.test(text)
    );
}

function hasLinkVerificationNotice(text: string): boolean {
  return /^\*\*Link verification failed\*\*/.test(text) &&
    /withheld the sourced reply instead of posting bad URLs/i.test(text) &&
    /Unverified links:/i.test(text);
}

function hasAgentCoordinationMarker(text: string): boolean {
  return /^\[(AWAITING_CLARIFICATION|AWAITING_AGENT|NEEDS_REVISION|REVISION_REQUESTED|REVIEW_FEEDBACK|INTERNAL|SYSTEM)\]/i.test(text);
}

function hasReviewRoutingStatus(text: string): boolean {
  return /^(Sending back|Approved|Rejected|Revision requested)\b/i.test(text);
}

export function isOperatorFacingComment(input: CommentVisibilityInput): boolean {
  const text = (input.text ?? "").trim();
  if (!text) return false;

  if (
    hasExecutionTelemetry(text) ||
    hasLinkVerificationNotice(text) ||
    hasAgentCoordinationMarker(text) ||
    hasReviewRoutingStatus(text)
  ) {
    return false;
  }

  if (input.type && !OPERATOR_FACING_COMMENT_TYPES.has(input.type)) {
    return false;
  }

  if (input.source === "mission_control" || input.source === "engine") {
    return input.type === "blocker";
  }

  return true;
}

export function isOperationalStatusComment(input: CommentVisibilityInput): boolean {
  return Boolean(getOperationalStatusTag(input)) || !isOperatorFacingComment(input);
}
