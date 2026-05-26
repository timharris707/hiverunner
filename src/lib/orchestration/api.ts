import { NextResponse } from "next/server";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export class OrchestrationApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    } satisfies ApiErrorBody,
    { status }
  );
}

export function handleRouteError(error: unknown, context: string) {
  if (error instanceof OrchestrationApiError) {
    return errorResponse(error.status, error.code, error.message, error.details);
  }

  console.error(`[orchestration] ${context} error:`, error);
  return errorResponse(500, "internal_error", "Unexpected orchestration API error");
}
