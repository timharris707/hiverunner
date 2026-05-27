"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { type ClipboardEvent as ReactClipboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, Tag, Folder, Link2, Upload, RotateCcw, User, AtSign, Activity, Bot, Wrench, CheckCircle2, AlertCircle, MessageSquare, GitBranch, Clock, Mic, Plus, Play } from "lucide-react";
import { CreateTaskModal } from "@/components/orchestration/CreateTaskModal";
import { color, space, radius, type as typeScale, font } from "@/lib/ui/tokens";
import { buildCanonicalGoalPath, buildCompanyPath } from "@/lib/orchestration/route-paths";

import { CompanyErrorState } from "@/components/company/company-ui";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { StatusCircle } from "@/components/orchestration/StatusCircle";
import { PriorityBars } from "@/components/orchestration/PriorityBars";
import { PRIORITY_META, STATUS_META } from "@/components/orchestration/task-display";
import {
  getTaskDetail,
  listCompanies,
  listCompanyAgents,
  listCompanyApprovals,
  listProjects,
  listTaskComments,
  addTaskCommentWithResult,
  updateTaskStatus,
  updateTask,
  updateTaskAssignee,
  runTaskExecution,
} from "@/lib/orchestration/client";
import { InlineStatusPicker } from "@/components/tasks/InlineStatusPicker";
import { InlinePriorityPicker } from "@/components/tasks/InlinePriorityPicker";
import { AgentAvatarInline, InlineAssigneePicker, resolveAvatar } from "@/components/tasks/InlineAssigneePicker";
import { InlineTagsEditor } from "@/components/tasks/InlineTagsEditor";
import { getAgentByAnyId } from "@/config/agents";
import { TaskVoiceModal } from "@/components/voice/TaskVoiceModal";
import type { VoiceBindingRequest } from "@/lib/voice-binding";
import {
  getOperationalStatusTag,
  isOperationalStatusComment as isOperationalStatusCommentRecord,
} from "@/lib/orchestration/comment-visibility";
import { STATUS_LABEL, formatShortDate, assigneeInitials } from "@/components/tasks/types";
import { findAgentByReference, getTaskAgentOfRecord, shouldShowAgentOfRecord, taskAgentDisplayLabel } from "@/components/tasks/task-display-agent";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
  OrchestrationTask,
  OrchestrationApproval,
  OrchestrationTaskDetail,
  OrchestrationTaskTimelineItem,
  OrchestrationResolvedExecutionContext,
  TaskStatus,
  TaskPriority,
} from "@/lib/orchestration/types";
import { useLiveRunStream, type StreamTranscriptEntry } from "@/hooks/useLiveRunStream";
import { useEventStream, type StreamEvent } from "@/lib/orchestration/use-event-stream";
import { isLegacyHumanActor, PUBLIC_HUMAN_LABEL } from "@/lib/public-identity";

type Comment = NonNullable<OrchestrationTask["comments"]>[number];

type Tab = "comments" | "subtasks" | "activities";
type RunTranscriptEntry = {
  id: string;
  body: string;
  type?: string;
  eventKind?: string;
  role?: string;
  title?: string;
  ts?: number;
};
type RunSkillEffectivenessEvent = {
  id: string;
  skillName: string;
  skillVersion: number | null;
  eventType: "available" | "explicit_use" | "review_outcome";
  outcome: "pass" | "fail" | "blocked" | "unknown" | null;
  note: string | null;
};
type RunSkillEffectiveness = {
  events: RunSkillEffectivenessEvent[];
  totals: {
    availableCount: number;
    explicitUseCount: number;
    passCount: number;
    failCount: number;
    blockedCount: number;
    unknownCount: number;
  };
};
type TaskExecutionOverridePatch = {
  executionEngine?: OrchestrationTask["executionEngine"] | null;
  executionRuntimeProvider?: string | null;
  executionRuntimeLabel?: string | null;
  executionModelRouting?: string | null;
  executionModelRoutingLabel?: string | null;
};

const TASK_RUNTIME_OPTIONS = [
  { value: "", label: "Inherit" },
  { value: "codex", label: "Codex" },
  { value: "anthropic", label: "Claude Code" },
  { value: "gemini", label: "Gemini CLI" },
  { value: "hermes", label: "Hermes" },
  { value: "openclaw", label: "OpenClaw" },
];

const TASK_MODEL_ROUTING_OPTIONS = [
  { value: "", label: "Inherit" },
  { value: "runtime-managed", label: "Runtime managed" },
  { value: "hive-managed", label: "Hive managed" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "anthropic", label: "Anthropic Direct" },
  { value: "openai", label: "OpenAI Direct" },
  { value: "google", label: "Google Direct" },
];
type CreatorDisplay = {
  label: string;
  title: string;
  kind: "agent" | "system" | "user";
};
type RunHistory = {
  id: string;
  providerId: string;
  executionEngine?: string | null;
  runnerProvider?: string | null;
  runnerModel?: string | null;
  fallbackUsed?: boolean;
  fallbackIndex?: number | null;
  fallbackFromProvider?: string | null;
  routeAttempts?: unknown[];
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  metrics?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    cacheReadInputTokens?: number | null;
    cacheCreationInputTokens?: number | null;
    totalCostUsd?: number | null;
  };
  resolvedExecution?: OrchestrationResolvedExecutionContext;
  transcriptEntries: RunTranscriptEntry[];
  skillEffectiveness?: RunSkillEffectiveness;
  memoryEvidence?: RunMemoryEvidence;
};
type RunMemoryEvidence = {
  injectionSource: "vault_index" | "memory_registry_fallback" | "none" | string;
  run?: { injectedMemorySha256?: string | null };
  evidence: Array<{
    recordId: string;
    title: string;
    sourcePath: string | null;
    layer: string;
    reason: string;
    source?: {
      type?: string;
      tags?: string[];
      status?: string;
      kind?: string;
      scope?: string;
    };
  }>;
};
type ExecutionSnapshot = {
  state: "running" | "completed" | "failed" | "cancelled" | "unknown" | "skipped";
  terminal: boolean;
  reason?: string;
  raw?: string;
  runId?: string;
  agentId?: string;
  sessionId?: string;
  polledAt: string;
} | null;
type LocalWorkingRun = {
  taskId: string;
  runId?: string;
  agentName: string;
  startedAt: string;
  provider?: string;
  label: "waking" | "working";
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${hh}:${m} ${ampm}`;
}

function relativeAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diff / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatExecutionEngineLabel(engine?: string | null): string {
  if (engine === "symphony") return "Symphony";
  if (engine === "manual") return "Manual / Operator Controlled";
  return "HiveRunner Native";
}

function formatExecutionEngineShortLabel(engine?: string | null): string {
  if (engine === "manual") return "Manual";
  return formatExecutionEngineLabel(engine);
}

function formatProviderLabel(provider?: string | null): string | null {
  if (!provider) return null;
  switch (provider.toLowerCase()) {
    case "anthropic":
      return "Claude Code";
    case "gemini":
      return "Gemini CLI";
    case "codex":
      return "Codex";
    case "hermes":
      return "Hermes";
    case "openclaw":
      return "OpenClaw";
    case "manual":
      return "Manual";
    case "symphony":
      return "External runner";
    default:
      return provider;
  }
}

function inferModelSource(provider?: string | null, model?: string | null): string | null {
  const normalizedProvider = provider?.trim().toLowerCase() ?? "";
  const normalizedModel = model?.trim().toLowerCase() ?? "";
  if (normalizedModel.includes("anthropic") || normalizedModel.includes("claude")) return "Anthropic";
  if (normalizedModel.includes("google") || normalizedModel.includes("gemini")) return "Google";
  if (normalizedModel.startsWith("gpt-") || normalizedModel.includes("openai")) return "OpenAI";
  if (normalizedProvider === "anthropic" || normalizedProvider === "claude") return "Anthropic";
  if (normalizedProvider === "gemini" || normalizedProvider === "google") return "Google";
  if (normalizedProvider === "codex" || normalizedProvider === "openai") return "OpenAI";
  if (normalizedProvider === "hermes") return "Runtime managed";
  if (normalizedProvider === "openclaw") return "OpenClaw managed";
  return null;
}

function formatRunProvider(
  provider: string,
  executionEngine?: string | null,
  runnerProvider?: string | null,
  runnerModel?: string | null,
): string {
  const engine = executionEngine === "symphony" || provider === "symphony" ? "symphony" : executionEngine;
  if (engine === "symphony") {
    const runnerLabel = formatProviderLabel(runnerProvider) ?? (provider === "symphony" ? null : formatProviderLabel(provider));
    const modelLabel = runnerModel ? ` · ${runnerModel}` : "";
    return runnerLabel ? `External runner / ${runnerLabel}${modelLabel}` : `External runner${modelLabel}`;
  }
  return formatProviderLabel(provider) ?? provider;
}

function formatTaskRunProvider(
  provider: string,
  executionEngine?: string | null,
  runnerProvider?: string | null,
  runnerModel?: string | null,
): string {
  return formatRunProvider(provider, executionEngine, runnerProvider, runnerModel);
}

function runtimeForExecutionContext(context: OrchestrationResolvedExecutionContext): string | null {
  return formatProviderLabel(context.runnerProvider) ??
    formatProviderLabel(context.provider) ??
    context.runtimeDisplayName ??
    context.runtimeSlug ??
    null;
}

function modelForExecutionContext(context: OrchestrationResolvedExecutionContext): string | null {
  return context.runnerModel ?? context.model ?? null;
}

function stackForExecutionContext(context: OrchestrationResolvedExecutionContext): Array<{ label: string; value: string; muted?: boolean }> {
  const runtime = runtimeForExecutionContext(context);
  const model = modelForExecutionContext(context);
  const source = context.modelRoutingLabel ?? inferModelSource(context.runnerProvider ?? context.provider, model);
  const rows = [
    { label: "Mode", value: formatExecutionEngineLabel(context.executionEngine) },
    { label: "Runtime", value: runtime ?? (context.executionEngine === "manual" ? "No autonomous runtime" : "Runtime managed"), muted: !runtime },
    { label: "Source", value: source ?? (model ? "Runtime managed" : "Not selected yet"), muted: !source },
    { label: "Model", value: model ?? (context.executionEngine === "manual" ? "None" : "Runtime managed"), muted: !model },
  ];
  if (context.modelRoutingLabel || context.modelLane) {
    rows.push({ label: "Route", value: context.modelRoutingLabel ?? context.modelLane ?? "" });
  }
  return rows;
}

function displayExecutionContext(
  context?: OrchestrationResolvedExecutionContext | null,
): Array<{ label: string; value: string; mono?: boolean }> {
  if (!context) return [];
  return [
    { label: "Sandbox", value: context.sandbox ?? "" },
  ].filter((row) => row.value.trim().length > 0);
}

function trimParentheticalLabel(value: string): string {
  return value.replace(/(?:\s*\([^)]*\)\s*)+$/, "").trim() || value;
}

function agentCreatorDisplay(agent: OrchestrationAgent, raw: string): CreatorDisplay {
  const role = agent.role?.trim();
  const fullLabel = role ? `${agent.name} - ${role}` : agent.name;
  return {
    label: trimParentheticalLabel(agent.name),
    title: `${fullLabel} (${raw})`,
    kind: "agent",
  };
}

function formatCreatedByDisplay(
  raw: string | undefined,
  agents: OrchestrationAgent[],
  fallbackAssignee?: string | null,
): CreatorDisplay {
  const value = raw?.trim();
  if (!value) {
    const fallback = fallbackAssignee?.trim() || "System";
    return { label: fallback, title: fallback, kind: fallbackAssignee ? "agent" : "system" };
  }

  const lower = value.toLowerCase();
  if (isLegacyHumanActor(value)) return { label: PUBLIC_HUMAN_LABEL, title: value, kind: "user" };
  if (lower === "mission-control" || lower === "pixel-ui" || lower === "hiverunner") {
    return { label: "HiveRunner", title: value, kind: "system" };
  }
  if (lower === "system") return { label: "System", title: value, kind: "system" };
  if (lower === "review-routing") return { label: "Review routing", title: value, kind: "system" };

  const agentId = lower.startsWith("agent:") ? value.slice("agent:".length) : value;
  const matchingAgent = agents.find((agent) => (
    agent.id === agentId ||
    agent.slug === agentId ||
    agent.name === agentId ||
    agent.openclawAgentId === agentId
  ));
  if (matchingAgent) return agentCreatorDisplay(matchingAgent, value);

  if (lower.startsWith("agent:") || /^[0-9a-f-]{16,}$/i.test(value)) {
    return { label: `Agent ${agentId.slice(0, 8)}`, title: value, kind: "agent" };
  }

  return { label: value, title: value, kind: "system" };
}

function timelineTone(entry: OrchestrationTaskTimelineItem): { bg: string; fg: string; border: string; label: string } {
  switch (entry.provenance) {
    case "comment":
      return { bg: color.infoSoft, fg: color.info, border: "rgba(9, 88, 194, 0.22)", label: "Comment" };
    case "imported_report":
      return { bg: color.accentSoft, fg: color.accent, border: "rgba(217, 119, 6, 0.24)", label: "Imported report" };
    case "approval_event":
      return { bg: color.warningSoft, fg: color.warning, border: "rgba(138, 90, 0, 0.24)", label: "Approval" };
    case "status_change":
      return { bg: color.positiveSoft, fg: color.positive, border: "rgba(23, 122, 50, 0.22)", label: "Status" };
    case "run_event":
      return { bg: color.accentSoft, fg: color.accent, border: "rgba(217, 119, 6, 0.24)", label: "Run" };
    case "subtask_event":
      return { bg: color.surfaceHover, fg: color.textSecondary, border: color.border, label: "Subtask" };
    default:
      return { bg: "rgba(120,113,108,0.14)", fg: color.textMuted, border: "rgba(120,113,108,0.28)", label: "Event" };
  }
}

function timelineGlyph(entry: OrchestrationTaskTimelineItem) {
  switch (entry.provenance) {
    case "comment": return <MessageSquare size={11} />;
    case "imported_report": return <Link2 size={11} />;
    case "approval_event": return <AlertCircle size={11} />;
    case "status_change": return <CheckCircle2 size={11} />;
    case "run_event": return <Bot size={11} />;
    case "subtask_event": return <GitBranch size={11} />;
    default: return <Clock size={11} />;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTrailingUrlPunctuation(value: string): { href: string; trailing: string } {
  const match = value.match(/^(.+?)([.,;:!?)]*)$/);
  return { href: match?.[1] ?? value, trailing: match?.[2] ?? "" };
}

/** Render inline Markdown plus task-key references, scoped to this company code. */
function LinkedText({
  text,
  companySlug,
  taskKeyPrefix,
}: {
  text: string;
  companySlug: string;
  taskKeyPrefix?: string;
}) {
  const prefix = (taskKeyPrefix ?? companySlug).trim().toUpperCase();
  const taskRefPattern = /^[A-Z]{2,5}-\d+$/;
  const allowedTaskRefPattern = prefix ? new RegExp(`^${escapeRegExp(prefix)}-\\d+$`) : taskRefPattern;
  const splitPattern = prefix
    ? new RegExp(`(\\[[^\\]\\n]{1,160}\\]\\(https?:\\/\\/[^\\s)]+?\\)|\\*\\*[^*\\n][\\s\\S]*?\\*\\*|\\*[^*\\n][^*\\n]*\\*|\`[^\`\\n]+\`|\\b${escapeRegExp(prefix)}-\\d+\\b|https?:\\/\\/[^\\s<>)]+)`, "g")
    : /(\[[^\]\n]{1,160}\]\(https?:\/\/[^\s)]+?\)|\*\*[^*\n][\s\S]*?\*\*|\*[^*\n][^*\n]*\*|`[^`\n]+`|\b[A-Z]{2,5}-\d+\b|https?:\/\/[^\s<>)]+)/g;
  const parts = text.split(splitPattern);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) => {
        const markdownLink = part.match(/^\[([^\]\n]{1,160})\]\((https?:\/\/[^\s)]+?)\)$/);
        if (markdownLink) {
          return (
            <a
              key={i}
              href={markdownLink[2]}
              target="_blank"
              rel="noreferrer"
              style={{ color: color.info, textDecoration: "none", fontWeight: 600 }}
              onClick={(e) => e.stopPropagation()}
            >
              {markdownLink[1]}
            </a>
          );
        }
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return (
            <strong key={i} style={{ color: color.text, fontWeight: 700 }}>
              <LinkedText text={part.slice(2, -2)} companySlug={companySlug} taskKeyPrefix={prefix} />
            </strong>
          );
        }
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
          return (
            <em key={i} style={{ color: color.text, fontStyle: "italic" }}>
              <LinkedText text={part.slice(1, -1)} companySlug={companySlug} taskKeyPrefix={prefix} />
            </em>
          );
        }
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return (
            <code
              key={i}
              style={{
                padding: "1px 5px",
                borderRadius: 5,
                background: "rgba(120,113,108,0.16)",
                border: `0.5px solid ${color.border}`,
                color: color.text,
                fontFamily: font.mono,
                fontSize: "0.94em",
              }}
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (/^https?:\/\/[^\s<>)]+$/.test(part)) {
          const { href, trailing } = stripTrailingUrlPunctuation(part);
          return (
            <span key={i}>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                style={{ color: color.info, textDecoration: "none", fontWeight: 600 }}
                onClick={(e) => e.stopPropagation()}
              >
                {href}
              </a>
              {trailing}
            </span>
          );
        }
        return taskRefPattern.test(part) && allowedTaskRefPattern.test(part) ? (
          <Link
            key={i}
            href={buildCompanyPath(companySlug, `/tasks/${encodeURIComponent(part)}`)}
            style={{ color: color.accent, textDecoration: "none", fontWeight: 500 }}
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </Link>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}

function MarkdownText({
  text,
  companySlug,
  taskKeyPrefix,
}: {
  text: string;
  companySlug: string;
  taskKeyPrefix?: string;
}) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={index} style={{ height: 2 }} />;
        const image = trimmed.match(/^!\[([^\]\n]{0,160})\]\((https?:\/\/[^\s)]+|\/api\/tasks\/attachments\?path=[^\s)]+)\)$/);
        if (image) {
          const alt = image[1] || "Attachment";
          const src = image[2];
          return (
            <a
              key={index}
              href={src}
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-flex", width: "fit-content", maxWidth: "100%" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={alt}
                style={{
                  display: "block",
                  maxWidth: "min(100%, 520px)",
                  maxHeight: 360,
                  objectFit: "contain",
                  borderRadius: 8,
                  border: `1px solid ${color.border}`,
                  background: color.surface,
                }}
              />
            </a>
          );
        }
        if (/^-{3,}$/.test(trimmed)) {
          return <div key={index} style={{ height: 1, background: color.border, margin: "4px 0" }} />;
        }
        const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (heading) {
          const level = heading[1].length;
          return (
            <div
              key={index}
              style={{
                fontSize: level <= 2 ? 15 : 13,
                fontWeight: 700,
                color: color.text,
                lineHeight: 1.35,
                marginTop: index === 0 ? 0 : 4,
              }}
            >
              <LinkedText text={heading[2]} companySlug={companySlug} taskKeyPrefix={taskKeyPrefix} />
            </div>
          );
        }
        const bullet = trimmed.match(/^[-*]\s+(.+)$/);
        if (bullet) {
          return (
            <div key={index} style={{ display: "flex", gap: 8, color: color.textSecondary, lineHeight: 1.55 }}>
              <span style={{ color: color.textMuted }}>•</span>
              <span>
                <LinkedText text={bullet[1]} companySlug={companySlug} taskKeyPrefix={taskKeyPrefix} />
              </span>
            </div>
          );
        }
        return (
          <p key={index} style={{ margin: 0, color: color.textSecondary, lineHeight: 1.6 }}>
            <LinkedText text={trimmed} companySlug={companySlug} taskKeyPrefix={taskKeyPrefix} />
          </p>
        );
      })}
    </div>
  );
}

function isOperationalStatusComment(comment: Comment): boolean {
  return isOperationalStatusCommentRecord({
    source: comment.source,
    type: comment.type,
    text: comment.text,
  });
}

function operationalStatusTag(comment: Comment) {
  return getOperationalStatusTag({
    source: comment.source,
    type: comment.type,
    text: comment.text,
  });
}

function isCircuitBreakerComment(comment: Comment): boolean {
  return comment.source === "engine" &&
    comment.type === "blocker" &&
    /^\[AWAITING_HUMAN\]\s+Circuit breaker tripped:/i.test(comment.text.trim());
}

function formatCircuitBreakerComment(text: string): string {
  return text
    .trim()
    .replace(/^\[AWAITING_HUMAN\]\s+/i, "")
    .replace(/^Circuit breaker tripped:/i, "**Circuit breaker tripped**:");
}

type UploadedAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  path: string;
};

function attachmentUrl(attachment: UploadedAttachment): string {
  const params = new URLSearchParams({ path: attachment.path });
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/api/tasks/attachments?${params.toString()}`;
}

function attachmentMarkdown(attachments: UploadedAttachment[]): string {
  if (attachments.length === 0) return "";
  const lines = attachments.map((attachment) => {
    const label = attachment.name.replace(/[\[\]\n\r]/g, " ").replace(/\s+/g, " ").trim() || "attachment";
    const url = attachmentUrl(attachment);
    return attachment.type.startsWith("image/")
      ? `![${label}](${url})`
      : `[${label}](${url})`;
  });
  return `**Attachments**\n\n${lines.join("\n\n")}`;
}

function formatDuration(ms?: number | null): string {
  if (!ms || ms < 0) return "—";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatCompactNumber(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatUsd(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (Math.abs(value) < 0.005) return "$0.00";
  return `$${value.toFixed(value < 1 ? 3 : 2)}`;
}

/* ── Inbox review context ── */

type InboxContextItem = { taskKey: string; title: string };
type InboxContext = { items: InboxContextItem[]; inboxHref: string } | null;

const INBOX_CONTEXT_KEY = "mc:inbox:context";

function loadInboxContext(): InboxContext {
  try {
    const raw = sessionStorage.getItem(INBOX_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.items) && typeof parsed?.inboxHref === "string") return parsed;
  } catch {}
  return null;
}

export default function TaskDetailPage() {
  const params = useParams<{ slug: string; taskKey: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = params?.slug ?? "";
  const taskKey = decodeURIComponent(params?.taskKey ?? "");
  const fromInbox = searchParams.get("from") === "inbox";

  // Inbox review context — loaded when ?from=inbox is present
  const inboxCtx = useMemo<InboxContext>(() => (fromInbox ? loadInboxContext() : null), [fromInbox]);
  const inboxNav = useMemo(() => {
    if (!inboxCtx) return null;
    const idx = inboxCtx.items.findIndex((item) => item.taskKey === taskKey);
    if (idx < 0) return { inboxHref: inboxCtx.inboxHref, prev: null, next: null, pos: 0, total: inboxCtx.items.length };
    const prev = idx > 0 ? inboxCtx.items[idx - 1] : null;
    const next = idx < inboxCtx.items.length - 1 ? inboxCtx.items[idx + 1] : null;
    return { inboxHref: inboxCtx.inboxHref, prev, next, pos: idx + 1, total: inboxCtx.items.length };
  }, [inboxCtx, taskKey]);

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [project, setProject] = useState<OrchestrationProject | null>(null);
  const [task, setTask] = useState<OrchestrationTask | null>(null);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [taskDetail, setTaskDetail] = useState<OrchestrationTaskDetail | null>(null);
  const [linkedApprovals, setLinkedApprovals] = useState<OrchestrationApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const [activityTimeline, setActivityTimeline] = useState<OrchestrationTaskTimelineItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("comments");
  const [runHistories, setRunHistories] = useState<RunHistory[]>([]);
  const [runHistoryLoading, setRunHistoryLoading] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentAttachments, setCommentAttachments] = useState<UploadedAttachment[]>([]);
  const [replyToComment, setReplyToComment] = useState<Comment | null>(null);
  const [posting, setPosting] = useState(false);
  const [propsOpen, setPropsOpen] = useState(true);
  const [compactLayout, setCompactLayout] = useState(false);
  const [copyHint, setCopyHint] = useState(false);
  const [reopenOnComment, setReopenOnComment] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [operationalReassignAgentId, setOperationalReassignAgentId] = useState("");
  const [replyPickerOpen, setReplyPickerOpen] = useState(false);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [execution, setExecution] = useState<ExecutionSnapshot>(null);
  const [localWorkingRun, setLocalWorkingRun] = useState<LocalWorkingRun | null>(null);
  const [runActionPending, setRunActionPending] = useState(false);
  const [createSubtaskOpen, setCreateSubtaskOpen] = useState(false);
  const commentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const replyPickerRef = useRef<HTMLDivElement>(null);
  const dragCounter = useRef(0);

  useEffect(() => {
    setCommentAttachments([]);
    setReplyToComment(null);
    setLocalWorkingRun(null);
  }, [task?.id]);

  const tasksListHref = useCallback((companyCode?: string | null) => {
    const segment = (companyCode?.trim() || slug.trim()).toUpperCase();
    return segment ? `/${encodeURIComponent(segment)}/tasks` : "/";
  }, [slug]);

  const loadTask = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [companies, fetchedTaskDetail] = await Promise.all([
        listCompanies(),
        getTaskDetail(taskKey),
      ]);
      const slugKey = slug.toLowerCase();
      const curCompany = companies.find((c) => c.slug.toLowerCase() === slugKey || c.code.toLowerCase() === slugKey) ?? null;
      setCompany(curCompany);
      if (!fetchedTaskDetail) {
        setError("Task not found.");
        setTask(null);
        setTaskDetail(null);
        router.replace(tasksListHref(curCompany?.code));
        return;
      }
      setTask(fetchedTaskDetail.task);
      setTaskDetail(fetchedTaskDetail.detail);
      setActivityTimeline(fetchedTaskDetail.detail.timeline);
      const [projectRows, agentRows, commentRows] = await Promise.all([
        listProjects({ company: slug }),
        curCompany ? listCompanyAgents(curCompany.slug) : Promise.resolve([]),
        listTaskComments(fetchedTaskDetail.task.id),
      ]);
      const proj = projectRows.find((p) => p.id === fetchedTaskDetail.task.project) ?? null;
      setProject(proj);
      setAgents(agentRows);
      setComments(commentRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load task.");
    } finally {
      setLoading(false);
    }
  }, [router, slug, taskKey, tasksListHref]);

  useEffect(() => {
    const updateLayoutMode = () => setCompactLayout(window.innerWidth < 980);
    updateLayoutMode();
    window.addEventListener("resize", updateLayoutMode);
    return () => window.removeEventListener("resize", updateLayoutMode);
  }, []);

  useEffect(() => { void loadTask(); }, [loadTask]);

  // D5: Live updates over SSE with surgical in-place merges — no full reload
  // on every event, no loading spinner, no row remounts. Events we understand
  // (status_changed, assigned/unassigned, comment_added, reordered) merge
  // directly into local state. Events we can't fully describe from the payload
  // (task.updated only carries *Changed flags, not values) fall through to a
  // narrow refetch (getTaskDetail + listTaskComments only — skips companies/
  // projects/agents that rarely change).
  //
  // Window-focus / visibilitychange full-reload was removed intentionally:
  // SSE auto-reconnects, and tab return shouldn't flash a loading state.
  const narrowRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const narrowRefetch = useCallback(() => {
    if (narrowRefetchTimerRef.current) clearTimeout(narrowRefetchTimerRef.current);
    narrowRefetchTimerRef.current = setTimeout(async () => {
      try {
        const fetched = await getTaskDetail(taskKey);
        if (!fetched) {
          router.replace(tasksListHref(company?.code));
          return;
        }
        setTask(fetched.task);
        setTaskDetail(fetched.detail);
        setActivityTimeline(fetched.detail.timeline);
        const rows = await listTaskComments(fetched.task.id);
        setComments(rows);
      } catch {
        // silent — next SSE event or manual retry will catch it
      }
    }, 250);
  }, [company?.code, router, taskKey, tasksListHref]);

  const handleLiveEvent = useCallback((event: StreamEvent) => {
    const matchesTask =
      (task?.id && event.taskId === task.id) ||
      (event.taskKey && event.taskKey === taskKey);
    if (!matchesTask) return;

    if (event.type === "comment") {
      if (!event.id) return;
      setComments((prev) => {
        if (prev.some((c) => c.id === event.id)) return prev;
        return [
          ...prev,
          {
            id: event.id!,
            author: event.author ?? "Agent",
            text: event.body ?? "",
            timestamp: event.timestamp ?? new Date().toISOString(),
            type: event.commentType,
          },
        ];
      });
      return;
    }

    if (event.type !== "activity") return;

    const nowIso = event.timestamp ?? new Date().toISOString();
    const toClientStatus = (raw?: string): TaskStatus | null => {
      if (!raw) return null;
      if (raw === "to-do") return "to-do";
      if (raw === "in_progress") return "in-progress";
      if (
        raw === "backlog" ||
        raw === "review" ||
        raw === "done" ||
        raw === "blocked" ||
        raw === "cancelled"
      ) {
        return raw;
      }
      return null;
    };

    switch (event.eventType) {
      case "task.status_changed": {
        const next = toClientStatus(event.toStatus);
        if (!next) return;
        setTask((t) => (t ? { ...t, status: next, updated: nowIso } : t));
        return;
      }
      case "task.assigned":
      case "task.unassigned": {
        const nextAssignee =
          event.eventType === "task.unassigned"
            ? undefined
            : event.agentId ??
              (typeof event.metadata?.assigneeId === "string"
                ? (event.metadata.assigneeId as string)
                : undefined);
        setTask((t) => (t ? { ...t, assignee: nextAssignee, updated: nowIso } : t));
        return;
      }
      case "task.reordered": {
        const order = event.metadata?.columnOrder;
        if (typeof order === "number") {
          setTask((t) => (t ? { ...t, columnOrder: order, updated: nowIso } : t));
        }
        return;
      }
      default: {
        // task.updated (flag-only metadata), task.archived, and any unknown
        // event types — fall through to narrow refetch.
        narrowRefetch();
        return;
      }
    }
  }, [task?.id, taskKey, narrowRefetch]);

  useEventStream({ companySlug: slug, enabled: Boolean(slug), onEvent: handleLiveEvent });

  useEffect(() => () => {
    if (narrowRefetchTimerRef.current) clearTimeout(narrowRefetchTimerRef.current);
  }, []);

  // Unified task detail timeline now comes from the main task detail payload.
  useEffect(() => {
    if (activeTab !== "activities") return;
    setActivityLoading(false);
  }, [activeTab]);

  const executionRunIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of taskDetail?.timeline ?? []) {
      if (entry.source === "execution_runs" && entry.linkedRunId) {
        ids.add(entry.linkedRunId);
      }
    }
    return Array.from(ids).slice(0, 5);
  }, [taskDetail?.timeline]);

  useEffect(() => {
    if (executionRunIds.length === 0) {
      setRunHistories([]);
      return;
    }

    let cancelled = false;
    setRunHistoryLoading(true);

    const loadRunHistories = async () => {
      try {
        const histories = await Promise.all(
          executionRunIds.map(async (runId): Promise<RunHistory | null> => {
            const res = await fetch(`/api/orchestration/engine/runs/${encodeURIComponent(runId)}/events`, {
              cache: "no-store",
            });
            if (!res.ok) return null;
            const data = await res.json();
            const entries = Array.isArray(data?.transcript?.entries)
              ? data.transcript.entries.map((entry: Record<string, unknown>) => ({
                  id: String(entry.id ?? crypto.randomUUID()),
                  body: String(entry.body ?? ""),
                  type: typeof entry.type === "string" ? entry.type : undefined,
                  eventKind: typeof entry.eventKind === "string" ? entry.eventKind : undefined,
                  role: typeof entry.role === "string" ? entry.role : undefined,
                  title: typeof entry.title === "string" ? entry.title : undefined,
                  ts: typeof entry.ts === "number" ? entry.ts : undefined,
                }))
              : [];
            const skillEffectiveness = data?.skillEffectiveness && typeof data.skillEffectiveness === "object"
              ? {
                  events: Array.isArray(data.skillEffectiveness.events)
                    ? data.skillEffectiveness.events.map((event: Record<string, unknown>) => ({
                        id: String(event.id ?? crypto.randomUUID()),
                        skillName: String(event.skillName ?? "Unknown skill"),
                        skillVersion: typeof event.skillVersion === "number" ? event.skillVersion : null,
                        eventType: event.eventType === "explicit_use" || event.eventType === "review_outcome" ? event.eventType : "available",
                        outcome:
                          event.outcome === "pass" ||
                          event.outcome === "fail" ||
                          event.outcome === "blocked" ||
                          event.outcome === "unknown"
                            ? event.outcome
                            : null,
                        note: typeof event.note === "string" ? event.note : null,
                      }))
                    : [],
                  totals: {
                    availableCount: Number(data.skillEffectiveness.totals?.availableCount ?? 0),
                    explicitUseCount: Number(data.skillEffectiveness.totals?.explicitUseCount ?? 0),
                    passCount: Number(data.skillEffectiveness.totals?.passCount ?? 0),
                    failCount: Number(data.skillEffectiveness.totals?.failCount ?? 0),
                    blockedCount: Number(data.skillEffectiveness.totals?.blockedCount ?? 0),
                    unknownCount: Number(data.skillEffectiveness.totals?.unknownCount ?? 0),
                  },
                }
              : undefined;
            const resolvedExecutionEnvelope = data?.resolvedExecution && typeof data.resolvedExecution === "object"
              ? data.resolvedExecution as { before?: OrchestrationResolvedExecutionContext; after?: OrchestrationResolvedExecutionContext }
              : null;
            const memoryEvidence = data?.memoryEvidence && typeof data.memoryEvidence === "object"
              ? data.memoryEvidence as RunMemoryEvidence
              : undefined;
            return {
              id: String(data?.run?.id ?? runId),
              providerId: String(data?.run?.providerId ?? "unknown"),
              executionEngine: typeof data?.run?.executionEngine === "string" ? data.run.executionEngine : null,
              runnerProvider: typeof data?.run?.runnerProvider === "string" ? data.run.runnerProvider : null,
              runnerModel: typeof data?.run?.runnerModel === "string" ? data.run.runnerModel : null,
              fallbackUsed: data?.run?.fallbackUsed === true,
              fallbackIndex: typeof data?.run?.fallbackIndex === "number" ? data.run.fallbackIndex : null,
              fallbackFromProvider: typeof data?.run?.fallbackFromProvider === "string" ? data.run.fallbackFromProvider : null,
              routeAttempts: Array.isArray(data?.run?.routeAttempts) ? data.run.routeAttempts : [],
              status: String(data?.run?.status ?? "unknown"),
              startedAt: typeof data?.run?.startedAt === "string" ? data.run.startedAt : null,
              finishedAt: typeof data?.run?.finishedAt === "string" ? data.run.finishedAt : null,
              durationMs: typeof data?.run?.durationMs === "number" ? data.run.durationMs : null,
              metrics: data?.metrics && typeof data.metrics === "object" ? data.metrics : undefined,
              resolvedExecution: resolvedExecutionEnvelope?.after ?? resolvedExecutionEnvelope?.before,
              transcriptEntries: entries,
              skillEffectiveness,
              memoryEvidence,
            };
          })
        );
        if (!cancelled) setRunHistories(histories.filter((history): history is RunHistory => Boolean(history)));
      } catch {
        if (!cancelled) setRunHistories([]);
      } finally {
        if (!cancelled) setRunHistoryLoading(false);
      }
    };

    void loadRunHistories();
    return () => {
      cancelled = true;
    };
  }, [executionRunIds]);

  useEffect(() => {
    if (!task?.id) {
      setExecution(null);
      return;
    }

    let cancelled = false;

    const pollExecution = async () => {
      try {
        const res = await fetch(`/api/orchestration/tasks/${encodeURIComponent(task.id)}/execution`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setExecution({
          state: data?.status?.state ?? "unknown",
          terminal: Boolean(data?.status?.terminal),
          reason: data?.status?.reason,
          raw: data?.status?.raw,
          runId: data?.runId ?? undefined,
          agentId: data?.agentId ?? undefined,
          sessionId: data?.sessionId ?? undefined,
          polledAt: data?.polledAt ?? new Date().toISOString(),
        });
      } catch {
        if (!cancelled) {
          setExecution((prev) => prev ?? {
            state: "unknown",
            terminal: false,
            polledAt: new Date().toISOString(),
          });
        }
      }
    };

    void pollExecution();
    const interval = window.setInterval(() => { void pollExecution(); }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [task?.id]);

  useEffect(() => {
    if (!task?.id || !slug) {
      setLinkedApprovals([]);
      return;
    }

    let cancelled = false;

    const pollApprovals = async () => {
      try {
        const approvals = await listCompanyApprovals({
          companySlug: slug,
          linkedTaskId: task.id,
        });
        if (!cancelled) {
          setLinkedApprovals(approvals);
        }
      } catch {
        if (!cancelled) {
          setLinkedApprovals([]);
        }
      }
    };

    void pollApprovals();
    const interval = window.setInterval(() => { void pollApprovals(); }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [slug, task?.id]);

  const assignedAgent = useMemo(() => {
    const preferredAgentId = execution?.state === "running" ? execution.agentId : undefined;
    if (preferredAgentId) {
      const matched = agents.find((agent) => agent.id === preferredAgentId) ?? null;
      if (matched) return matched;
    }

    return getTaskAgentOfRecord(task, agents);
  }, [agents, execution?.agentId, execution?.state, task]);

  const voiceLaunchAgent = useMemo(() => {
    return getTaskAgentOfRecord(task, agents);
  }, [agents, task]);

  const currentAssigneeAgent = useMemo(() => findAgentByReference(agents, task?.assignee), [agents, task?.assignee]);
  const useAgentOfRecord = shouldShowAgentOfRecord(task);

  const voiceBindingRequest = useMemo<VoiceBindingRequest | null>(() => {
    if (!task) return null;
    const req: VoiceBindingRequest = {
      companySlug: slug,
      taskId: task.id,
      mode: "discuss",
      source: "task-detail",
    };
    const projId = project?.id ?? task.project;
    if (projId) req.projectId = projId;
    if (project?.slug) req.projectSlug = project.slug;
    if (task.key ?? taskKey) req.taskKey = task.key ?? taskKey;
    if (voiceLaunchAgent?.id) req.agentId = voiceLaunchAgent.id;
    return req;
  }, [slug, task, project, taskKey, voiceLaunchAgent]);

  const runUsageSummary = useMemo(() => {
    if (!taskDetail?.runSummary && runHistories.length === 0) return null;
    type UsageMetricKey = "inputTokens" | "outputTokens" | "cacheReadInputTokens" | "cacheCreationInputTokens" | "totalCostUsd";
    const addMetric = (acc: Record<UsageMetricKey, number | null>, key: UsageMetricKey, value?: number | null) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      acc[key] = (acc[key] ?? 0) + value;
    };
    const historyTotals = runHistories.reduce(
      (acc, history) => {
        addMetric(acc, "inputTokens", history.metrics?.inputTokens);
        addMetric(acc, "outputTokens", history.metrics?.outputTokens);
        addMetric(acc, "cacheReadInputTokens", history.metrics?.cacheReadInputTokens);
        addMetric(acc, "cacheCreationInputTokens", history.metrics?.cacheCreationInputTokens);
        addMetric(acc, "totalCostUsd", history.metrics?.totalCostUsd);
        return acc;
      },
      {
        inputTokens: null,
        outputTokens: null,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        totalCostUsd: null,
      } satisfies Record<UsageMetricKey, number | null>,
    );
    const totals = taskDetail?.runSummary?.usageTotals ?? historyTotals;
    return {
      runs: taskDetail?.runSummary?.totalRuns ?? runHistories.length,
      latest: taskDetail?.runSummary?.latestRun ?? null,
      active: taskDetail?.runSummary?.activeRun ?? null,
      totals,
    };
  }, [runHistories, taskDetail?.runSummary]);

  const liveActivityEnabled = Boolean(slug && execution?.state === "running" && assignedAgent?.id);
  const { streamByAgentId, connected: liveActivityConnected } = useLiveRunStream({
    companySlug: slug,
    enabled: liveActivityEnabled,
  });
  const rawLiveAgentStream = assignedAgent?.id ? streamByAgentId.get(assignedAgent.id) : undefined;
  const liveAgentStream = useMemo(() => {
    if (!rawLiveAgentStream) return undefined;
    if (!execution?.runId) return rawLiveAgentStream;
    if (rawLiveAgentStream.runId && rawLiveAgentStream.runId !== execution.runId) return undefined;

    const filteredEvents = rawLiveAgentStream.events.filter((event) => !event.runId || event.runId === execution.runId);
    return {
      ...rawLiveAgentStream,
      events: filteredEvents,
    };
  }, [execution?.runId, rawLiveAgentStream]);

  useEffect(() => {
    if (!localWorkingRun || localWorkingRun.taskId !== task?.id) return;
    if (execution?.state === "running" && (!localWorkingRun.runId || execution.runId === localWorkingRun.runId)) {
      setLocalWorkingRun(null);
    }
    if (execution?.terminal && localWorkingRun.runId && execution.runId === localWorkingRun.runId) {
      setLocalWorkingRun(null);
    }
  }, [execution?.runId, execution?.state, execution?.terminal, localWorkingRun, task?.id]);

  const visibleLocalWorkingRun =
    localWorkingRun && localWorkingRun.taskId === task?.id && execution?.state !== "running"
      ? localWorkingRun
      : null;

  const visibleComments = useMemo(
    () => comments.filter((comment) => !isOperationalStatusComment(comment)),
    [comments]
  );
  const operationalComments = useMemo(
    () => comments
      .map((comment) => ({ comment, tag: operationalStatusTag(comment) }))
      .filter((entry): entry is { comment: Comment; tag: NonNullable<ReturnType<typeof operationalStatusTag>> } => Boolean(entry.tag)),
    [comments]
  );
  const operationalReassignCandidates = useMemo(
    () => {
      const failedNames = new Set(operationalComments.map(({ comment }) => comment.author?.toLowerCase()).filter(Boolean));
      return agents.filter((agent) =>
        agent.id !== task?.assignee &&
        !failedNames.has(agent.name.toLowerCase()) &&
        !failedNames.has(agent.slug.toLowerCase()) &&
        agent.status !== "offline" &&
        agent.status !== "paused" &&
        agent.status !== "error"
      );
    },
    [agents, operationalComments, task?.assignee]
  );
  const visibleActivityTimeline = useMemo(
    () => activityTimeline.filter((entry) => entry.provenance !== "comment" && entry.kind !== "comment"),
    [activityTimeline]
  );

  /* ── Mutations ── */

  const onStatusChange = useCallback(async (_id: string, status: TaskStatus) => {
    if (!task) return;
    const previousTask = task;
    setMutationError(null);
    setTask({ ...task, status, updated: new Date().toISOString() });

    const saved = await updateTaskStatus(
      task.id,
      status,
      undefined,
      previousTask.status === "review" && status === "done"
        ? { reviewNotes: "Marked done from task properties." }
        : undefined
    );

    if (!saved) {
      setTask(previousTask);
      setMutationError("Could not save the status change.");
    }
  }, [task]);

  const onPriorityChange = useCallback(async (_id: string, priority: TaskPriority) => {
    if (!task) return;
    setTask({ ...task, priority, updated: new Date().toISOString() });
    await updateTask({ taskId: task.id, priority });
  }, [task]);

  const onTagsChange = useCallback(async (_id: string, tags: string[]) => {
    if (!task) return;
    const previousTask = task;
    setTask({ ...task, tags, updated: new Date().toISOString() });
    const updated = await updateTask({ taskId: task.id, labels: tags });
    if (updated) {
      setTask(updated);
    } else {
      setTask(previousTask);
      setMutationError("Could not save the tag change.");
    }
  }, [task]);

  const onExecutionOverrideChange = useCallback(async (patch: Partial<TaskExecutionOverridePatch>) => {
    if (!task) return;
    const previousTask = task;
    setMutationError(null);
    const optimisticTask: OrchestrationTask = {
      ...task,
      executionRuntimeProvider: patch.executionRuntimeProvider ?? task.executionRuntimeProvider,
      executionRuntimeLabel: patch.executionRuntimeLabel ?? task.executionRuntimeLabel,
      executionModelRouting: patch.executionModelRouting ?? task.executionModelRouting,
      executionModelRoutingLabel: patch.executionModelRoutingLabel ?? task.executionModelRoutingLabel,
      updated: new Date().toISOString(),
    };
    if (patch.executionEngine !== undefined && patch.executionEngine !== null) {
      optimisticTask.executionEngine = patch.executionEngine;
    }
    setTask(optimisticTask);
    const updated = await updateTask({
      taskId: task.id,
      executionEngine: patch.executionEngine,
      executionRuntimeProvider: patch.executionRuntimeProvider,
      executionRuntimeLabel: patch.executionRuntimeLabel,
      executionModelRouting: patch.executionModelRouting,
      executionModelRoutingLabel: patch.executionModelRoutingLabel,
    });
    if (updated) {
      setTask(updated);
      narrowRefetch();
    } else {
      setTask(previousTask);
      setMutationError("Could not save the execution override.");
    }
  }, [narrowRefetch, task]);

  const onAssigneeChange = useCallback(async (_id: string, assignee: string) => {
    if (!task) return;
    setTask({ ...task, assignee: assignee || undefined, updated: new Date().toISOString() });
    await updateTaskAssignee(task.id, assignee);
  }, [task]);

  const onRunTask = useCallback(async () => {
    if (!task || runActionPending) return;
    setRunActionPending(true);
    setMutationError(null);
    const result = await runTaskExecution({
      taskId: task.id,
      actorUserId: "task-detail-ui",
      reason: "ui_run_now",
      forceFreshSession: true,
    });
    if (!result) {
      setMutationError("Could not start this task run.");
      setRunActionPending(false);
      return;
    }
    setTask(result.task);
    if (!result.execution.queued && result.execution.status === "skipped") {
      setMutationError(`Could not start this task run: ${result.execution.reason ?? "execution skipped"}.`);
    } else {
      setLocalWorkingRun({
        taskId: result.task.id,
        runId: result.execution.runId,
        agentName: assignedAgent?.name ?? result.task.assignee ?? "Agent",
        startedAt: new Date().toISOString(),
        provider: result.execution.mode,
        label: result.execution.status === "running" ? "working" : "waking",
      });
      setExecution((prev) => ({
        state: result.execution.status === "running" ? "running" : prev?.state ?? "unknown",
        terminal: false,
        reason: result.execution.reason,
        runId: result.execution.runId ?? prev?.runId,
        sessionId: result.execution.sessionId ?? prev?.sessionId,
        agentId: prev?.agentId,
        polledAt: new Date().toISOString(),
      }));
    }
    setRunActionPending(false);
    void loadTask();
  }, [assignedAgent?.name, loadTask, runActionPending, task]);

  const onOperationalReassign = useCallback(async () => {
    if (!task || !operationalReassignAgentId) return;
    setMutationError(null);
    await updateTaskAssignee(task.id, operationalReassignAgentId);
    setTask((prev) => prev ? { ...prev, assignee: operationalReassignAgentId, updated: new Date().toISOString() } : prev);
    void loadTask();
  }, [loadTask, operationalReassignAgentId, task]);

  const onOperationalBacklog = useCallback(async () => {
    if (!task) return;
    setMutationError(null);
    await updateTaskStatus(task.id, "backlog");
    setTask((prev) => prev ? { ...prev, status: "backlog" as TaskStatus, updated: new Date().toISOString() } : prev);
    void loadTask();
  }, [loadTask, task]);

  const onOperationalUnblock = useCallback(async () => {
    if (!task) return;
    setMutationError(null);
    await updateTaskStatus(task.id, "to-do");
    setTask((prev) => prev ? { ...prev, status: "to-do" as TaskStatus, updated: new Date().toISOString() } : prev);
    void loadTask();
  }, [loadTask, task]);

  const onOperationalReframe = useCallback(async () => {
    if (!task) return;
    setMutationError(null);
    await addTaskCommentWithResult(
      task.id,
      "Operator requested reframe: clarify acceptance criteria, constraints, and the next executable step so an agent can continue without human-only interpretation.",
    );
    const refreshed = await listTaskComments(task.id);
    setComments(refreshed);
  }, [task]);

  const onSubmitComment = useCallback(async () => {
    const attachmentsText = attachmentMarkdown(commentAttachments);
    const body = [commentDraft.trim(), attachmentsText].filter(Boolean).join("\n\n");
    if (!task || !body || posting) return;
    setPosting(true);
    const replyPrefix = replyToComment
      ? `Replying to ${replyToComment.author} (${formatTimestamp(replyToComment.timestamp)}):\n> ${replyToComment.text.replace(/\n/g, "\n> ").slice(0, 700)}\n\n`
      : "";
    const result = await addTaskCommentWithResult(task.id, `${replyPrefix}${body}`);
    if (result.ok) {
      setCommentDraft("");
      setCommentAttachments([]);
      setReplyToComment(null);
      // Reopen if checked
      if (reopenOnComment && (task.status === "done" || task.status === "cancelled")) {
        await updateTaskStatus(task.id, "backlog");
        setTask((prev) => prev ? { ...prev, status: "backlog" as TaskStatus, updated: new Date().toISOString() } : prev);
        setReopenOnComment(false);
      }
      // Reassign to reply target if different from current assignee
      if (replyTarget && replyTarget !== task.assignee) {
        await updateTaskAssignee(task.id, replyTarget);
        setTask((prev) => prev ? { ...prev, assignee: replyTarget, updated: new Date().toISOString() } : prev);
      }
      if (result.heartbeat?.attempted && result.heartbeat.queued) {
        setLocalWorkingRun({
          taskId: task.id,
          runId: result.heartbeat.runId,
          agentName: assignedAgent?.name ?? task.assignee ?? "Agent",
          startedAt: new Date().toISOString(),
          provider: taskDetail?.runSummary.latestRun?.provider,
          label: result.heartbeat.status === "running" ? "working" : "waking",
        });
      }
      const refreshed = await listTaskComments(task.id);
      setComments(refreshed);
    }
    setPosting(false);
  }, [task, commentDraft, commentAttachments, posting, reopenOnComment, replyTarget, assignedAgent?.name, taskDetail?.runSummary.latestRun?.provider, replyToComment]);

  const uploadAttachments = useCallback(async (files: File[] | FileList): Promise<UploadedAttachment[]> => {
    const list = Array.from(files).filter((file) => file.size > 0);
    if (!task || uploading || list.length === 0) return [];
    setUploading(true);
    try {
      const formData = new FormData();
      for (const file of list) formData.append("files", file);
      formData.append("taskId", task.id);
      const res = await fetch("/api/tasks/attachments", { method: "POST", body: formData });
      if (res.ok) {
        const payload = await res.json() as { attachments?: UploadedAttachment[] };
        return payload.attachments ?? [];
      }
      return [];
    } finally {
      setUploading(false);
    }
  }, [task, uploading]);

  const appendCommentFiles = useCallback(async (files: File[] | FileList) => {
    const attachments = await uploadAttachments(files);
    if (attachments.length > 0) {
      setActiveTab("comments");
      setCommentAttachments((current) => [...current, ...attachments]);
    }
  }, [uploadAttachments]);

  const handleCommentPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const directFiles = Array.from(event.clipboardData.files ?? []);
    const itemFiles = Array.from(event.clipboardData.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const files = directFiles.length > 0 ? directFiles : itemFiles;
    if (files.length === 0) return;
    event.preventDefault();
    void appendCommentFiles(files);
  }, [appendCommentFiles]);

  const copyKey = useCallback(() => {
    if (!task) return;
    const text = `${task.key ?? task.id.slice(0, 8).toUpperCase()}: ${task.title}`;
    void navigator.clipboard.writeText(text);
    setCopyHint(true);
    setTimeout(() => setCopyHint(false), 1500);
  }, [task]);

  /* ── Render ── */

  const commentCanSubmit = (commentDraft.trim().length > 0 || commentAttachments.length > 0) && !posting;

  if (!loading && !task) {
    return (
      <CompanyErrorState
        title={error ?? "Task not found"}
        detail="This task could not be resolved. It may have been archived."
        href={tasksListHref(company?.code)}
        linkLabel="Back to tasks"
      />
    );
  }

  const companyCode = company?.code ?? slug.slice(0, 3).toUpperCase();
  const taskKeyPrefix = companyCode.toUpperCase();
  const priorityMeta = task ? PRIORITY_META[task.priority] : null;
  const statusMeta = task ? STATUS_META[task.status] : null;
  const pendingLinkedApprovals = linkedApprovals.filter((approval) => approval.status === "pending" || approval.status === "revision_requested");
  const latestRun = runUsageSummary?.latest ?? null;
  const plannedExecution = taskDetail?.plannedExecution ?? null;
  const plannedRuntime = plannedExecution ? runtimeForExecutionContext(plannedExecution) : null;
  const plannedModel = plannedExecution ? modelForExecutionContext(plannedExecution) : null;
  const plannedFallbacks = plannedExecution?.routeFallbacks ?? [];
  const plannedLaneLabel = plannedExecution?.laneLabel ?? plannedExecution?.modelLane ?? "default lane";
  const showPlannedExecution = Boolean(
    task &&
    plannedExecution &&
    !latestRun &&
    ["to-do", "backlog", "in-progress"].includes(task.status),
  );
  const latestResolvedExecution = latestRun?.resolvedExecution ?? null;
  const activeResolvedExecution = runUsageSummary?.active?.resolvedExecution ?? null;
  const latestRunFailed = latestRun?.status === "failed" || latestRun?.status === "cancelled" || Boolean(latestRun?.error);
  const executionFailed = execution?.state === "failed" || execution?.state === "cancelled";
  const executionFailureReason = executionFailed
    ? execution?.reason ?? execution?.raw ?? "The latest execution did not complete successfully."
    : latestRunFailed
      ? latestRun?.error ?? `${formatTaskRunProvider(latestRun?.provider ?? "runtime", task?.executionEngine)} ${latestRun?.status ?? "failed"}`
      : null;
  const canTriggerRun =
    Boolean(task?.assignee) &&
    task?.executionEngine !== "manual" &&
    execution?.state !== "running" &&
    !runActionPending;
  const runActionLabel =
    runActionPending
      ? "Starting..."
      : executionFailureReason || task?.status === "blocked" || task?.status === "review"
        ? "Retry run"
        : "Run now";
  const createdByDisplay = task
    ? formatCreatedByDisplay(task.createdBy, agents, task.assignee)
    : { label: "System", title: "System", kind: "system" as const };
  const runStateLabel =
    execution?.state === "completed" && pendingLinkedApprovals.length > 0
      ? "Awaiting approval"
      : execution?.state === "running"
        ? "Running"
        : execution?.state === "completed"
          ? "Completed"
          : execution?.state === "failed"
            ? "Failed"
            : execution?.state === "cancelled"
              ? "Cancelled"
          : execution?.state;
  const runStateColor =
    execution?.state === "completed" && pendingLinkedApprovals.length > 0
      ? "#fbbf24"
      : execution?.state === "running"
        ? "#22c55e"
        : execution?.state === "completed"
          ? color.textMuted
          : execution?.state === "skipped" || execution?.state === "unknown"
            ? color.textMuted
            : "#f87171";
  const taskDetailViewportHeight = "calc(100vh - 72px)";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: compactLayout ? "column" : "row",
        height: compactLayout ? "auto" : taskDetailViewportHeight,
        maxHeight: compactLayout ? undefined : taskDetailViewportHeight,
        minHeight: compactLayout ? "100%" : 0,
        overflow: "visible",
        background: color.bg,
        color: color.text,
        position: "relative",
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounter.current++;
        if (e.dataTransfer.types.includes("Files")) setDragOver(true);
      }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounter.current--;
        if (dragCounter.current <= 0) { setDragOver(false); dragCounter.current = 0; }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        dragCounter.current = 0;
        const files = Array.from(e.dataTransfer.files ?? []).filter((file) => file.size > 0);
        if (files.length > 0) void appendCommentFiles(files);
      }}
    >
      {/* ── Drag overlay ── */}
      {dragOver && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 100,
          background: "rgba(217,119,6,0.06)",
          border: "2px dashed rgba(217,119,6,0.4)",
          borderRadius: 12,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <div style={{
            padding: "16px 32px", borderRadius: 10,
            background: "rgba(26,24,20,0.95)", border: "0.5px solid rgba(217,119,6,0.3)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <Upload size={18} color="#f59e0b" />
            <span style={{ fontSize: 14, fontWeight: 600, color: "#f59e0b" }}>Drop files to attach</span>
          </div>
        </div>
      )}

      {/* ── Main column ── */}
      <div className="task-detail-scrollbarless" style={{
        flex: "1 1 auto",
        overflowY: compactLayout ? "visible" : "auto",
        overscrollBehavior: compactLayout ? undefined : "contain",
        padding: compactLayout ? `${space.lg}px ${space.lg}px 48px` : `${space.xl}px ${space.xxxl}px 64px`,
        minWidth: 0,
        minHeight: 0,
      }}>
        {loading ? (
          <div style={{ padding: "48px 0", textAlign: "center", fontSize: typeScale.bodySmall.size, color: color.textMuted }}>
            Loading task…
          </div>
        ) : task && (
          <>
            {/* ── Inbox review context bar ── */}
            {inboxNav && (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: `${space.sm}px ${space.md}px`,
                marginBottom: space.lg,
                borderRadius: radius.md,
                border: `0.5px solid ${color.border}`,
                background: color.surface,
              }}>
                <Link
                  href={inboxNav.inboxHref}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: space.xs,
                    fontSize: typeScale.bodySmall.size, fontWeight: 500,
                    color: color.textSecondary, textDecoration: "none",
                  }}
                >
                  <ArrowLeft size={14} />
                  Back to Inbox
                </Link>

                <div style={{ display: "flex", alignItems: "center", gap: space.md }}>
                  {inboxNav.total > 0 && (
                    <span style={{ fontSize: typeScale.caption.size, color: color.textMuted }}>
                      {inboxNav.pos} of {inboxNav.total}
                    </span>
                  )}
                  <div style={{ display: "flex", gap: space.xs }}>
                    {inboxNav.prev ? (
                      <Link
                        href={buildCompanyPath(slug, `/tasks/${encodeURIComponent(inboxNav.prev.taskKey)}?from=inbox`)}
                        title={inboxNav.prev.title}
                        style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          width: 28, height: 28, borderRadius: radius.sm,
                          border: `0.5px solid ${color.border}`, background: "transparent",
                          color: color.textSecondary, textDecoration: "none",
                        }}
                      >
                        <ChevronLeft size={14} />
                      </Link>
                    ) : (
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 28, height: 28, borderRadius: radius.sm,
                        border: `0.5px solid ${color.border}`, background: "transparent",
                        color: color.textMuted, opacity: 0.4,
                      }}>
                        <ChevronLeft size={14} />
                      </span>
                    )}
                    {inboxNav.next ? (
                      <Link
                        href={buildCompanyPath(slug, `/tasks/${encodeURIComponent(inboxNav.next.taskKey)}?from=inbox`)}
                        title={inboxNav.next.title}
                        style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          width: 28, height: 28, borderRadius: radius.sm,
                          border: `0.5px solid ${color.border}`, background: "transparent",
                          color: color.textSecondary, textDecoration: "none",
                        }}
                      >
                        <ChevronRight size={14} />
                      </Link>
                    ) : (
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 28, height: 28, borderRadius: radius.sm,
                        border: `0.5px solid ${color.border}`, background: "transparent",
                        color: color.textMuted, opacity: 0.4,
                      }}>
                        <ChevronRight size={14} />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {mutationError && (
              <div style={{
                marginBottom: space.lg,
                padding: `${space.sm}px ${space.md}px`,
                borderRadius: radius.md,
                border: "0.5px solid rgba(239,68,68,0.35)",
                background: "rgba(127,29,29,0.18)",
                color: "#fca5a5",
                fontSize: typeScale.bodySmall.size,
              }}>
                {mutationError}
              </div>
            )}

            {taskDetail?.parentTask && (
              <Link
                href={buildCompanyPath(slug, `/tasks/${encodeURIComponent(taskDetail.parentTask.key ?? taskDetail.parentTask.id)}`)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: space.md,
                  padding: "10px 12px",
                  borderRadius: radius.md,
                  border: `0.5px solid ${color.border}`,
                  background: "rgba(255,255,255,0.03)",
                  textDecoration: "none",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: typeScale.caption.size, color: color.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
                    Parent task
                  </div>
                  <div style={{ fontSize: typeScale.bodySmall.size, color: color.textSecondary, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {taskDetail.parentTask.key ? `${taskDetail.parentTask.key} · ${taskDetail.parentTask.title}` : taskDetail.parentTask.title}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: color.textMuted, flexShrink: 0 }}>
                  {STATUS_LABEL[taskDetail.parentTask.status] ?? taskDetail.parentTask.status}
                </div>
              </Link>
            )}

            {/* Meta row: status, priority, key, project */}
            <div style={{ display: "flex", alignItems: "center", gap: space.md, marginBottom: space.md }}>
              <StatusCircle status={task.status} size={16} />
              {priorityMeta && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: space.xs, fontSize: typeScale.bodySmall.size, color: priorityMeta.color }}>
                  <PriorityBars priority={task.priority} size={16} />
                  {priorityMeta.label}
                </span>
              )}
              <span style={{ fontSize: typeScale.mono.size, color: color.textMuted, fontFamily: font.mono, whiteSpace: "nowrap", flexShrink: 0 }}>
                {task.key ?? task.id.slice(0, 8).toUpperCase()}
              </span>
              {project && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: radius.full, background: project.color }} />
                  <span style={{ fontSize: typeScale.bodySmall.size, color: color.textMuted }}>{project.name}</span>
                </div>
              )}
              <span
                title={`Orchestration mode: ${formatExecutionEngineLabel(task.executionEngine)}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "3px 8px",
                  borderRadius: radius.full,
                  border: `0.5px solid ${task.executionEngine === "symphony" ? color.accent : color.border}`,
                  background: task.executionEngine === "symphony" ? color.accentSoft : "rgba(255,255,255,0.03)",
                  color: task.executionEngine === "symphony" ? color.accent : color.textMuted,
                  fontSize: 11,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                <Wrench size={11} />
                {formatExecutionEngineShortLabel(task.executionEngine)}
              </span>
              {task.modelDisplay ? (
                <span
                  title={task.modelDisplay.label}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    maxWidth: 240,
                    minWidth: 0,
                    padding: "3px 8px",
                    borderRadius: radius.full,
                    border: `0.5px solid ${task.modelDisplay.border}`,
                    background: task.modelDisplay.background,
                    color: task.modelDisplay.color,
                    fontSize: 11,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {task.modelDisplay.providerLabel} / {task.modelDisplay.model}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void onRunTask()}
                disabled={!canTriggerRun}
                title={
                  !task.assignee
                    ? "Assign an agent before running this task"
                    : task.executionEngine === "manual"
                      ? "Manual / Operator Controlled tasks do not run through an autonomous runtime"
                      : runActionLabel
                }
                style={{
                  marginLeft: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: `${space.xs}px ${space.sm}px`,
                  fontSize: typeScale.caption.size,
                  color: canTriggerRun ? color.text : color.textMuted,
                  background: canTriggerRun ? color.surfaceHover : color.surface,
                  border: `0.5px solid ${executionFailureReason ? "rgba(248,113,113,0.38)" : color.border}`,
                  borderRadius: radius.sm,
                  cursor: canTriggerRun ? "pointer" : "not-allowed",
                  opacity: canTriggerRun ? 1 : 0.65,
                  whiteSpace: "nowrap",
                }}
              >
                {executionFailureReason || task.status === "blocked" || task.status === "review" ? <RotateCcw size={12} /> : <Play size={12} />}
                {runActionLabel}
              </button>
              <button
                type="button"
                onClick={copyKey}
                title="Copy task ID and title"
                style={{
                  display: "inline-flex", alignItems: "center", gap: space.xs,
                  padding: `${space.xs}px ${space.sm}px`, fontSize: typeScale.caption.size, color: color.textMuted,
                  background: "transparent", border: `0.5px solid ${color.border}`, borderRadius: radius.sm,
                  cursor: "pointer",
                }}
              >
                <Copy size={12} />
                {copyHint ? "Copied" : "Copy"}
              </button>
            </div>

            {/* Title */}
            <h1 style={{
              fontSize: typeScale.metric.size, fontWeight: 700, color: color.text, margin: `0 0 ${space.lg}px 0`,
              letterSpacing: "-0.01em", lineHeight: 1.25,
            }}>
              {task.title}
            </h1>

            {taskDetail?.sprintId && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 6,
                  margin: `-${space.sm}px 0 ${space.lg}px 0`,
                  fontSize: typeScale.caption.size,
                  color: color.textMuted,
                }}
              >
                {taskDetail.companyGoalId && (
                  <Link
                    href={buildCanonicalGoalPath(companyCode, taskDetail.companyGoalKey ?? taskDetail.companyGoalId)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      border: `0.5px solid ${color.border}`,
                      borderRadius: radius.full,
                      padding: "3px 8px",
                      color: color.textSecondary,
                      textDecoration: "none",
                      maxWidth: "100%",
                    }}
                  >
                    <span aria-hidden="true">📌</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{taskDetail.companyGoalName ?? "Company goal"}</span>
                  </Link>
                )}
                {taskDetail.companyGoalId && <span>/</span>}
                <Link
                  href={buildCanonicalGoalPath(companyCode, taskDetail.sprintKey ?? taskDetail.sprintId)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    border: `0.5px solid ${color.border}`,
                    borderRadius: radius.full,
                    padding: "3px 8px",
                    color: color.textSecondary,
                    textDecoration: "none",
                    maxWidth: "100%",
                  }}
                >
                  <span>Sprint:</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{taskDetail.sprintName ?? "Sprint"}</span>
                </Link>
              </div>
            )}

            {executionFailureReason && (
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  padding: "12px 14px",
                  marginBottom: space.lg,
                  borderRadius: radius.md,
                  border: "0.5px solid rgba(248,113,113,0.35)",
                  background: "rgba(127,29,29,0.18)",
                }}
              >
                <AlertCircle size={16} color="#f87171" style={{ marginTop: 1, flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#fca5a5", marginBottom: 3 }}>
                    Execution needs attention
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.5, color: color.textSecondary, wordBreak: "break-word" }}>
                    {executionFailureReason}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void onRunTask()}
                  disabled={!canTriggerRun}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 30,
                    padding: "0 10px",
                    borderRadius: radius.sm,
                    border: `0.5px solid ${canTriggerRun ? color.borderStrong : color.border}`,
                    background: canTriggerRun ? color.surfaceElevated : color.surfaceHover,
                    color: canTriggerRun ? color.negative : color.textMuted,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: canTriggerRun ? "pointer" : "not-allowed",
                    whiteSpace: "nowrap",
                    boxShadow: canTriggerRun ? "0 1px 0 rgba(0,0,0,0.06)" : "none",
                  }}
                >
                  <RotateCcw size={12} />
                  Retry
                </button>
              </div>
            )}

            {operationalComments.length > 0 && (
              <section
                aria-label="System and operational status"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  padding: "14px",
                  marginBottom: space.lg,
                  borderRadius: radius.md,
                  border: "0.5px solid rgba(251,191,36,0.28)",
                  background: "rgba(251,191,36,0.06)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertCircle size={15} color="#fbbf24" />
                  <div style={{ fontSize: 13, fontWeight: 800, color: color.text }}>System / Operational</div>
                  <div style={{ marginLeft: "auto", fontSize: 11, color: color.textMuted }}>
                    {operationalComments.length} signal{operationalComments.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {operationalComments.map(({ comment, tag }) => {
                    const isAwaitingHuman = tag === "AWAITING_HUMAN";
                    return (
                      <div
                        key={comment.id}
                        style={{
                          padding: "10px 12px",
                          borderRadius: radius.sm,
                          border: `0.5px solid ${isAwaitingHuman ? "rgba(251,191,36,0.38)" : color.border}`,
                          background: isAwaitingHuman ? "rgba(251,191,36,0.08)" : color.surface,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span
                            style={{
                              padding: "2px 7px",
                              borderRadius: radius.full,
                              border: "0.5px solid rgba(251,191,36,0.25)",
                              background: "rgba(251,191,36,0.1)",
                              color: "#fbbf24",
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: 0,
                            }}
                          >
                            {tag}
                          </span>
                          <span style={{ fontSize: 12, color: color.textSecondary }}>
                            {comment.author || "System"}
                          </span>
                          <span style={{ marginLeft: "auto", fontSize: 11, color: color.textMuted }}>
                            {relativeAge(comment.timestamp)}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, lineHeight: 1.55, color: color.textSecondary, whiteSpace: "pre-wrap" }}>
                          <LinkedText text={comment.text.replace(/^\[[^\]]+\]\s*/, "")} companySlug={slug} taskKeyPrefix={taskKeyPrefix} />
                        </div>
                        {isAwaitingHuman && (
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              alignItems: "center",
                              gap: 8,
                              marginTop: 10,
                            }}
                          >
                            <select
                              value={operationalReassignAgentId}
                              onChange={(event) => setOperationalReassignAgentId(event.target.value)}
                              style={{
                                height: 30,
                                borderRadius: radius.sm,
                                border: `0.5px solid ${color.border}`,
                                background: color.surfaceElevated,
                                color: color.text,
                                fontSize: 12,
                                padding: "0 8px",
                              }}
                            >
                              <option value="">Reassign to...</option>
                              {operationalReassignCandidates.map((agent) => (
                                <option key={agent.id} value={agent.id}>{agent.name}</option>
                              ))}
                            </select>
                            <button type="button" onClick={() => void onOperationalReassign()} disabled={!operationalReassignAgentId} style={{ height: 30, padding: "0 10px", borderRadius: radius.sm, border: `0.5px solid ${color.border}`, background: color.surfaceElevated, color: operationalReassignAgentId ? color.text : color.textMuted, fontSize: 12, fontWeight: 700, cursor: operationalReassignAgentId ? "pointer" : "not-allowed" }}>
                              Reassign
                            </button>
                            <button type="button" onClick={() => void onOperationalReframe()} style={{ height: 30, padding: "0 10px", borderRadius: radius.sm, border: `0.5px solid ${color.border}`, background: color.surfaceElevated, color: color.text, fontSize: 12, fontWeight: 700 }}>
                              Reframe task
                            </button>
                            <button type="button" onClick={() => void onOperationalBacklog()} style={{ height: 30, padding: "0 10px", borderRadius: radius.sm, border: `0.5px solid ${color.border}`, background: color.surfaceElevated, color: color.text, fontSize: 12, fontWeight: 700 }}>
                              Mark backlog
                            </button>
                            <button type="button" onClick={() => void onOperationalUnblock()} style={{ height: 30, padding: "0 10px", borderRadius: radius.sm, border: `0.5px solid ${color.border}`, background: color.surfaceElevated, color: color.text, fontSize: 12, fontWeight: 700 }}>
                              Unblock as-is
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Description */}
            {task.description && (
              <div style={{
                fontSize: typeScale.body.size, color: color.textSecondary, lineHeight: 1.65,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
                paddingBottom: space.xl, borderBottom: `0.5px solid ${color.border}`,
              }}>
                <LinkedText text={task.description} companySlug={slug} taskKeyPrefix={taskKeyPrefix} />
              </div>
            )}

            {visibleLocalWorkingRun && (
              <TaskWorkingRunBanner
                agentName={visibleLocalWorkingRun.agentName}
                startedAt={visibleLocalWorkingRun.startedAt}
                provider={visibleLocalWorkingRun.provider}
                label={visibleLocalWorkingRun.label}
              />
            )}

            {execution?.state === "running" && assignedAgent && (
              <LiveActivityPanel
                agentName={assignedAgent.name}
                agentEmoji={assignedAgent.emoji}
                connected={liveActivityConnected}
                sessionId={execution.sessionId}
                streamText={liveAgentStream?.streamingText ?? ""}
                events={liveAgentStream?.events ?? []}
              />
            )}

            {/* Tabs */}
            <div style={{
              display: "flex", gap: "0", marginTop: "24px",
              borderBottom: `0.5px solid ${color.border}`,
            }}>
              {([
                ["comments", `Comments (${visibleComments.length})`, MessageSquare] as const,
                ["subtasks", "Subtasks", GitBranch] as const,
                ["activities", "Activity", Clock] as const,
              ]).map(([key, label, TabIcon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key as Tab)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "10px 16px", background: "transparent", border: "none",
                    borderBottom: activeTab === key ? `2px solid ${color.accent}` : "2px solid transparent",
                    marginBottom: "-1px", cursor: "pointer",
                    fontSize: typeScale.bodySmall.size, fontWeight: 500,
                    color: activeTab === key ? color.text : color.textMuted,
                  }}
                >
                  <TabIcon size={13} color={activeTab === key ? color.text : color.textMuted} />
                  {label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ paddingTop: "16px" }}>
              {activeTab === "activities" && (
                <div style={{ fontSize: "12px", color: color.textMuted }}>
                  {execution && execution.state !== "unknown" && execution.runId && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 12px", marginBottom: 12, borderRadius: radius.md,
                      border: `0.5px solid ${color.border}`, background: "rgba(255,255,255,0.02)",
                      fontSize: 11, color: color.textMuted,
                    }}>
                      <span style={{
                        width: 5, height: 5, borderRadius: "50%",
                        background: runStateColor,
                        animation: execution.state === "running" ? "pulse 1.5s ease-in-out infinite" : undefined,
                        flexShrink: 0,
                      }} />
                      <span style={{ fontWeight: 500 }}>
                        {runStateLabel}
                      </span>
                      <span style={{ fontFamily: font.mono, fontSize: 10 }}>{execution.runId.slice(0, 8)}</span>
                      {execution.sessionId && (
                        <span style={{ fontFamily: font.mono, fontSize: 10, color: color.textMuted }}>
                          session {execution.sessionId.slice(0, 8)}
                        </span>
                      )}
                    </div>
                  )}
                  {pendingLinkedApprovals.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        padding: "12px 14px",
                        marginBottom: 14,
                        borderRadius: 10,
                        border: "0.5px solid rgba(251,191,36,0.28)",
                        background: "rgba(251,191,36,0.08)",
                      }}
                    >
                      <AlertCircle size={15} color="#fbbf24" style={{ marginTop: 1, flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#fcd34d", marginBottom: 4 }}>
                          {pendingLinkedApprovals.length} approval{pendingLinkedApprovals.length === 1 ? "" : "s"} requested
                        </div>
                        <div style={{ fontSize: 12, color: color.textSecondary, lineHeight: 1.5 }}>
                          {assignedAgent?.name ?? "This agent"} finished the current pass and is waiting on operator review before these hires appear under Agents.
                        </div>
                        <div style={{ fontSize: 12, color: color.textMuted, marginTop: 6, lineHeight: 1.5 }}>
                          {pendingLinkedApprovals.map((approval) => {
                            const name = typeof approval.payload.name === "string" ? approval.payload.name : "Unnamed agent";
                            const role = typeof approval.payload.role === "string" ? approval.payload.role : approval.type;
                            return `${name} (${role})`;
                          }).join(" • ")}
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <Link
                            href={buildCompanyPath(slug, "/approvals/pending")}
                            style={{ color: "#fcd34d", fontSize: 12, fontWeight: 600, textDecoration: "none" }}
                          >
                            Review pending approvals
                          </Link>
                        </div>
                      </div>
                    </div>
                  )}
                  <ExecutionHistoryPanel
                    histories={runHistories}
                    loading={runHistoryLoading}
                    companySlug={slug}
                    taskKeyPrefix={taskKeyPrefix}
                    executionEngine={task.executionEngine}
                  />
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: color.text, marginBottom: 4 }}>
                      Unified timeline
                    </div>
                    <div style={{ fontSize: 11, color: color.textMuted, lineHeight: 1.5 }}>
                      This is the task event trail, merged from status changes, approvals, run lifecycle, and linked subtasks.
                    </div>
                  </div>
                  {activityLoading && visibleActivityTimeline.length === 0 ? (
                    <div style={{ padding: "16px 0", textAlign: "center", color: color.textMuted }}>Loading timeline...</div>
                  ) : visibleActivityTimeline.length === 0 ? (
                    <div style={{ padding: "16px 0", textAlign: "center", color: color.textMuted }}>No timeline activity recorded yet.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                      {taskDetail?.runSummary && (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingBottom: 12, marginBottom: 8, borderBottom: `0.5px solid ${color.border}` }}>
                          <span style={{ fontSize: 10, color: color.textMuted }}>Runs: {taskDetail.runSummary.totalRuns}</span>
                          <span style={{ fontSize: 10, color: color.textMuted }}>Actions: {taskDetail.runSummary.structuredActionCount}</span>
                          <span style={{ fontSize: 10, color: color.textMuted }}>Imported reports: {taskDetail.runSummary.importedReportCount}</span>
                          {taskDetail.runSummary.activeRun && (
                            <span style={{ fontSize: 10, color: "#f59e0b" }}>
                              Active: {formatRunProvider(
                                taskDetail.runSummary.activeRun.provider,
                                taskDetail.runSummary.activeRun.executionEngine ?? task.executionEngine,
                                taskDetail.runSummary.activeRun.runnerProvider,
                                taskDetail.runSummary.activeRun.runnerModel,
                              )} {taskDetail.runSummary.activeRun.status}
                            </span>
                          )}
                        </div>
                      )}
                      {visibleActivityTimeline.map((entry) => {
                        const tone = timelineTone(entry);
                        return (
                          <div
                            key={entry.id}
                            style={{
                              display: "flex", gap: "10px", padding: "10px 0",
                              borderBottom: `0.5px solid ${color.border}`,
                            }}
                          >
                            <div style={{ width: 24, flexShrink: 0, display: "flex", justifyContent: "center", paddingTop: 2 }}>
                              <span style={{
                                width: 22, height: 22, borderRadius: "50%",
                                background: tone.bg,
                                border: `0.5px solid ${tone.border}`,
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                color: tone.fg,
                              }}>
                                {timelineGlyph(entry)}
                              </span>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <span style={{
                                  fontSize: 10,
                                  color: tone.fg,
                                  background: tone.bg,
                                  border: `0.5px solid ${tone.border}`,
                                  borderRadius: 999,
                                  padding: "2px 6px",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.04em",
                                }}>
                                  {tone.label}
                                </span>
                                {entry.actorLabel && (
                                  <span style={{ fontWeight: 600, color: color.textSecondary, fontSize: 11 }}>{entry.actorLabel}</span>
                                )}
                                <span style={{ color: color.text, fontSize: 11 }}>{entry.summary}</span>
                                <span style={{ marginLeft: "auto", fontSize: 10, color: color.textMuted, flexShrink: 0 }} title={formatTimestamp(entry.timestamp)}>
                                  {relativeAge(entry.timestamp)}
                                </span>
                              </div>
                              {entry.body && entry.provenance !== "run_event" && entry.provenance !== "engine_event" && (
                                <div style={{
                                  marginTop: 6, padding: "8px 10px", borderRadius: 6,
                                  background: "rgba(255,255,255,0.02)",
                                  border: `0.5px solid ${color.border}`,
                                  fontSize: 11, color: color.textSecondary,
                                  lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word",
                                }}>
                                  <MarkdownText text={entry.body} companySlug={slug} taskKeyPrefix={taskKeyPrefix} />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {activeTab === "comments" && (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}>
                    {visibleComments.length === 0 ? (
                      <div style={{ padding: "16px 0", fontSize: "12px", color: color.textMuted, textAlign: "center" }}>
                        {pendingLinkedApprovals.length > 0
                          ? "Execution completed and is waiting on approval. Review the pending approvals to continue."
                          : "No comments yet."}
                      </div>
                    ) : (
                      visibleComments.map((c) => (
                        <div
                          key={c.id}
                          style={{
                            padding: "12px 14px", borderRadius: "8px",
                            border: isCircuitBreakerComment(c) ? "0.5px solid rgba(251,191,36,0.28)" : `0.5px solid ${color.border}`,
                            background: isCircuitBreakerComment(c) ? "rgba(251,191,36,0.06)" : color.surface,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                            {(() => {
                              const commentAgent = agents.find((a) => a.name === c.author || a.slug === c.author);
                              const avatarUrl = commentAgent ? resolveAvatar(commentAgent) : (getAgentByAnyId(c.author)?.avatar ?? undefined);
                              if (avatarUrl) {
                                return (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={avatarUrl} alt={c.author} style={{
                                    width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0,
                                  }} />
                                );
                              }
                              const emoji = commentAgent?.emoji;
                              return (
                                <span style={{
                                  width: 22, height: 22, borderRadius: "50%",
                                  background: emoji ? "rgba(217,119,6,0.18)" : "rgba(120,113,108,0.25)",
                                  border: emoji ? "none" : "0.5px solid rgba(120,113,108,0.15)",
                                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                                  fontSize: emoji ? 12 : 9, fontWeight: 700,
                                  color: emoji ? "#fbbf24" : color.textSecondary,
                                }}>
                                  {emoji ? <AvatarGlyph value={emoji} size={12} /> : assigneeInitials(c.author)}
                                </span>
                              );
                            })()}
                            <span style={{ fontSize: "12px", fontWeight: 600, color: color.text }}>{c.author}</span>
                            {c.source === "voice" && (
                              <span
                                title="Posted via Voice Chat"
                                style={{
                                  fontSize: "10px",
                                  fontWeight: 500,
                                  padding: "2px 7px",
                                  borderRadius: "10px",
                                  background: "rgba(217,119,6,0.14)",
                                  border: "0.5px solid rgba(217,119,6,0.28)",
                                  color: "#fbbf24",
                                  lineHeight: 1.2,
                                }}
                              >
                                Voice Chat
                              </span>
                            )}
                            {isCircuitBreakerComment(c) && (
                              <span
                                title="System status"
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 4,
                                  fontSize: "10px",
                                  fontWeight: 600,
                                  padding: "2px 7px",
                                  borderRadius: "10px",
                                  background: "rgba(251,191,36,0.12)",
                                  border: "0.5px solid rgba(251,191,36,0.24)",
                                  color: "#fbbf24",
                                  lineHeight: 1.2,
                                }}
                              >
                                <AlertCircle size={10} />
                                Awaiting human
                              </span>
                            )}
                            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: "11px", color: color.textMuted }} title={formatTimestamp(c.timestamp)}>
                                {relativeAge(c.timestamp)}
                              </span>
                              <button
                                type="button"
                                title="Reply to comment"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReplyToComment(c);
                                  setActiveTab("comments");
                                  requestAnimationFrame(() => commentTextareaRef.current?.focus());
                                }}
                                style={{
                                  background: "transparent", border: "none", cursor: "pointer",
                                  padding: 2, color: color.textMuted, opacity: 0.5,
                                  display: "inline-flex", alignItems: "center",
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
                              >
                                <MessageSquare size={11} />
                              </button>
                              <button
                                type="button"
                                title="Copy comment"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void navigator.clipboard.writeText(c.text);
                                }}
                                style={{
                                  background: "transparent", border: "none", cursor: "pointer",
                                  padding: 2, color: color.textMuted, opacity: 0.5,
                                  display: "inline-flex", alignItems: "center",
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
                              >
                                <Copy size={11} />
                              </button>
                            </span>
                          </div>
                          <div style={{ fontSize: "13px", color: color.textSecondary, wordBreak: "break-word", lineHeight: 1.5 }}>
                            <MarkdownText
                              text={isCircuitBreakerComment(c) ? formatCircuitBreakerComment(c.text) : c.text}
                              companySlug={slug}
                              taskKeyPrefix={taskKeyPrefix}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {/* Comment composer */}
                  <div style={{
                    border: `0.5px solid ${color.border}`, borderRadius: "8px",
                    background: color.surface, padding: "10px",
                  }}>
                    {replyToComment && (
                      <div
                        style={{
                          marginBottom: 8,
                          padding: "7px 9px",
                          borderRadius: 7,
                          border: `0.5px solid ${color.border}`,
                          background: color.surfaceElevated,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <MessageSquare size={12} color={color.textMuted} />
                        <div style={{ minWidth: 0, flex: 1, fontSize: 11, color: color.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          Replying to <span style={{ color: color.text, fontWeight: 600 }}>{replyToComment.author}</span>: {replyToComment.text}
                        </div>
                        <button
                          type="button"
                          onClick={() => setReplyToComment(null)}
                          style={{ border: "none", background: "transparent", color: color.textMuted, cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}
                          title="Cancel reply"
                        >
                          x
                        </button>
                      </div>
                    )}
                    <textarea
                      ref={commentTextareaRef}
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      onPaste={handleCommentPaste}
                      placeholder="Leave a comment..."
                      rows={3}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                          e.preventDefault();
                          void onSubmitComment();
                        }
                      }}
                      style={{
                        width: "100%", background: "transparent", border: "none", resize: "vertical",
                        color: color.text, fontSize: "13px", outline: "none", fontFamily: "inherit",
                        minHeight: "56px",
                      }}
                    />
                    {commentAttachments.length > 0 && (
                      <AttachmentDraftPreview
                        attachments={commentAttachments}
                        onRemove={(attachmentId) => {
                          setCommentAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
                        }}
                      />
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
                      {/* Attachment icon */}
                      <label
                        title={uploading ? "Uploading..." : "Attach or paste files"}
                        style={{
                          cursor: uploading ? "wait" : "pointer",
                          display: "inline-flex",
                          padding: "4px",
                          color: uploading ? color.accent : color.textMuted,
                        }}
                      >
                        <Link2 size={14} color={uploading ? color.accent : color.textMuted} />
                        <input
                          type="file"
                          multiple
                          style={{ display: "none" }}
                          disabled={uploading}
                          onChange={(e) => {
                            if (e.target.files) void appendCommentFiles(e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </label>

                      <div style={{ flex: 1 }} />

                      {/* Reply target picker */}
                      {agents.length > 0 && (
                        <div ref={replyPickerRef} style={{ position: "relative" }}>
                          <button
                            type="button"
                            onClick={() => setReplyPickerOpen((p) => !p)}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: "4px",
                              padding: "4px 8px", borderRadius: "6px", fontSize: "11px",
                              border: `0.5px solid ${replyTarget ? "rgba(217,119,6,0.4)" : color.border}`,
                              background: replyTarget ? "rgba(217,119,6,0.08)" : "transparent",
                              color: replyTarget ? color.accent : color.text,
                              cursor: "pointer",
                            }}
                          >
                            <AtSign size={11} />
                            {replyTarget
                              ? agents.find((a) => a.name === replyTarget || a.slug === replyTarget)?.name ?? replyTarget
                              : "Assign"}
                          </button>
                          {replyPickerOpen && (
                            <>
                              <div
                                style={{ position: "fixed", inset: 0, zIndex: 98 }}
                                onClick={() => setReplyPickerOpen(false)}
                              />
                              <div style={{
                                position: "absolute", bottom: "calc(100% + 4px)", right: 0,
                                background: "var(--surface-elevated)", border: `0.5px solid ${color.border}`,
                                borderRadius: 8, padding: "4px 0", minWidth: 160,
                                boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 99,
                              }}>
                                <button
                                  type="button"
                                  onClick={() => { setReplyTarget(null); setReplyPickerOpen(false); }}
                                  style={{
                                    display: "block", width: "100%", padding: "7px 12px",
                                    fontSize: 12, color: !replyTarget ? color.text : color.textSecondary,
                                    background: !replyTarget ? "rgba(255,255,255,0.05)" : "transparent",
                                    border: "none", cursor: "pointer", textAlign: "left",
                                  }}
                                >
                                  No assignment change
                                </button>
                                {agents.map((a) => {
                                  const selected = replyTarget === a.name;
                                  return (
                                    <button
                                      key={a.id}
                                      type="button"
                                      onClick={() => { setReplyTarget(a.name); setReplyPickerOpen(false); }}
                                      style={{
                                        display: "flex", alignItems: "center", gap: "6px",
                                        width: "100%", padding: "7px 12px",
                                        fontSize: 12, color: selected ? color.text : color.textSecondary,
                                        background: selected ? "rgba(255,255,255,0.05)" : "transparent",
                                        border: "none", cursor: "pointer", textAlign: "left",
                                      }}
                                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                                      onMouseLeave={(e) => { e.currentTarget.style.background = selected ? "rgba(255,255,255,0.05)" : "transparent"; }}
                                    >
                                      {(() => {
                                        const av = resolveAvatar(a);
                                        return av
                                          // eslint-disable-next-line @next/next/no-img-element
                                          ? <img src={av} alt="" style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                                          : <AvatarGlyph value={a.emoji} size={13} />;
                                      })()}
                                      {a.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* Re-open toggle — show when task is done or cancelled */}
                      {(task.status === "done" || task.status === "cancelled") && (
                        <label style={{
                          display: "inline-flex", alignItems: "center", gap: "5px",
                          fontSize: "11px", color: color.textSecondary, cursor: "pointer",
                          padding: "4px 8px", borderRadius: "6px",
                          border: `0.5px solid ${reopenOnComment ? "rgba(59,130,246,0.4)" : color.border}`,
                          background: reopenOnComment ? "rgba(59,130,246,0.08)" : "transparent",
                        }}>
                          <input
                            type="checkbox"
                            checked={reopenOnComment}
                            onChange={(e) => setReopenOnComment(e.target.checked)}
                            style={{
                              appearance: "none",
                              WebkitAppearance: "none",
                              width: 13, height: 13, borderRadius: 3, flexShrink: 0,
                              border: `1.5px solid ${reopenOnComment ? "#3b82f6" : "rgba(120,113,108,0.5)"}`,
                              background: reopenOnComment ? "#3b82f6" : "transparent",
                              cursor: "pointer",
                            }}
                          />
                          <RotateCcw size={11} />
                          Re-open
                        </label>
                      )}

                      <span style={{ fontSize: "10px", color: color.text }}>
                        ⌘ + Enter
                      </span>
                      <button
                        type="button"
                        onClick={() => setVoiceModalOpen(true)}
                        disabled={!voiceLaunchAgent}
                        title={voiceLaunchAgent?.name
                          ? `Talk to ${voiceLaunchAgent.name} about this task`
                          : "Assign an agent to talk about this task"}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: "5px",
                          padding: "6px 12px", fontSize: "12px", fontWeight: 600,
                          background: color.surfaceElevated,
                          color: voiceLaunchAgent ? color.accent : color.textSecondary,
                          border: `0.5px solid ${voiceLaunchAgent ? "rgba(217,119,6,0.24)" : color.border}`,
                          borderRadius: "6px",
                          cursor: voiceLaunchAgent ? "pointer" : "not-allowed",
                        }}
                      >
                        <Mic size={12} />
                        Talk
                      </button>
                      <button
                        type="button"
                        onClick={() => void onSubmitComment()}
                        disabled={!commentCanSubmit}
                        style={{
                          padding: "6px 12px", fontSize: "12px", fontWeight: 600,
                          background: commentCanSubmit ? color.surfaceHover : color.surfaceElevated,
                          color: commentCanSubmit ? color.text : color.textSecondary,
                          border: `0.5px solid ${color.border}`, borderRadius: "6px",
                          cursor: commentCanSubmit ? "pointer" : "default",
                        }}
                      >
                        {posting ? "Posting…" : "Comment"}
                      </button>
                    </div>
                  </div>
                </>
              )}
              {activeTab === "subtasks" && (
                <div>
                  {/* Header row with "Add subtask" button. Always visible on this
                      tab, including the empty state, so operators have a
                      one-click entry point. */}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                    <button
                      type="button"
                      onClick={() => setCreateSubtaskOpen(true)}
                      disabled={!task}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "4px 10px",
                        fontSize: 12, fontWeight: 500,
                        color: task ? color.text : color.textMuted,
                        background: "rgba(255,255,255,0.04)",
                        border: `0.5px solid ${color.border}`,
                        borderRadius: 6,
                        cursor: task ? "pointer" : "default",
                      }}
                    >
                      <Plus size={12} />
                      Add subtask
                    </button>
                  </div>

                  {taskDetail?.childTasks && taskDetail.childTasks.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {taskDetail.childTasks.map((child) => (
                        <Link
                          key={child.id}
                          href={buildCompanyPath(slug, `/tasks/${encodeURIComponent(child.key ?? child.id)}`)}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                            padding: "10px 12px", borderRadius: 8, textDecoration: "none",
                            border: `0.5px solid ${color.border}`, background: "rgba(255,255,255,0.02)",
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: color.textSecondary }}>
                              {child.key ? `${child.key} · ${child.title}` : child.title}
                            </div>
                            <div style={{ fontSize: 11, color: color.textMuted }}>
                              {STATUS_LABEL[child.status] ?? child.status} · {child.priority} · {child.assignee ?? "Unassigned"}
                            </div>
                          </div>
                          <div style={{ fontSize: 10, color: color.textMuted, flexShrink: 0 }}>
                            {relativeAge(child.updated)}
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: "24px 0", fontSize: "12px", color: color.textMuted, textAlign: "center" }}>
                      No sub-tasks. Click “Add subtask” to create one under this task.
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Properties panel ── */}
      {propsOpen && task && (
        <aside className="task-detail-scrollbarless" style={{
          width: compactLayout ? "auto" : 280,
          flexShrink: 0,
          alignSelf: compactLayout ? "stretch" : "flex-start",
          position: compactLayout ? "static" : "sticky",
          top: compactLayout ? undefined : space.lg,
          margin: compactLayout ? `0 ${space.lg}px ${space.lg}px` : `${space.lg}px ${space.lg}px ${space.lg}px 0`,
          padding: `${space.xl}px ${space.xl}px`,
          overflow: "visible",
          background: color.surface,
          border: `0.5px solid ${color.border}`,
          borderRadius: radius.lg,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: color.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Properties
            </div>
            <button
              type="button"
              onClick={() => setPropsOpen(false)}
              style={{ background: "transparent", border: "none", color: color.textMuted, cursor: "pointer", padding: "2px" }}
              title="Close properties"
            >
              ×
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* Status */}
            <PropertyRow label="Status">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <InlineStatusPicker
                  current={task.status}
                  onChange={(s) => onStatusChange(task.id, s)}
                />
                <span style={{ fontSize: "12px", color: color.text }}>
                  {statusMeta?.label ?? STATUS_LABEL[task.status]}
                </span>
              </div>
            </PropertyRow>

            {/* Priority */}
            <PropertyRow label="Priority">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <InlinePriorityPicker
                  current={task.priority}
                  onChange={(p) => onPriorityChange(task.id, p)}
                />
              </div>
            </PropertyRow>

            {/* Tags */}
            <PropertyRow label="Tags">
              <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", fontSize: "12px", color: color.textSecondary, minWidth: 0 }}>
                <Tag size={12} />
                <InlineTagsEditor tags={task.tags ?? []} onChange={(tags) => onTagsChange(task.id, tags)} />
              </div>
            </PropertyRow>

            {/* Assignee */}
            <PropertyRow label={useAgentOfRecord ? "Agent of record" : "Assignee"}>
              {useAgentOfRecord ? (
                <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: color.text, minWidth: 0 }}>
                    {voiceLaunchAgent ? <AgentAvatarInline agent={voiceLaunchAgent} size={18} /> : null}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {voiceLaunchAgent?.name ?? taskAgentDisplayLabel(task) ?? "Unassigned"}
                    </span>
                  </span>
                  {currentAssigneeAgent && currentAssigneeAgent.id !== voiceLaunchAgent?.id ? (
                    <span style={{ color: color.textMuted, fontSize: 11 }}>
                      Reviewed by {currentAssigneeAgent.name}
                    </span>
                  ) : null}
                </div>
              ) : (
                <InlineAssigneePicker
                  current={task.assignee}
                  agents={agents}
                  onChange={(a) => onAssigneeChange(task.id, a)}
                />
              )}
            </PropertyRow>

            {/* Project */}
            <PropertyRow label="Project">
              {project ? (
                <Link
                  href={`/${encodeURIComponent(companyCode.toUpperCase())}/projects/${encodeURIComponent(project.slug)}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: color.text, textDecoration: "none" }}
                >
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: project.color }} />
                  {project.name}
                  <ExternalLink size={11} color={color.textMuted} />
                </Link>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: color.textSecondary }}>
                  <Folder size={12} /> —
                </span>
              )}
            </PropertyRow>

            <ExecutionEnvironmentPanel
              task={task}
              planned={plannedExecution}
              active={activeResolvedExecution}
              latest={latestResolvedExecution}
              onOverrideChange={onExecutionOverrideChange}
            />

            {/* Divider */}
            <div style={{ height: "1px", background: color.border, margin: "4px 0" }} />

            {/* Created by */}
            <PropertyRow label="Created by">
              <span
                title={createdByDisplay.title}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  minWidth: 0,
                  maxWidth: "100%",
                  fontSize: "12px",
                  color: color.textMuted,
                }}
              >
                {createdByDisplay.kind === "agent" ? (
                  <Bot size={12} style={{ flexShrink: 0 }} />
                ) : createdByDisplay.kind === "user" ? (
                  <User size={12} style={{ flexShrink: 0 }} />
                ) : (
                  <Activity size={12} style={{ flexShrink: 0 }} />
                )}
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {createdByDisplay.label}
                </span>
              </span>
            </PropertyRow>

            {/* Created */}
            <PropertyRow label="Created">
              <span style={{ fontSize: "12px", color: color.textMuted }}>{formatShortDate(task.created)}</span>
            </PropertyRow>

            {/* Updated */}
            <PropertyRow label="Updated">
              <span style={{ fontSize: "12px", color: color.textMuted }}>{relativeAge(task.updated)}</span>
            </PropertyRow>

            {/* Completed at */}
            {task.completedAt && (
              <PropertyRow label="Completed at">
                <span style={{ fontSize: "12px", color: color.textMuted }}>{formatShortDate(task.completedAt)}</span>
              </PropertyRow>
            )}

            {showPlannedExecution && plannedExecution && (
              <>
                <div style={{ height: "1px", background: color.border, margin: "4px 0" }} />
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: color.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Pre-execution route
                  </div>
                  <div style={{ fontSize: "12px", color: color.textMuted, lineHeight: 1.45 }}>
                    Will run on {plannedRuntime ?? "runtime managed"}{plannedModel ? ` (${plannedModel})` : ""} via {plannedLaneLabel} of the {plannedExecution.activeHiveName ?? "active"} hive.
                    {" "}
                    {plannedFallbacks.length > 0 ? `Falls back to: ${plannedFallbacks.join(" -> ")}.` : "No fallback configured."}
                  </div>
                </div>
              </>
            )}

            {runUsageSummary && (
              <>
                <div style={{ height: "1px", background: color.border, margin: "4px 0" }} />
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: color.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Run Usage
                  </div>
                  <PropertyRow label="Runs">
                    <span style={{ fontSize: "12px", color: color.textMuted }}>{runUsageSummary.runs}</span>
                  </PropertyRow>
                  {runUsageSummary.latest && (
                    <PropertyRow label="Latest">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap", fontSize: "12px", color: runUsageSummary.latest.status === "failed" ? "#fca5a5" : color.textMuted, fontWeight: runUsageSummary.latest.status === "failed" ? 700 : 500 }}>
                        <span>
                          {formatTaskRunProvider(
                            runUsageSummary.latest.provider,
                            runUsageSummary.latest.executionEngine ?? task.executionEngine,
                            runUsageSummary.latest.runnerProvider,
                            runUsageSummary.latest.runnerModel,
                          )} {runUsageSummary.latest.status}
                        </span>
                        {runUsageSummary.latest.fallbackUsed ? (
                          <span
                            title={`Fallback ${typeof runUsageSummary.latest.fallbackIndex === "number" ? runUsageSummary.latest.fallbackIndex + 1 : ""}${runUsageSummary.latest.fallbackFromProvider ? ` from ${runUsageSummary.latest.fallbackFromProvider}` : ""}`}
                            style={{ border: `0.5px solid ${color.border}`, borderRadius: 999, padding: "1px 6px", color: color.warning }}
                          >
                            fallback
                          </span>
                        ) : null}
                      </span>
                    </PropertyRow>
                  )}
                  {runUsageSummary.active && (
                    <PropertyRow label="Active">
                      <span style={{ fontSize: "12px", color: "#f59e0b", fontWeight: 600 }}>
                        {formatTaskRunProvider(
                          runUsageSummary.active.provider,
                          runUsageSummary.active.executionEngine ?? task.executionEngine,
                          runUsageSummary.active.runnerProvider,
                          runUsageSummary.active.runnerModel,
                        )} {runUsageSummary.active.status}
                      </span>
                    </PropertyRow>
                  )}
                  <PropertyRow label="Input">
                    <span style={{ fontSize: "12px", color: color.textMuted }}>{formatCompactNumber(runUsageSummary.totals.inputTokens)}</span>
                  </PropertyRow>
                  <PropertyRow label="Output">
                    <span style={{ fontSize: "12px", color: color.textMuted }}>{formatCompactNumber(runUsageSummary.totals.outputTokens)}</span>
                  </PropertyRow>
                  <PropertyRow label="Cache">
                    <span style={{ fontSize: "12px", color: color.textMuted }}>
                      {formatCompactNumber(runUsageSummary.totals.cacheReadInputTokens)} read / {formatCompactNumber(runUsageSummary.totals.cacheCreationInputTokens)} write
                    </span>
                  </PropertyRow>
                  <PropertyRow label="Cost">
                    <span style={{ fontSize: "12px", color: color.textMuted }}>{formatUsd(runUsageSummary.totals.totalCostUsd)}</span>
                  </PropertyRow>
                </div>
              </>
            )}
          </div>
        </aside>
      )}

      {/* Reopen panel button if closed */}
      {!propsOpen && task && (
        <button
          type="button"
          onClick={() => setPropsOpen(true)}
          style={{
            position: "absolute", right: "16px", top: "80px",
            padding: "6px 10px", fontSize: "11px", color: color.textSecondary,
            background: "rgba(41,37,36,0.5)", border: `0.5px solid ${color.border}`, borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Show properties
        </button>
      )}

      {voiceBindingRequest && (
        <TaskVoiceModal
          open={voiceModalOpen}
          onClose={() => setVoiceModalOpen(false)}
          agent={voiceLaunchAgent}
          bindingRequest={voiceBindingRequest}
          taskTitle={task?.title}
          projectName={project?.name}
          onSessionEnd={() => {
            if (!task) return;
            const taskId = task.id;
            // Server-side persist runs async; give it a moment, then refresh.
            setTimeout(() => {
              void (async () => {
                const refreshed = await listTaskComments(taskId);
                setComments(refreshed);
                const refreshedDetail = await getTaskDetail(taskId);
                if (refreshedDetail) setActivityTimeline(refreshedDetail.detail.timeline);
              })();
            }, 1200);
          }}
        />
      )}

      {task && project && (
        <CreateTaskModal
          open={createSubtaskOpen}
          onClose={() => setCreateSubtaskOpen(false)}
          onCreated={() => {
            // Subtask just landed; refresh the task detail so the
            // Subtasks tab shows the new child immediately.
            void loadTask();
          }}
          companySlug={slug}
          companyCode={companyCode}
          companyName={company?.name ?? companyCode}
          parentContext={{
            taskId: task.id,
            taskKey: task.key,
            title: task.title,
            projectId: project.id,
          }}
        />
      )}
    </div>
  );
}

function transcriptEntryLabel(entry: RunTranscriptEntry): string {
  const kind = entry.eventKind ?? entry.type ?? "";
  if (entry.title) return entry.title;
  switch (kind) {
    case "run_start":
      return "Run started";
    case "run_end":
      return "Run completed";
    case "tool_call_start":
      return "Tool call";
    case "tool_result":
      return "Tool result";
    case "assistant_text_final":
      return "Assistant output";
    case "thinking_summary":
      return "Reasoning summary";
    default:
      return kind ? kind.replace(/_/g, " ") : "Transcript event";
  }
}

function runSkillEventLabel(event: RunSkillEffectivenessEvent): string {
  if (event.eventType === "available") return "seen";
  if (event.eventType === "explicit_use") return "used";
  return event.outcome ?? "review";
}

function runSkillEventColor(event: RunSkillEffectivenessEvent): string {
  if (event.eventType === "explicit_use") return color.info;
  if (event.eventType === "review_outcome" && event.outcome === "pass") return color.positive;
  if (event.eventType === "review_outcome") return color.negative;
  return color.textMuted;
}

function RunSkillEffectivenessInline({ skillEffectiveness }: { skillEffectiveness?: RunSkillEffectiveness }) {
  if (!skillEffectiveness || skillEffectiveness.events.length === 0) return null;
  const issueCount = skillEffectiveness.totals.failCount + skillEffectiveness.totals.blockedCount;
  return (
    <div
      style={{
        marginBottom: 10,
        padding: "9px 10px",
        borderRadius: radius.sm,
        border: `0.5px solid ${color.border}`,
        background: "rgba(255,255,255,0.018)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 7 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: color.text }}>Runtime skills</span>
        <span style={{ fontSize: 10, color: color.textMuted }}>{skillEffectiveness.totals.availableCount} seen</span>
        <span style={{ fontSize: 10, color: color.textMuted }}>{skillEffectiveness.totals.explicitUseCount} used</span>
        <span style={{ fontSize: 10, color: color.textMuted }}>{skillEffectiveness.totals.passCount} passed</span>
        {issueCount > 0 && <span style={{ fontSize: 10, color: color.negative }}>{issueCount} need work</span>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {skillEffectiveness.events.slice(0, 8).map((event) => (
          <span
            key={event.id}
            title={event.note ?? undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              maxWidth: "100%",
              padding: "2px 6px",
              borderRadius: 999,
              border: `0.5px solid ${color.border}`,
              background: color.surface,
              color: color.textSecondary,
              fontSize: 10,
            }}
          >
            <span style={{ color: runSkillEventColor(event), fontWeight: 700 }}>{runSkillEventLabel(event)}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {event.skillName}{event.skillVersion !== null ? ` v${event.skillVersion}` : ""}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ExecutionHistoryPanel({
  histories,
  loading,
  companySlug,
  taskKeyPrefix,
  executionEngine,
}: {
  histories: RunHistory[];
  loading: boolean;
  companySlug: string;
  taskKeyPrefix: string;
  executionEngine?: string | null;
}) {
  if (loading && histories.length === 0) {
    return (
      <div style={{ marginBottom: 16, fontSize: 12, color: color.textMuted }}>
        Loading execution history…
      </div>
    );
  }
  if (histories.length === 0) return null;

  return (
    <details
      style={{
        marginBottom: 18,
        border: `0.5px solid ${color.border}`,
        borderRadius: radius.md,
        background: "rgba(255,255,255,0.02)",
        overflow: "hidden",
      }}
    >
      <summary
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 14px",
          cursor: "pointer",
          listStyle: "none",
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <ChevronDown size={13} color={color.textMuted} />
          <span style={{ fontSize: 13, fontWeight: 700, color: color.text }}>Execution history</span>
        </div>
        <span style={{ fontSize: 11, color: color.textMuted }}>
          {histories.length} run{histories.length === 1 ? "" : "s"}
        </span>
      </summary>

      <div style={{ display: "grid", gap: 0, borderTop: `0.5px solid ${color.border}` }}>
        {histories.map((history, index) => (
          <details key={history.id} style={{ borderBottom: index < histories.length - 1 ? `0.5px solid ${color.border}` : "none" }}>
            <summary
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "11px 14px",
                cursor: "pointer",
                listStyle: "none",
                color: color.textSecondary,
              }}
            >
              <ChevronDown size={13} color={color.textMuted} />
              <span style={{ fontSize: 12, fontWeight: 700, color: color.text }}>
                {formatRunProvider(
                  history.providerId,
                  history.executionEngine ?? executionEngine,
                  history.runnerProvider,
                  history.runnerModel,
                )} {history.status === "succeeded" ? "completed" : history.status}
              </span>
              {history.fallbackUsed ? (
                <span
                  title={`Fallback ${typeof history.fallbackIndex === "number" ? history.fallbackIndex + 1 : ""}${history.fallbackFromProvider ? ` from ${history.fallbackFromProvider}` : ""}`}
                  style={{ border: `0.5px solid ${color.border}`, borderRadius: 999, padding: "1px 6px", color: color.warning, fontSize: 10, fontWeight: 700 }}
                >
                  fallback
                </span>
              ) : null}
              <span style={{ fontSize: 11, color: color.textMuted }}>{formatDuration(history.durationMs)}</span>
              <span style={{ fontSize: 11, color: color.textMuted }}>
                {history.startedAt ? formatTimestamp(history.startedAt) : history.id.slice(0, 8)}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: color.textMuted, fontFamily: font.mono }}>
                {history.id.slice(0, 8)}
              </span>
            </summary>
            <div style={{ padding: "0 14px 14px" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <span style={{ fontSize: 10, color: color.textMuted }}>Input {formatCompactNumber(history.metrics?.inputTokens)}</span>
                <span style={{ fontSize: 10, color: color.textMuted }}>Output {formatCompactNumber(history.metrics?.outputTokens)}</span>
                <span style={{ fontSize: 10, color: color.textMuted }}>Cache read {formatCompactNumber(history.metrics?.cacheReadInputTokens)}</span>
                <span style={{ fontSize: 10, color: color.textMuted }}>Cache write {formatCompactNumber(history.metrics?.cacheCreationInputTokens)}</span>
                {typeof history.metrics?.totalCostUsd === "number" && (
                  <span style={{ fontSize: 10, color: color.textMuted }}>${history.metrics.totalCostUsd.toFixed(3)}</span>
                )}
              </div>

              {history.resolvedExecution && (
                <ExecutionContextInline context={history.resolvedExecution} />
              )}

              <RunMemoryEvidenceInline evidence={history.memoryEvidence} />

              {history.routeAttempts && history.routeAttempts.length > 0 ? (
                <details
                  style={{
                    marginBottom: 10,
                    border: `0.5px solid ${color.border}`,
                    borderRadius: radius.sm,
                    background: color.surface,
                    overflow: "hidden",
                  }}
                >
                  <summary style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: "pointer", listStyle: "none" }}>
                    <ChevronDown size={12} color={color.textMuted} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: color.text }}>Route attempts</span>
                    <span style={{ fontSize: 10, color: color.textMuted }}>{history.routeAttempts.length} attempt{history.routeAttempts.length === 1 ? "" : "s"}</span>
                  </summary>
                  <pre
                    style={{
                      margin: 0,
                      borderTop: `0.5px solid ${color.border}`,
                      padding: "9px 10px",
                      maxHeight: 180,
                      overflow: "auto",
                      color: color.textSecondary,
                      fontFamily: font.mono,
                      fontSize: 10,
                      lineHeight: 1.45,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {JSON.stringify(history.routeAttempts, null, 2)}
                  </pre>
                </details>
              ) : null}

              <RunSkillEffectivenessInline skillEffectiveness={history.skillEffectiveness} />

              <div style={{ display: "grid", gap: 8 }}>
                {history.transcriptEntries.length === 0 ? (
                  <div style={{ fontSize: 12, color: color.textMuted, padding: "6px 0" }}>
                    No transcript events were recorded for this run.
                  </div>
                ) : (
                  history.transcriptEntries.map((entry) => (
                    <details
                      key={entry.id}
                      style={{
                        border: `0.5px solid ${color.border}`,
                        borderRadius: radius.sm,
                        background: color.surface,
                        overflow: "hidden",
                      }}
                    >
                      <summary style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: "pointer", listStyle: "none" }}>
                        <ChevronDown size={12} color={color.textMuted} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: color.text }}>{transcriptEntryLabel(entry)}</span>
                        {(entry.eventKind ?? entry.type) && (
                          <span style={{ fontSize: 10, color: color.textMuted, fontFamily: font.mono }}>
                            {entry.eventKind ?? entry.type}
                          </span>
                        )}
                        {entry.ts && (
                          <span style={{ marginLeft: "auto", fontSize: 10, color: color.textMuted }}>
                            {relativeAge(new Date(entry.ts).toISOString())}
                          </span>
                        )}
                      </summary>
                      {entry.body && (
                        <div
                          style={{
                            borderTop: `0.5px solid ${color.border}`,
                            padding: "9px 10px",
                            maxHeight: 220,
                            overflow: "auto",
                            fontSize: 12,
                            lineHeight: 1.5,
                            color: color.textSecondary,
                            wordBreak: "break-word",
                          }}
                        >
                          <MarkdownText text={entry.body} companySlug={companySlug} taskKeyPrefix={taskKeyPrefix} />
                        </div>
                      )}
                    </details>
                  ))
                )}
              </div>
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}

function RunMemoryEvidenceInline({ evidence }: { evidence?: RunMemoryEvidence }) {
  if (!evidence || evidence.evidence.length === 0) return null;
  const label = evidence.injectionSource === "vault_index"
    ? "Vault-backed records"
    : evidence.injectionSource === "memory_registry_fallback"
      ? "Registry fallback records"
      : "Recorded memory evidence";
  return (
    <details
      style={{
        marginBottom: 10,
        border: `0.5px solid ${color.border}`,
        borderRadius: radius.sm,
        background: color.surfaceElevated,
        overflow: "hidden",
      }}
    >
      <summary style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: "pointer", listStyle: "none" }}>
        <ChevronDown size={12} color={color.textMuted} />
        <span style={{ fontSize: 11, fontWeight: 700, color: color.text }}>Memory evidence</span>
        <span style={{ fontSize: 10, color: color.textMuted }}>
          {evidence.evidence.length} {evidence.evidence.length === 1 ? "record" : "records"} · {label}
        </span>
        {evidence.run?.injectedMemorySha256 ? (
          <span
            title={evidence.run.injectedMemorySha256}
            style={{ marginLeft: "auto", fontFamily: font.mono, fontSize: 10, color: color.textMuted }}
          >
            {evidence.run.injectedMemorySha256.slice(0, 10)}
          </span>
        ) : null}
      </summary>
      <div style={{ borderTop: `0.5px solid ${color.border}`, display: "grid", gap: 0 }}>
        {evidence.evidence.map((record, index) => (
          <div
            key={`${record.recordId}-${index}`}
            style={{
              padding: "9px 10px",
              borderTop: index === 0 ? "none" : `0.5px solid ${color.border}`,
              display: "grid",
              gap: 5,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              <span
                style={{
                  border: `0.5px solid ${color.border}`,
                  borderRadius: 999,
                  padding: "1px 6px",
                  color: color.accent,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "capitalize",
                }}
              >
                {record.layer}
              </span>
              <span
                title={record.title}
                style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: color.text, fontSize: 12, fontWeight: 700 }}
              >
                {record.title}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: color.textMuted, fontFamily: font.mono }}>
                {record.source?.type === "company_memory_record" ? "registry" : "vault"}
              </span>
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.4, color: color.textSecondary }}>
              Why included: {record.reason}
            </div>
            {record.sourcePath ? (
              <div title={record.sourcePath} style={{ fontSize: 10, color: color.textMuted, fontFamily: font.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {record.sourcePath}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function ExecutionContextInline({ context }: { context: OrchestrationResolvedExecutionContext }) {
  const rows = [
    { label: "Mode", value: formatExecutionEngineLabel(context.executionEngine) },
    { label: "Runtime", value: runtimeForExecutionContext(context) ?? "" },
    { label: "Model source", value: context.modelRoutingLabel ?? inferModelSource(context.runnerProvider ?? context.provider, modelForExecutionContext(context)) ?? "" },
    { label: "Model", value: modelForExecutionContext(context) ?? "" },
    { label: "Route", value: context.modelRoutingLabel ?? "" },
    ...displayExecutionContext(context).filter((row) => row.label !== "Command"),
  ].filter((row) => row.value.trim().length > 0);
  if (rows.length === 0) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 8,
        marginBottom: 10,
        padding: 10,
        borderRadius: radius.sm,
        border: `0.5px solid ${color.border}`,
        background: color.surfaceElevated,
      }}
    >
      {rows.map((row) => (
        <div key={row.label} style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: color.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>
            {row.label}
          </div>
          <div
            title={row.value}
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: color.textSecondary,
              fontFamily: row.mono ? font.mono : font.body,
              fontSize: row.mono ? 10 : 11,
            }}
          >
            {row.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExecutionEnvironmentPanel({
  task,
  planned,
  active,
  latest,
  onOverrideChange,
}: {
  task: OrchestrationTask;
  planned?: OrchestrationResolvedExecutionContext | null;
  active?: OrchestrationResolvedExecutionContext | null;
  latest?: OrchestrationResolvedExecutionContext | null;
  onOverrideChange: (patch: Partial<TaskExecutionOverridePatch>) => void;
}) {
  const [open, setOpen] = useState(false);
  const primarySection = active
    ? { title: "This run is using", context: active }
    : latest
      ? { title: "Latest run used", context: latest }
      : planned
        ? { title: "Configured to use", context: planned }
        : null;

  if (!primarySection) return null;

  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} style={{ display: "grid", gap: 10 }}>
      <summary
        style={{
          listStyle: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          cursor: "pointer",
          fontSize: "11px",
          fontWeight: 600,
          color: color.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          userSelect: "none",
        }}
      >
        <span>Runner detail</span>
        {open ? (
          <ChevronDown size={12} color={color.textMuted} />
        ) : (
          <ChevronRight size={12} color={color.textMuted} />
        )}
      </summary>
      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        <ExecutionContextMini title={primarySection.title} context={primarySection.context} />
        <TaskExecutionOverrideControls task={task} onChange={onOverrideChange} />
      </div>
    </details>
  );
}

function TaskExecutionOverrideControls({
  task,
  onChange,
}: {
  task: OrchestrationTask;
  onChange: (patch: Partial<TaskExecutionOverridePatch>) => void;
}) {
  const selectStyle: React.CSSProperties = {
    width: "100%",
    minWidth: 0,
    border: `0.5px solid ${color.border}`,
    borderRadius: radius.sm,
    background: color.surface,
    color: color.textSecondary,
    fontSize: 11,
    padding: "6px 8px",
    outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 9,
    color: color.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };
  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        padding: "9px 10px",
        borderRadius: radius.md,
        border: `0.5px solid ${color.border}`,
        background: color.surfaceElevated,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: color.text }}>Task override</span>
        <span style={{ fontSize: 10, color: color.textMuted }}>
          {task.executionRoutingSource === "task" || task.executionEngineSource === "task" ? "Task" : "Inherited"}
        </span>
      </div>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={labelStyle}>Mode</span>
        <select
          value={task.executionEngineOverride ?? ""}
          onChange={(event) => onChange({ executionEngine: event.target.value ? event.target.value as OrchestrationTask["executionEngine"] : null })}
          style={selectStyle}
        >
          <option value="">Inherit</option>
          <option value="symphony">Symphony</option>
          <option value="hiverunner">HiveRunner Native</option>
          <option value="manual">Manual / Operator Controlled</option>
        </select>
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={labelStyle}>Runtime</span>
        <select
          value={task.executionRuntimeProvider ?? ""}
          onChange={(event) => {
            const option = TASK_RUNTIME_OPTIONS.find((item) => item.value === event.target.value);
            onChange({
              executionRuntimeProvider: event.target.value || null,
              executionRuntimeLabel: event.target.value ? option?.label ?? event.target.value : null,
            });
          }}
          style={selectStyle}
        >
          {TASK_RUNTIME_OPTIONS.map((option) => (
            <option key={option.value || "inherit"} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={labelStyle}>Model routing</span>
        <select
          value={task.executionModelRouting ?? ""}
          onChange={(event) => {
            const option = TASK_MODEL_ROUTING_OPTIONS.find((item) => item.value === event.target.value);
            onChange({
              executionModelRouting: event.target.value || null,
              executionModelRoutingLabel: event.target.value ? option?.label ?? event.target.value : null,
            });
          }}
          style={selectStyle}
        >
          {TASK_MODEL_ROUTING_OPTIONS.map((option) => (
            <option key={option.value || "inherit"} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ExecutionContextMini({
  title,
  context,
}: {
  title: string;
  context: OrchestrationResolvedExecutionContext;
}) {
  const rows = displayExecutionContext(context);
  const stack = stackForExecutionContext(context);
  if (rows.length === 0 && stack.length === 0) return null;

  return (
    <div
      style={{
        display: "grid",
        gap: 7,
        padding: "9px 10px",
        borderRadius: radius.md,
        border: `0.5px solid ${color.border}`,
        background: color.surfaceElevated,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: color.text }}>
        {title}
      </div>
      <ExecutionStackPath context={context} />
      {context.executionEngine === "manual" ? (
        <div
          style={{
            padding: "7px 8px",
            borderRadius: radius.sm,
            border: `0.5px solid ${color.border}`,
            background: color.surface,
            color: color.textMuted,
            fontSize: 11,
            lineHeight: 1.45,
          }}
        >
          Manual / Operator Controlled: no autonomous runtime will run this task.
        </div>
      ) : null}
      {rows.map((row) => (
        <div key={`${title}:${row.label}`} style={{ display: "grid", gridTemplateColumns: "64px minmax(0, 1fr)", gap: 8 }}>
          <span style={{ fontSize: 10, color: color.textMuted }}>{row.label}</span>
          <span
            title={row.value}
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: row.mono ? font.mono : font.body,
              fontSize: row.mono ? 10 : 11,
              color: color.textSecondary,
            }}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function ExecutionStackPath({ context }: { context: OrchestrationResolvedExecutionContext }) {
  const stack = stackForExecutionContext(context);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {stack.map((row, index) => (
        <div key={`${row.label}:${index}`} style={{ display: "grid", gridTemplateColumns: "62px minmax(0, 1fr)", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: color.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {row.label}
          </span>
          <span
            title={row.value}
            style={{
              display: "inline-flex",
              alignItems: "center",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              width: "fit-content",
              maxWidth: "100%",
              padding: "3px 7px",
              borderRadius: radius.full,
              border: `0.5px solid ${row.label === "Mode" && context.executionEngine === "symphony" ? color.accent : color.border}`,
              background: row.label === "Mode" && context.executionEngine === "symphony" ? color.accentSoft : color.surface,
              color: row.muted ? color.textMuted : row.label === "Mode" && context.executionEngine === "symphony" ? color.accent : color.textSecondary,
              fontSize: 11,
              fontWeight: row.label === "Mode" ? 700 : 600,
            }}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <div style={{ width: "72px", fontSize: "11px", color: color.textMuted, flexShrink: 0 }}>
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

function TaskWorkingRunBanner({
  agentName,
  startedAt,
  provider,
  label,
}: {
  agentName: string;
  startedAt?: string;
  provider?: string;
  label: "waking" | "working";
}) {
  const actionText = label === "waking" ? "is waking up" : "is working";
  return (
    <div
      style={{
        marginTop: space.lg,
        borderRadius: radius.md,
        border: "0.5px solid rgba(59,130,246,0.5)",
        background: "rgba(59,130,246,0.075)",
        color: color.text,
        display: "grid",
        gridTemplateColumns: "26px 16px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        fontSize: 13,
      }}
    >
      <span style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: `0.5px solid ${color.border}`, color: color.textMuted, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <Bot size={14} />
      </span>
      <span style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(59,130,246,0.3)", borderTopColor: color.info, display: "inline-block" }} />
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <strong style={{ fontWeight: 700 }}>{agentName}</strong> {actionText}
        {startedAt ? <span style={{ color: color.textMuted, marginLeft: 8 }}>{relativeAge(startedAt)}</span> : null}
      </span>
      {provider && <span style={{ color: color.textMuted, fontSize: 12, whiteSpace: "nowrap" }}>{formatRunProvider(provider)}</span>}
    </div>
  );
}

function LiveActivityPanel({
  agentName,
  agentEmoji,
  connected,
  sessionId,
  streamText,
  events,
}: {
  agentName: string;
  agentEmoji?: string;
  connected: boolean;
  sessionId?: string;
  streamText: string;
  events: StreamTranscriptEntry[];
}) {
  const renderedEvents = events.slice(-8).reverse();

  return (
    <section
      style={{
        marginBottom: "20px",
        border: "0.5px solid rgba(245,245,244,0.12)",
        background: "rgba(28,25,23,0.72)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "14px 16px",
          borderBottom: "0.5px solid rgba(245,245,244,0.08)",
          background: "rgba(245,158,11,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(245,158,11,0.14)",
              border: "0.5px solid rgba(245,158,11,0.25)",
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            {agentEmoji ? (
              <AvatarGlyph value={agentEmoji} size={14} color="#f59e0b" />
            ) : (
              <Bot size={14} color="#f59e0b" />
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: color.text }}>Live activity</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: connected ? "#34d399" : "#fbbf24",
                  background: connected ? "rgba(52,211,153,0.12)" : "rgba(251,191,36,0.12)",
                }}
              >
                <Activity size={10} />
                {connected ? "streaming" : "connecting"}
              </span>
            </div>
            <div style={{ fontSize: 12, color: color.textSecondary }}>
              {agentName} is actively working this task{sessionId ? ` · session ${sessionId.slice(0, 8)}` : ""}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: 16, display: "grid", gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: color.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Current output
          </div>
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "rgba(12,10,9,0.7)",
              border: "0.5px solid rgba(245,245,244,0.08)",
              color: color.textMuted,
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              minHeight: 56,
            }}
          >
            {streamText.trim() || "Waiting for the next live output…"}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: color.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Recent actions
          </div>
          {renderedEvents.length === 0 ? (
            <div style={{ fontSize: 12, color: color.textMuted, padding: "8px 0" }}>
              No stream events yet.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {renderedEvents.map((event) => (
                <div
                  key={event.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "0.5px solid rgba(245,245,244,0.08)",
                    background: "rgba(12,10,9,0.4)",
                  }}
                >
                  <div style={{ marginTop: 1, flexShrink: 0 }}>{eventIcon(event)}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, color: color.text, lineHeight: 1.5 }}>{event.message}</div>
                    <div style={{ fontSize: 10, color: color.textMuted, marginTop: 4 }}>{relativeAge(event.ts)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AttachmentDraftPreview({
  attachments,
  onRemove,
}: {
  attachments: UploadedAttachment[];
  onRemove: (attachmentId: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
      {attachments.map((attachment) => {
        const url = attachmentUrl(attachment);
        const isImage = attachment.type.startsWith("image/");
        return (
          <div
            key={attachment.id}
            style={{
              position: "relative",
              border: `0.5px solid ${color.border}`,
              borderRadius: 8,
              background: "rgba(255,255,255,0.04)",
              overflow: "hidden",
              maxWidth: isImage ? 180 : 260,
            }}
          >
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={attachment.name} style={{ display: "block", width: 180, maxHeight: 140, objectFit: "cover" }} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 32px 9px 10px", color: color.textSecondary, fontSize: 12 }}>
                <Link2 size={14} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
              </div>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(attachment.id);
              }}
              title="Remove attachment"
              style={{
                position: "absolute",
                top: 5,
                right: 5,
                width: 22,
                height: 22,
                borderRadius: "50%",
                border: `0.5px solid ${color.border}`,
                background: "rgba(0,0,0,0.55)",
                color: "#fff",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                lineHeight: 1,
              }}
            >
              x
            </button>
          </div>
        );
      })}
    </div>
  );
}

function eventIcon(event: StreamTranscriptEntry) {
  if (event.kind === "tool_start" || event.kind === "tool_end" || event.kind === "action_detected") {
    return <Wrench size={14} color="#60a5fa" />;
  }
  if (event.kind === "lifecycle_error" || event.kind === "error") {
    return <AlertCircle size={14} color="#f87171" />;
  }
  if (event.kind === "lifecycle_end" || event.kind === "assistant_final") {
    return <CheckCircle2 size={14} color="#34d399" />;
  }
  return <Bot size={14} color="#f59e0b" />;
}
