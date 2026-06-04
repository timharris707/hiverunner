import { errorResponse } from "@/lib/orchestration/api";

export type ParsedQueryValue<T extends string> = {
  raw: string | null;
  value: T | undefined;
};

export function normalizeQueryValue<T extends string>(
  value: string | null,
  allowedValues: readonly T[],
): T | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return allowedValues.includes(normalized as T) ? normalized as T : undefined;
}

export function normalizeQueryParam<T extends string>(
  searchParams: URLSearchParams,
  name: string,
  allowedValues: readonly T[],
): ParsedQueryValue<T> {
  const raw = searchParams.get(name);
  return { raw, value: normalizeQueryValue(raw, allowedValues) };
}

export function invalidQueryValueResponse<T extends string>(
  parsedValue: ParsedQueryValue<T>,
  code: string,
  message: string,
) {
  if (parsedValue.raw && !parsedValue.value) {
    return errorResponse(400, code, message);
  }
  return null;
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body as Record<string, unknown> | null;
}

export function invalidJsonBodyResponse() {
  return errorResponse(400, "invalid_body", "Request body must be valid JSON");
}

export async function readRequiredJsonBody(request: Request) {
  const body = await readJsonBody(request);
  if (!body) {
    return { ok: false as const, response: invalidJsonBodyResponse() };
  }
  return { ok: true as const, body };
}
