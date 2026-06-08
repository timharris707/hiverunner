export const EXECUTION_FAILURE_CLASS = {
  queueStartTimeout: "queue_start_timeout",
  noOutputTimeout: "no_output_timeout",
  adapterTimeout: "adapter_timeout",
  operatorCancellation: "operator_cancellation",
  taskTransitionCancellation: "task_transition_cancellation",
  staleProcessMissing: "stale_process_missing",
  providerExit: "provider_exit",
  circuitBlocked: "circuit_blocked",
  deterministicPreflight: "deterministic_preflight",
  budgetThresholdBlocked: "budget_threshold_blocked",
  budgetOverrideRequired: "budget_override_required",
  protectedRuntimeApprovalRequired: "protected_runtime_approval_required",
  coalesced: "coalesced",
  bufferLimit: "buffer_limit",
} as const;

export type ExecutionFailureClass =
  typeof EXECUTION_FAILURE_CLASS[keyof typeof EXECUTION_FAILURE_CLASS];

const LEGACY_EXECUTION_FAILURE_CLASS_MAP: Record<string, ExecutionFailureClass> = {
  timeout: EXECUTION_FAILURE_CLASS.adapterTimeout,
  silent_timeout: EXECUTION_FAILURE_CLASS.noOutputTimeout,
  no_output_timeout: EXECUTION_FAILURE_CLASS.noOutputTimeout,
  adapter_timeout: EXECUTION_FAILURE_CLASS.adapterTimeout,
  cancelled: EXECUTION_FAILURE_CLASS.operatorCancellation,
  canceled: EXECUTION_FAILURE_CLASS.operatorCancellation,
  external_signal: EXECUTION_FAILURE_CLASS.providerExit,
  runtime_error: EXECUTION_FAILURE_CLASS.providerExit,
  spawn_error: EXECUTION_FAILURE_CLASS.providerExit,
  exit_code: EXECUTION_FAILURE_CLASS.providerExit,
  stdout_buffer_exceeded: EXECUTION_FAILURE_CLASS.bufferLimit,
  buffer_limit: EXECUTION_FAILURE_CLASS.bufferLimit,
  stale_process_missing: EXECUTION_FAILURE_CLASS.staleProcessMissing,
  coalesced: EXECUTION_FAILURE_CLASS.coalesced,
};

export function normalizeExecutionFailureClass(
  value: string | null | undefined,
  fallback: ExecutionFailureClass | null = null,
): ExecutionFailureClass | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  return LEGACY_EXECUTION_FAILURE_CLASS_MAP[normalized] ?? fallback;
}
