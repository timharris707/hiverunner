type LogLevel = "info" | "warn" | "error";
type LogValue = string | number | boolean | null | undefined;
type LogFields = Record<string, LogValue>;

const SENSITIVE_FIELD = /(authorization|cookie|password|secret|service[_-]?role|token|api[_-]?key)/i;

function sanitizeFields(fields: LogFields): Record<string, string | number | boolean | null> {
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    sanitized[key] = SENSITIVE_FIELD.test(key) ? "[redacted]" : value;
  }
  return sanitized;
}

export function structuredLog(
  channel: "api" | "security" | "runtime",
  level: LogLevel,
  event: string,
  fields: LogFields = {},
): void {
  const payload = {
    event,
    ...sanitizeFields(fields),
  };
  const line = `[${channel}] ${JSON.stringify(payload)}`;
  console[level](line);
}

export function apiLog(event: string, fields: LogFields = {}): void {
  structuredLog("api", "info", event, fields);
}

export function securityLog(event: string, fields: LogFields = {}, level: LogLevel = "warn"): void {
  structuredLog("security", level, event, fields);
}
