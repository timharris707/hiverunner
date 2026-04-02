import {
  type PaperclipAgentWakeInput,
  type PaperclipAgentWakeResult,
  type PaperclipIssueComment,
  type PaperclipIssueCreateInput,
  type PaperclipIssueReference,
  type PaperclipIssueUpdateInput,
} from "@/lib/orchestration/bridge/types";
import type { PaperclipBridgeConfig } from "@/lib/orchestration/bridge/config";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  includeRunHeader?: boolean;
  authKey?: string;
};

type PaperclipIssueApiResponse = {
  id: string;
  identifier?: string;
  status: PaperclipIssueReference["status"];
  priority: PaperclipIssueReference["priority"];
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
};

type PaperclipIssueCommentApiResponse = {
  id: string;
  body: string;
  createdAt: string;
  authorAgentId?: string | null;
  authorUserId?: string | null;
};

type PaperclipAgentWakeApiResponse = {
  id?: string;
  status?: string;
};

export class PaperclipBridgeError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retriable: boolean;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    retriable: boolean,
    details?: unknown
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.retriable = retriable;
    this.details = details;
  }
}

function toIssueReference(input: PaperclipIssueApiResponse): PaperclipIssueReference {
  return {
    id: input.id,
    identifier: input.identifier ?? input.id,
    status: input.status,
    priority: input.priority,
    assigneeAgentId: input.assigneeAgentId ?? undefined,
    assigneeUserId: input.assigneeUserId ?? undefined,
  };
}

function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function toIssueComment(input: PaperclipIssueCommentApiResponse): PaperclipIssueComment {
  return {
    id: input.id,
    body: input.body,
    createdAt: input.createdAt,
    authorAgentId: input.authorAgentId ?? undefined,
    authorUserId: input.authorUserId ?? undefined,
  };
}

export class PaperclipBridgeClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly bridgeApiKey: string;
  private readonly companyId: string;
  private readonly runId?: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(config: PaperclipBridgeConfig) {
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
    this.bridgeApiKey = config.bridgeApiKey;
    this.companyId = config.companyId;
    this.runId = config.runId;
    this.timeoutMs = config.timeoutMs;
    this.maxRetries = config.maxRetries;
    this.retryBaseMs = config.retryBaseMs;
  }

  getCompanyId(): string {
    return this.companyId;
  }

  async createIssue(input: PaperclipIssueCreateInput): Promise<PaperclipIssueReference> {
    const result = await this.request<PaperclipIssueApiResponse>(
      `/api/companies/${encodeURIComponent(this.companyId)}/issues`,
      {
        method: "POST",
        includeRunHeader: true,
        body: {
          title: input.title,
          description: input.description ?? "",
          priority: input.priority,
          status: input.status ?? "todo",
          assigneeAgentId: input.assigneeAgentId,
          goalId: input.goalId,
          projectId: input.projectId,
          parentId: input.parentId,
        },
      }
    );
    return toIssueReference(result);
  }

  async updateIssue(issueId: string, input: PaperclipIssueUpdateInput): Promise<PaperclipIssueReference> {
    const result = await this.request<PaperclipIssueApiResponse>(
      `/api/issues/${encodeURIComponent(issueId)}`,
      {
        method: "PATCH",
        includeRunHeader: true,
        body: input,
      }
    );
    return toIssueReference(result);
  }

  async getIssue(issueId: string): Promise<PaperclipIssueReference> {
    const result = await this.request<PaperclipIssueApiResponse>(
      `/api/issues/${encodeURIComponent(issueId)}`,
      { method: "GET" }
    );
    return toIssueReference(result);
  }

  async listIssueComments(
    issueId: string,
    input?: { after?: string; order?: "asc" | "desc" }
  ): Promise<PaperclipIssueComment[]> {
    const params = new URLSearchParams();
    if (input?.after) {
      params.set("after", input.after);
    }
    params.set("order", input?.order ?? "asc");

    const route = `/api/issues/${encodeURIComponent(issueId)}/comments${
      params.size > 0 ? `?${params.toString()}` : ""
    }`;
    const result = await this.request<PaperclipIssueCommentApiResponse[]>(route, { method: "GET" });
    return result.map(toIssueComment);
  }

  async createIssueComment(issueId: string, body: string): Promise<void> {
    await this.request(
      `/api/issues/${encodeURIComponent(issueId)}/comments`,
      {
        method: "POST",
        includeRunHeader: true,
        body: { body },
      }
    );
  }

  async checkoutIssue(issueId: string, agentId: string, expectedStatuses: string[]): Promise<void> {
    await this.request(
      `/api/issues/${encodeURIComponent(issueId)}/checkout`,
      {
        method: "POST",
        includeRunHeader: true,
        body: { agentId, expectedStatuses },
      }
    );
  }

  async getAgent(agentId: string): Promise<{ id: string; name: string; role: string }> {
    return this.request<{ id: string; name: string; role: string }>(
      `/api/agents/${encodeURIComponent(agentId)}`,
      { method: "GET" }
    );
  }

  async getBridgeHealth(): Promise<{ ok: boolean; agentId: string }> {
    const me = await this.request<{ id: string }>(
      "/api/agents/me",
      { method: "GET" }
    );
    return { ok: true, agentId: me.id };
  }

  async wakeAgent(agentReference: string, input: PaperclipAgentWakeInput): Promise<PaperclipAgentWakeResult> {
    const params = new URLSearchParams({
      companyId: this.companyId,
    });

    const result = await this.request<PaperclipAgentWakeApiResponse>(
      `/api/agents/${encodeURIComponent(agentReference)}/wakeup?${params.toString()}`,
      {
        method: "POST",
        authKey: this.bridgeApiKey,
        body: {
          source: input.source ?? "assignment",
          triggerDetail: input.triggerDetail ?? "system",
          reason: input.reason ?? null,
          payload: input.payload ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          forceFreshSession: input.forceFreshSession ?? false,
        },
      }
    );

    const status = result.status === "running" || result.status === "skipped" ? result.status : "queued";
    return {
      status,
      runId: typeof result.id === "string" ? result.id : undefined,
    };
  }

  private async request<T = unknown>(route: string, options: RequestOptions): Promise<T> {
    const url = `${this.apiUrl}${route}`;
    const maxAttempts = this.maxRetries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          method: options.method ?? "GET",
          headers: {
            Authorization: `Bearer ${options.authKey ?? this.apiKey}`,
            "Content-Type": "application/json",
            ...(options.includeRunHeader && this.runId
              ? { "X-Paperclip-Run-Id": this.runId }
              : {}),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
          cache: "no-store",
        });

        const text = await response.text();
        const parsed = text ? safeParseJson(text) : undefined;

        if (!response.ok) {
          const payload = (parsed ?? {}) as { error?: { code?: string; message?: string; details?: unknown } };
          throw new PaperclipBridgeError(
            response.status,
            payload.error?.code ?? "paperclip_request_failed",
            payload.error?.message ?? `Paperclip request failed (${response.status})`,
            isRetriableStatus(response.status),
            payload.error?.details
          );
        }

        return parsed as T;
      } catch (error) {
        const normalized = normalizeBridgeError(error);
        if (normalized.retriable && attempt < maxAttempts) {
          await wait(this.retryDelayMs(attempt));
          continue;
        }

        throw withRetryMetadata(normalized, attempt, maxAttempts);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new PaperclipBridgeError(
      500,
      "paperclip_retry_exhausted",
      "Paperclip request retry loop exited unexpectedly",
      false
    );
  }

  private retryDelayMs(attempt: number): number {
    const exponential = this.retryBaseMs * (2 ** (attempt - 1));
    return Math.min(exponential, 5_000);
  }
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeBridgeError(error: unknown): PaperclipBridgeError {
  if (error instanceof PaperclipBridgeError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new PaperclipBridgeError(504, "paperclip_timeout", "Paperclip request timed out", true);
  }

  const message = error instanceof Error ? error.message : "Unknown bridge client error";
  return new PaperclipBridgeError(503, "paperclip_unreachable", message, true);
}

function withRetryMetadata(
  error: PaperclipBridgeError,
  attempt: number,
  maxAttempts: number
): PaperclipBridgeError {
  const details = {
    ...(isRecord(error.details) ? error.details : {}),
    attempts: attempt,
    maxAttempts,
  };
  return new PaperclipBridgeError(error.status, error.code, error.message, error.retriable, details);
}
