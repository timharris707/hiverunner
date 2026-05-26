"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Archive, ArrowUpDown, AtSign, BellOff, Bot, CheckCircle2, ChevronDown, ChevronRight, Clock, Copy, Expand, ExternalLink, Filter, GitBranch, Inbox as InboxIcon, MessageSquare, Mic, MoreHorizontal, Link2, Plus, RotateCcw, Search, Send, Tag, Trash2, User, UserPlus } from "lucide-react";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { AssigneeAvatar } from "@/components/agents/AssigneeAvatar";
import { SprintGroupedList } from "@/components/goals/SprintGroupedList";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { color, font, P, radius, space } from "@/lib/ui/tokens";
import { StatusCircle } from "@/components/orchestration/StatusCircle";
import { PriorityBars } from "@/components/orchestration/PriorityBars";
import { STATUS_META } from "@/components/orchestration/task-display";

import { CompanyErrorState } from "@/components/company/company-ui";
import { formatAge } from "@/components/orchestration/ui";
import {
  archiveInboxEvents,
  getCompanyInbox,
  getTaskDetail,
  listCompanyAgents,
  listProjects,
  listCompanies,
  addTaskCommentWithResult,
  markInboxEventsRead,
  markAllInboxRead,
  markInboxThreadRead,
  createTask,
  reviewSprintPlanDraft,
  updateTask,
  updateTaskAssignee,
  updateTaskStatus,
} from "@/lib/orchestration/client";
import { InlinePriorityPicker } from "@/components/tasks/InlinePriorityPicker";
import { InlineAssigneePicker, resolveAvatar } from "@/components/tasks/InlineAssigneePicker";
import { InlineStatusPicker } from "@/components/tasks/InlineStatusPicker";
import { InlineTagsEditor } from "@/components/tasks/InlineTagsEditor";
import { STATUS_LABEL, formatShortDate } from "@/components/tasks/types";
import { TaskVoiceModal } from "@/components/voice/TaskVoiceModal";
import type { VoiceBindingRequest } from "@/lib/voice-binding";
import { buildApprovalDetailPath, buildCanonicalCompanyPath, buildCanonicalGoalPath } from "@/lib/orchestration/route-paths";
import { isOperationalStatusComment } from "@/lib/orchestration/comment-visibility";
import { flattenSprintGroupedItems, groupBySprint, type GroupableItem } from "@/lib/orchestration/groupBySprint";
import { isLegacyHumanActor, PUBLIC_HUMAN_LABEL } from "@/lib/public-identity";
import type {
  OrchestrationCompany,
  OrchestrationCompanyInboxEvent,
  OrchestrationAgent,
  OrchestrationProject,
  OrchestrationTask,
  OrchestrationTaskDetail,
  OrchestrationTaskTimelineItem,
  OrchestrationResolvedExecutionContext,
  TaskPriority,
  TaskStatus,
} from "@/lib/orchestration/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TabKey = "mine" | "recent" | "unread" | "all";
type ReaderTabKey = "comments" | "subtasks" | "activity";
type CategoryFilter = "everything" | "tasks" | "executions" | "approvals";
type InboxKindFilter = "all" | "task" | "execution" | "approval" | "sprint_plan_draft" | "lead_supervisor_update";
type ApprovalStatusFilter = "all" | "pending" | "approved" | "rejected" | "revision_requested";
type InboxLens = "chronological" | "by-sprint";

type InboxState = {
  events: OrchestrationCompanyInboxEvent[];
  unreadCount: number;
  nextCursor?: string;
  hasMore: boolean;
};

type SelectedTaskData = {
  task: OrchestrationTask;
  detail: OrchestrationTaskDetail;
};

type LocalWorkingRun = {
  taskId: string;
  runId?: string;
  agentName: string;
  startedAt: string;
  provider?: string;
  label: "waking" | "working";
};

type InboxGroupedEvent = OrchestrationCompanyInboxEvent & GroupableItem;

type TaskExecutionOverridePatch = {
  executionEngine?: OrchestrationTask["executionEngine"] | null;
  executionRuntimeProvider?: string | null;
  executionRuntimeLabel?: string | null;
  executionModelRouting?: string | null;
  executionModelRoutingLabel?: string | null;
};

const EMPTY: InboxState = { events: [], unreadCount: 0, hasMore: false };
const ACTIVITY_SIDE_INSET = 14;
const ACTIVITY_ICON_RAIL = 28;
const ACTIVITY_TIME_RAIL = 72;
const ACTIVITY_RAIL_GAP = 10;
const COMPOSER_AVATAR_SIZE = 18;
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

type UploadedAttachment = {
  id: string;
  name: string;
  path: string;
  type: string;
  size: number;
};

function attachmentUrl(attachment: UploadedAttachment): string {
  const params = new URLSearchParams({ path: attachment.path });
  return `/api/tasks/attachments?${params.toString()}`;
}

function attachmentMarkdown(attachments: UploadedAttachment[]): string {
  return attachments
    .map((attachment) => {
      const label = attachment.name.replace(/[\[\]\n\r]/g, " ").replace(/\s+/g, " ").trim() || "attachment";
      const url = attachmentUrl(attachment);
      return attachment.type.startsWith("image/") ? `![${label}](${url})` : `[${label}](${url})`;
    })
    .join("\n");
}

function hashStringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 55%)`;
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

function formatRunProvider(provider?: string): string {
  if (!provider) return "";
  switch (provider.toLowerCase()) {
    case "anthropic":
      return "Anthropic";
    case "codex":
      return "Codex";
    case "gemini":
      return "Gemini";
    case "hermes":
      return "Hermes";
    case "openclaw":
      return "OpenClaw";
    default:
      return provider;
  }
}

function formatExecutionModeLabel(engine?: string | null): string {
  if (engine === "symphony") return "Symphony";
  if (engine === "manual") return "Manual / Operator Controlled";
  return "HiveRunner Native";
}

function formatRunnerProviderLabel(provider?: string | null): string | null {
  if (!provider) return null;
  switch (provider.toLowerCase()) {
    case "anthropic":
    case "claude":
      return "Anthropic";
    case "codex":
    case "openai":
      return provider.toLowerCase() === "codex" ? "Codex" : "OpenAI";
    case "gemini":
    case "google":
      return provider.toLowerCase() === "gemini" ? "Gemini" : "Google";
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

function inferExecutionModelSource(provider?: string | null, model?: string | null): string | null {
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

function runtimeForExecutionContext(context: OrchestrationResolvedExecutionContext): string | null {
  return formatRunnerProviderLabel(context.runnerProvider) ??
    formatRunnerProviderLabel(context.provider) ??
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
  const source = context.modelRoutingLabel ?? inferExecutionModelSource(context.runnerProvider ?? context.provider, model);
  const rows = [
    { label: "Mode", value: formatExecutionModeLabel(context.executionEngine) },
    { label: "Runtime", value: runtime ?? (context.executionEngine === "manual" ? "No autonomous runtime" : "Runtime managed"), muted: !runtime },
    { label: "Source", value: source ?? (model ? "Runtime managed" : "Not selected yet"), muted: !source },
    { label: "Model", value: model ?? (context.executionEngine === "manual" ? "None" : "Runtime managed"), muted: !model },
  ];
  if (context.modelRoutingLabel || context.modelLane) {
    rows.push({ label: "Route", value: context.modelRoutingLabel ?? context.modelLane ?? "" });
  }
  return rows;
}

function displayExecutionContext(context?: OrchestrationResolvedExecutionContext | null): Array<{ label: string; value: string }> {
  if (!context) return [];
  return [
    { label: "Sandbox", value: context.sandbox ?? "" },
  ].filter((row) => row.value.trim().length > 0);
}

function formatMinuteTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function metadataText(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function timelineEventType(item: OrchestrationTaskTimelineItem): string {
  return metadataText(item.metadata, "eventType") ?? "";
}

function isTaskLifecycleEvent(item: OrchestrationTaskTimelineItem): boolean {
  const eventType = timelineEventType(item);
  return item.source === "task_events" || eventType.startsWith("task.");
}

function isRunHistoryEvent(item: OrchestrationTaskTimelineItem): boolean {
  if (isTaskLifecycleEvent(item)) return false;
  return item.kind === "run_event" || item.kind === "engine_event";
}

function isCommentTimelineItem(item: OrchestrationTaskTimelineItem): boolean {
  return item.provenance === "comment" || item.kind === "comment" || item.kind === "imported_report";
}

function isVoiceSessionComment(item: OrchestrationTaskTimelineItem): boolean {
  return item.source === "voice" ||
    metadataText(item.metadata, "externalRef")?.startsWith("voice:") === true ||
    (item.body ?? item.summary).trim().toLowerCase().startsWith("voice session recorded");
}

function isInternalProgressComment(item: OrchestrationTaskTimelineItem): boolean {
  if (!isCommentTimelineItem(item)) return false;
  if (isOperationalStatusComment({
    source: item.source,
    type: metadataText(item.metadata, "commentType"),
    text: item.body ?? item.summary,
  })) return true;
  if (!item.actorLabel || /^(tim|tim-local|me)$/i.test(item.actorLabel)) return false;
  const body = (item.body ?? item.summary).trim();
  if (!body) return true;
  if (body.startsWith("#") || body.includes("\n\n") || body.length > 420) return false;
  return /^(starting|research complete|progress note|i'?m picking up|i have the research|good data|now i(?:'|’)ll|i(?:'|’)ll start|i(?:'|’)ll pick up|ready for review)\b/i.test(body);
}

function commentTopicKey(item: OrchestrationTaskTimelineItem): string | null {
  if (!isCommentTimelineItem(item) || !item.body) return null;
  const body = item.body.trim();
  const heading = body.match(/^#{1,4}\s+(.+)$/m)?.[1];
  const firstLine = heading ?? body.split("\n").find((line) => line.trim() && !/^-{3,}$/.test(line.trim())) ?? "";
  const key = firstLine
    .replace(/[*_`#[\]()]/g, "")
    .replace(/\bllms?\b/gi, "models")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!key || key.length < 12) return null;
  return `${displayActorName(item.actorLabel).toLowerCase()}:${key.slice(0, 90)}`;
}

function visibleActivityTimeline(items: OrchestrationTaskTimelineItem[]): OrchestrationTaskTimelineItem[] {
  const seenCommentTopics = new Set<string>();
  const descending = items.filter((item) => {
    if (isRunHistoryEvent(item)) return false;
    if (isInternalProgressComment(item)) return false;
    if (item.summary.toLowerCase().startsWith("sending prompt")) return false;
    if (isCommentTimelineItem(item)) {
      const key = commentTopicKey(item);
      if (key && seenCommentTopics.has(key)) return false;
      if (key) seenCommentTopics.add(key);
    }
    return true;
  });
  return compactImmediateStatusChanges(descending.slice().reverse());
}

function defaultCommentExpanded(item: OrchestrationTaskTimelineItem): boolean {
  return isCommentTimelineItem(item) && !isVoiceSessionComment(item) && item.kind !== "imported_report";
}

function isStatusChangeEvent(item: OrchestrationTaskTimelineItem): boolean {
  return timelineEventType(item) === "task.status_changed";
}

function compactImmediateStatusChanges(items: OrchestrationTaskTimelineItem[]): OrchestrationTaskTimelineItem[] {
  const compacted: OrchestrationTaskTimelineItem[] = [];
  for (const item of items) {
    const previous = compacted[compacted.length - 1];
    if (previous && isStatusChangeEvent(previous) && isStatusChangeEvent(item)) {
      const previousTo = metadataText(previous.metadata, "toStatus");
      const currentFrom = metadataText(item.metadata, "fromStatus");
      const sameActor = displayActorName(previous.actorLabel) === displayActorName(item.actorLabel);
      const elapsed = new Date(item.timestamp).getTime() - new Date(previous.timestamp).getTime();
      if (sameActor && previousTo && currentFrom && previousTo === currentFrom && elapsed >= 0 && elapsed <= 5000) {
        compacted[compacted.length - 1] = {
          ...item,
          id: `${previous.id}+${item.id}`,
          summary: taskEventSummary(metadataText(previous.metadata, "fromStatus"), metadataText(item.metadata, "toStatus")),
          metadata: {
            ...item.metadata,
            fromStatus: metadataText(previous.metadata, "fromStatus"),
            toStatus: metadataText(item.metadata, "toStatus"),
            compactedStatusEvents: [previous.id, item.id],
          },
        };
        continue;
      }
    }
    compacted.push(item);
  }
  return compacted;
}

function taskEventSummary(fromStatus?: string, toStatus?: string): string {
  return fromStatus && toStatus ? `Status changed from ${fromStatus} to ${toStatus}` : "Status changed";
}

function displayActorName(label?: string): string {
  const raw = label?.trim();
  if (!raw) return "System";
  if (isLegacyHumanActor(raw) || /^me$/i.test(raw)) return PUBLIC_HUMAN_LABEL;
  return raw;
}

function displayStatusLabel(status?: string): string {
  if (!status) return "Unknown";
  const normalized = status.replace(/_/g, "-") as TaskStatus;
  return STATUS_META[normalized]?.label ?? STATUS_LABEL[normalized] ?? status.replace(/_/g, " ");
}

function activityEventText(item: OrchestrationTaskTimelineItem): string {
  const eventType = timelineEventType(item);
  const actor = displayActorName(item.actorLabel);
  if (eventType === "task.created") return `${actor} created this task`;
  if (eventType === "task.status_changed") {
    const from = displayStatusLabel(metadataText(item.metadata, "fromStatus"));
    const to = displayStatusLabel(metadataText(item.metadata, "toStatus"));
    return `${actor} changed status from ${from} to ${to}`;
  }
  if (eventType === "task.assigned") return `${actor} assigned this task`;
  if (eventType === "task.unassigned") return `${actor} unassigned this task`;
  if (eventType === "task.updated") return `${actor} updated this task`;
  if (eventType === "task.archived") return `${actor} archived this task`;
  return item.summary;
}

/* ------------------------------------------------------------------ */
/*  Thread helpers                                                     */
/* ------------------------------------------------------------------ */

/** Derive a thread key for an event — used for thread-level mark-as-read */
function eventThreadKey(event: OrchestrationCompanyInboxEvent): string {
  if (event.kind === "approval" && event.approvalId) return event.approvalId;
  if (event.kind === "sprint_plan_draft" && event.draftId) return event.draftId;
  if (event.kind === "lead_supervisor_update" && event.companyGoalId) return `lead-supervisor:${event.companyGoalId}`;
  if (event.taskKey) return event.taskKey;
  return event.id;
}

function eventThreadKind(event: OrchestrationCompanyInboxEvent): "task" | "approval" {
  return event.kind === "approval" ? "approval" : "task";
}

/* ------------------------------------------------------------------ */
/*  Status indicator                                                   */
/* ------------------------------------------------------------------ */

function StatusDot({ status }: { status?: TaskStatus }) {
  if (!status) {
    return (
      <span
        style={{
          width: 14, height: 14, borderRadius: "999px",
          border: "2px solid #737373", background: "transparent",
          flexShrink: 0, display: "inline-block",
        }}
      />
    );
  }
  return <StatusCircle status={status} size={14} />;
}

/* ------------------------------------------------------------------ */
/*  Event helpers                                                      */
/* ------------------------------------------------------------------ */

function eventVerb(event: OrchestrationCompanyInboxEvent): string {
  switch (event.eventType) {
    case "task.comment_added": return "commented";
    case "task.created": return "created";
    case "task.updated":
    case "task.reordered":
    case "task.status_changed":
    case "task.assigned":
    case "task.unassigned": return "updated";
    case "task.archived": return "archived";
    case "execution.pending":
    case "execution.running": return "updated";
    case "execution.completed": return "completed";
    case "execution.failed": return "failed";
    case "execution.cancelled": return "cancelled";
    case "approval.pending": return "requested";
    case "approval.approved": return "approved";
    case "approval.rejected": return "rejected";
    case "approval.revision_requested": return "revision requested";
    case "goal.sprint_plan_proposed": return "proposed";
    case "goal.sprint_plan_approved": return "approved";
    case "goal.sprint_plan_rejected": return "rejected";
    case "goal.completion_proposed": return "proposed";
    case "goal.completion_approved": return "approved";
    case "goal.completion_rejected": return "rejected";
    case "lead_supervisor_update": return "reported";
    default: return "updated";
  }
}

function cleanInboxActivityText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1 attachment")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_#>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripInboxTitlePrefix(message: string, title: string): string {
  const cleanMessage = cleanInboxActivityText(message);
  const cleanTitle = cleanInboxActivityText(title);
  if (!cleanTitle) return cleanMessage;
  const lowerMessage = cleanMessage.toLowerCase();
  const lowerTitle = cleanTitle.toLowerCase();
  if (!lowerMessage.startsWith(lowerTitle)) return cleanMessage;
  return cleanMessage.slice(cleanTitle.length).replace(/^[:\s\-–—]+/, "").trim();
}

function sentenceCaseActivity(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.slice(0, 1).toUpperCase() + trimmed.slice(1);
}

function inboxActivitySummary(event: OrchestrationCompanyInboxEvent, title: string): string {
  const actor = event.agentName ?? event.requestedByName;
  if (event.activitySummary) {
    const summary = cleanInboxActivityText(event.activitySummary);
    if (summary) return summary;
  }

  switch (event.eventType) {
    case "task.comment_added":
      return actor ? `${actor} commented` : "New comment";
    case "task.status_changed":
      return event.status ? `Set status to ${STATUS_META[event.status]?.label ?? STATUS_LABEL[event.status] ?? event.status}` : "Status changed";
    case "task.assigned":
      return actor ? `Assigned to ${actor}` : "Assigned";
    case "task.unassigned":
      return "Unassigned";
    case "task.created":
      return "Task created";
    case "task.archived":
      return "Task archived";
    case "task.reordered":
      return "Moved on the board";
    case "execution.pending":
      return actor ? `${actor} queued to run` : "Execution queued";
    case "execution.running":
      return actor ? `${actor} is working` : "Execution running";
    case "execution.completed":
      return actor ? `${actor} completed the task` : "Task completed";
    case "execution.failed":
      return event.errorMessage ? `Task failed: ${cleanInboxActivityText(event.errorMessage)}` : "Task failed";
    case "execution.cancelled":
      return "Execution cancelled";
    case "approval.pending":
      return "Pending approval";
    case "approval.approved":
      return "Approved";
    case "approval.rejected":
      return "Rejected";
    case "approval.revision_requested":
      return "Revision requested";
    case "goal.sprint_plan_proposed":
      return event.kind === "sprint_plan_draft"
        ? event.draftSprintCount && event.draftSprintCount > 1
          ? `${event.draftSprintCount} sprints, ${event.draftTaskCount ?? 0} total tasks`
          : `${event.draftTaskCount ?? 0} tasks proposed`
        : "Sprint plan proposed";
    case "goal.sprint_plan_approved":
      return "Sprint plan approved";
    case "goal.sprint_plan_rejected":
      return "Sprint plan rejected";
    case "goal.completion_proposed":
      return "Operator approval requested";
    case "goal.completion_approved":
      return "Goal completion approved";
    case "goal.completion_rejected":
      return "Goal completion rejected";
    case "lead_supervisor_update":
      return "Latest sprint supervision update";
    default: {
      const stripped = stripInboxTitlePrefix(event.message, title);
      return stripped ? sentenceCaseActivity(stripped) : eventVerb(event);
    }
  }
}

function eventTargetHref(
  companyCode: string,
  event: OrchestrationCompanyInboxEvent
): string {
  if (event.kind === "approval" && event.approvalId) {
    return buildApprovalDetailPath({
      companyCode,
      companySlug: event.companySlug || companyCode,
      approvalId: event.approvalId,
      linkedTaskKey: event.taskKey,
    });
  }
  if (event.kind === "sprint_plan_draft" && event.companyGoalId) {
    return buildCanonicalGoalPath(companyCode, event.companyGoalId);
  }
  if (event.taskKey) {
    return buildCanonicalCompanyPath(companyCode, `/tasks/${encodeURIComponent(event.taskKey)}?from=inbox`);
  }
  return buildCanonicalCompanyPath(companyCode, "");
}

function inboxEventTitle(event: OrchestrationCompanyInboxEvent): string {
  if (event.kind === "lead_supervisor_update") {
    return event.companyGoalName ? `Lead supervisor update: ${event.companyGoalName}` : "Lead supervisor update";
  }
  if (event.kind === "sprint_plan_draft") {
    if (event.eventType === "goal.completion_proposed") return "Goal completion proposed";
    if (event.draftSprintCount && event.draftSprintCount > 1) return `Sprint plan proposed: ${event.draftSprintCount} sprints, ${event.draftTaskCount ?? 0} total tasks`;
    return event.draftSprintName ?? event.sprintName ?? event.message;
  }
  return event.kind === "approval"
    ? event.approvalLabel ?? event.taskTitle ?? event.message
    : event.taskTitle ?? event.approvalLabel ?? event.message;
}

function inboxSelectionValue(event: OrchestrationCompanyInboxEvent): string {
  if (event.kind === "lead_supervisor_update") return event.companyGoalId ?? event.taskKey ?? event.id;
  if (event.kind === "sprint_plan_draft") return event.draftId ?? event.id;
  if (event.kind === "approval") return event.approvalId ?? event.taskKey ?? event.taskId ?? event.id;
  return event.taskKey ?? event.taskId ?? event.approvalId ?? event.id;
}

function eventMatchesInboxSelection(event: OrchestrationCompanyInboxEvent, selection: string): boolean {
  const normalized = selection.trim().toLowerCase();
  if (!normalized) return false;
  return [event.id, event.taskId, event.taskKey, event.approvalId, event.draftId]
    .filter(Boolean)
    .some((value) => value!.toLowerCase() === normalized);
}

function replaceInboxSelectionParam(event: OrchestrationCompanyInboxEvent, replace?: (href: string) => void) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("item");
  url.searchParams.delete("issue");
  url.searchParams.delete("task");
  url.searchParams.set("taskId", inboxSelectionValue(event));
  const next = `${url.pathname}?${url.searchParams.toString()}`;
  if (replace) replace(next);
  else window.history.replaceState(null, "", next);
}

/** Persist the current inbox item list to sessionStorage for prev/next navigation on the task detail page. */
const INBOX_CONTEXT_KEY = "mc:inbox:context";

function persistInboxContext(events: OrchestrationCompanyInboxEvent[], companySlug: string) {
  try {
    const items = events
      .filter((e) => e.taskKey)
      .map((e) => ({ taskKey: e.taskKey!, title: e.taskTitle ?? e.message }));
    const inboxHref = buildCanonicalCompanyPath(companySlug, "/inbox");
    sessionStorage.setItem(INBOX_CONTEXT_KEY, JSON.stringify({ items, inboxHref }));
  } catch {}
}

function eventMatchesSearch(event: OrchestrationCompanyInboxEvent, query: string): boolean {
  const q = query.toLowerCase();
  if (event.taskKey?.toLowerCase().includes(q)) return true;
  if (event.taskTitle?.toLowerCase().includes(q)) return true;
  if (event.message?.toLowerCase().includes(q)) return true;
  if (event.approvalLabel?.toLowerCase().includes(q)) return true;
  if (event.agentName?.toLowerCase().includes(q)) return true;
  if (event.requestedByName?.toLowerCase().includes(q)) return true;
  return false;
}

function eventMatchesCategory(event: OrchestrationCompanyInboxEvent, category: CategoryFilter): boolean {
  if (category === "everything") return true;
  if (category === "tasks" && event.kind === "sprint_plan_draft") return true;
  if (category === "tasks" && event.kind === "lead_supervisor_update") return true;
  return event.kind === category.replace(/s$/, "") as OrchestrationCompanyInboxEvent["kind"];
}

/* ------------------------------------------------------------------ */
/*  Time helpers                                                       */
/* ------------------------------------------------------------------ */

function isToday(dateStr: string): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTrailingUrlPunctuation(value: string): { href: string; trailing: string } {
  const match = value.match(/^(.+?)([.,;:!?)]*)$/);
  return { href: match?.[1] ?? value, trailing: match?.[2] ?? "" };
}

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
  const markdownHref = `(?:https?:\\/\\/[^\\s)]+?|\\/api\\/tasks\\/attachments\\?path=[^\\s)]+)`;
  const splitPattern = prefix
    ? new RegExp(`(\\[[^\\]\\n]{1,160}\\]\\(${markdownHref}\\)|\\*\\*[^*\\n][\\s\\S]*?\\*\\*|\\*[^*\\n][^*\\n]*\\*|\`[^\`\\n]+\`|\\b${escapeRegExp(prefix)}-\\d+\\b|https?:\\/\\/[^\\s<>)]+)`, "g")
    : /(\[[^\]\n]{1,160}\]\((?:https?:\/\/[^\s)]+?|\/api\/tasks\/attachments\?path=[^\s)]+)\)|\*\*[^*\n][\s\S]*?\*\*|\*[^*\n][^*\n]*\*|`[^`\n]+`|\b[A-Z]{2,5}-\d+\b|https?:\/\/[^\s<>)]+)/g;
  const parts = text.split(splitPattern);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) => {
        const markdownLink = part.match(/^\[([^\]\n]{1,160})\]\((https?:\/\/[^\s)]+?|\/api\/tasks\/attachments\?path=[^\s)]+)\)$/);
        if (markdownLink) {
          return (
            <a key={i} href={markdownLink[2]} target="_blank" rel="noreferrer" style={{ color: color.info, textDecoration: "none", fontWeight: 600 }} onClick={(e) => e.stopPropagation()}>
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
            <code key={i} style={{ padding: "1px 5px", borderRadius: 5, background: "rgba(120,113,108,0.16)", border: `0.5px solid ${color.border}`, color: color.text, fontFamily: font.mono, fontSize: "0.94em" }}>
              {part.slice(1, -1)}
            </code>
          );
        }
        if (/^https?:\/\/[^\s<>)]+$/.test(part)) {
          const { href, trailing } = stripTrailingUrlPunctuation(part);
          return (
            <span key={i}>
              <a href={href} target="_blank" rel="noreferrer" style={{ color: color.info, textDecoration: "none", fontWeight: 600 }} onClick={(e) => e.stopPropagation()}>
                {href}
              </a>
              {trailing}
            </span>
          );
        }
        return taskRefPattern.test(part) && allowedTaskRefPattern.test(part) ? (
          <Link key={i} href={buildCanonicalCompanyPath(companySlug, `/tasks/${encodeURIComponent(part)}`)} style={{ color: color.accent, textDecoration: "none", fontWeight: 500 }} onClick={(e) => e.stopPropagation()}>
            {part}
          </Link>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}

function AttachmentLinePreview({
  href,
  label,
  image = false,
}: {
  href: string;
  label: string;
  image?: boolean;
}) {
  if (image) {
    return (
      <a href={href} target="_blank" rel="noreferrer" style={{ display: "inline-flex", width: "fit-content", maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={href} alt={label || "Attachment"} style={{ display: "block", maxWidth: "min(100%, 520px)", maxHeight: 360, objectFit: "contain", borderRadius: 8, border: `1px solid ${color.border}`, background: color.surface }} />
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      style={{
        width: "fit-content",
        maxWidth: "100%",
        minHeight: 34,
        border: `0.5px solid ${color.border}`,
        borderRadius: 8,
        background: "rgba(255,255,255,0.035)",
        color: color.textSecondary,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 10px",
        textDecoration: "none",
        fontSize: 12,
      }}
    >
      <Link2 size={14} />
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label || "Attachment"}</span>
    </a>
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
          return <AttachmentLinePreview key={index} href={image[2]} label={image[1]} image />;
        }
        const attachment = trimmed.match(/^\[([^\]\n]{1,160})\]\((\/api\/tasks\/attachments\?path=[^\s)]+)\)$/);
        if (attachment) {
          return <AttachmentLinePreview key={index} href={attachment[2]} label={attachment[1]} />;
        }
        if (/^-{3,}$/.test(trimmed)) {
          return <div key={index} style={{ height: 1, background: color.border, margin: "4px 0" }} />;
        }
        const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (heading) {
          const level = heading[1].length;
          return (
            <div key={index} style={{ fontSize: level <= 2 ? 15 : 13, fontWeight: 700, color: color.text, lineHeight: 1.35, marginTop: index === 0 ? 0 : 4 }}>
              <LinkedText text={heading[2]} companySlug={companySlug} taskKeyPrefix={taskKeyPrefix} />
            </div>
          );
        }
        const bullet = trimmed.match(/^[-*]\s+(.+)$/);
        if (bullet) {
          return (
            <div key={index} style={{ display: "flex", gap: 8, color: color.textSecondary, lineHeight: 1.55, fontSize: 14 }}>
              <span style={{ color: color.textMuted }}>•</span>
              <span>
                <LinkedText text={bullet[1]} companySlug={companySlug} taskKeyPrefix={taskKeyPrefix} />
              </span>
            </div>
          );
        }
        return (
          <p key={index} style={{ margin: 0, color: color.textSecondary, lineHeight: 1.58, fontSize: 14 }}>
            <LinkedText text={trimmed} companySlug={companySlug} taskKeyPrefix={taskKeyPrefix} />
          </p>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dropdown                                                           */
/* ------------------------------------------------------------------ */

function FilterDropdown({ value, options, onChange }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 10px", fontSize: 12, fontWeight: 500,
          borderRadius: 6, border: "0.5px solid var(--border)",
          background: "transparent", color: "var(--text-secondary)", cursor: "pointer",
        }}
      >
        {selected?.label ?? value}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, marginTop: 4,
          minWidth: 160, borderRadius: 8,
          border: "0.5px solid var(--border)",
          background: "var(--surface-elevated)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          zIndex: 50, overflow: "hidden",
        }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "7px 12px", fontSize: 12,
                color: opt.value === value ? "var(--text-primary)" : "var(--text-secondary)",
                background: opt.value === value ? "var(--surface-hover)" : "transparent",
                border: "none", cursor: "pointer",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = opt.value === value ? "var(--surface-hover)" : "transparent"; }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CompanyInboxPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [inbox, setInbox] = useState<InboxState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("mine");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("everything");
  const [approvalStatusFilter, setApprovalStatusFilter] = useState<ApprovalStatusFilter>("all");
  const [inboxLens, setInboxLens] = useState<InboxLens>("chronological");
  const [inboxLensHydrated, setInboxLensHydrated] = useState(false);
  // Persist sort/filter across sessions
  const inboxPrefsKey = `mc:inbox:prefs:${slug}`;
  const loadInboxPrefs = () => { try { const r = localStorage.getItem(inboxPrefsKey); if (r) return JSON.parse(r); } catch {} return {}; };
  const savedInboxPrefs = useRef(loadInboxPrefs());

  const [sortDir, setSortDir] = useState<"newest" | "oldest">(savedInboxPrefs.current.sortDir || "newest");
  const [kindFilter, setKindFilter] = useState<InboxKindFilter>(savedInboxPrefs.current.kindFilter || "all");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(Boolean(savedInboxPrefs.current.showArchived));
  const [requestedSelection, setRequestedSelection] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedTaskData, setSelectedTaskData] = useState<SelectedTaskData | null>(null);
  const [selectedTaskLoading, setSelectedTaskLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [listWidth, setListWidth] = useState(280);
  const [detailsWidth, setDetailsWidth] = useState(310);
  const resizeRef = useRef<{
    pane: "list" | "details";
    startX: number;
    startListWidth: number;
    startDetailsWidth: number;
  } | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const markReadInFlightRef = useRef<Set<string>>(new Set());
  const companyCode = company?.code ?? slug;

  useEffect(() => {
    if (!companyCode) return;
    const key = `hr:inbox:lens:${companyCode}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved === "chronological" || saved === "by-sprint") setInboxLens(saved);
      if (saved === "sprint") setInboxLens("by-sprint");
    } catch {}
    setInboxLensHydrated(true);
  }, [companyCode]);

  useEffect(() => {
    if (!companyCode || !inboxLensHydrated) return;
    try { localStorage.setItem(`hr:inbox:lens:${companyCode}`, inboxLens); } catch {}
  }, [companyCode, inboxLens, inboxLensHydrated]);

  useEffect(() => {
    try { localStorage.setItem(inboxPrefsKey, JSON.stringify({ sortDir, kindFilter, showArchived })); } catch {}
  }, [sortDir, kindFilter, showArchived, inboxPrefsKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setRequestedSelection(searchParams.get("taskId") ?? searchParams.get("task") ?? searchParams.get("item") ?? searchParams.get("issue"));
  }, [searchParams, slug]);

  useEffect(() => {
    if (!actionsOpen) return;
    const handler = (e: MouseEvent) => { if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setActionsOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [actionsOpen]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const active = resizeRef.current;
      if (!active) return;
      const delta = event.clientX - active.startX;
      if (active.pane === "list") {
        setListWidth(Math.min(400, Math.max(220, active.startListWidth + delta)));
      } else {
        setDetailsWidth(Math.min(400, Math.max(285, active.startDetailsWidth - delta)));
      }
      event.preventDefault();
    };
    const handleUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  const startResize = (pane: "list" | "details") => (event: ReactMouseEvent<HTMLDivElement>) => {
    resizeRef.current = {
      pane,
      startX: event.clientX,
      startListWidth: listWidth,
      startDetailsWidth: detailsWidth,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    event.preventDefault();
  };

  /** Map active tab to the server `kinds` filter so the API returns only relevant threads. */
  const kindsForTab = (tab: TabKey): string | undefined => {
    if (tab === "mine") return "task,approval,execution,sprint_plan_draft,lead_supervisor_update";
    return undefined; // "all", "recent", "unread" show everything
  };

  /* ---- Data loading ---- */
  const load = useCallback(async (options?: { showSpinner?: boolean }) => {
    const showSpinner = options?.showSpinner ?? true;
    if (showSpinner) {
      setLoading(true);
      setError(null);
    }
    try {
      const [companyRows, inboxData, projectRows, agentRows] = await Promise.all([
        listCompanies(),
        getCompanyInbox({
          companySlug: slug,
          includeDone: true,
          includeTaskSnapshot: false,
          limit: 25,
          includeArchived: showArchived,
          kinds: kindsForTab(activeTab),
        }),
        listProjects({ company: slug, includeArchived: false }),
        listCompanyAgents(slug),
      ]);
      const current = companyRows.find((row) => row.slug === slug) ?? null;
      setCompany(current);
      setProjects(projectRows);
      setAgents(agentRows);
      if (!current || !inboxData) {
        if (showSpinner) setInbox(EMPTY);
        return;
      }
      setError(null);
      setInbox({
        events: inboxData.events,
        unreadCount: inboxData.unreadCount,
        nextCursor: inboxData.page.nextCursor,
        hasMore: inboxData.page.hasMore,
      });
    } catch {
      if (showSpinner) {
        setError("Unable to load inbox.");
        setInbox(EMPTY);
      }
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [slug, activeTab, showArchived]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("inbox-unread-change", {
      detail: { count: inbox.unreadCount },
    }));
  }, [inbox.unreadCount]);

  const refreshQuietly = useCallback(() => {
    void load({ showSpinner: false });
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        refreshQuietly();
      }
    };

    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refreshQuietly]);

  /* ---- Load more ---- */
  const loadMore = async () => {
    if (!inbox.hasMore || !inbox.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await getCompanyInbox({
        companySlug: slug,
        includeDone: true,
        includeTaskSnapshot: false,
        limit: 25,
        cursor: inbox.nextCursor,
        includeArchived: showArchived,
        kinds: kindsForTab(activeTab),
      });
      if (!next) return;
      setInbox((prev) => ({
        ...prev,
        events: prev.events.concat(next.events),
        nextCursor: next.page.nextCursor,
        hasMore: next.page.hasMore,
      }));
    } finally {
      setLoadingMore(false);
    }
  };

  /* ---- Mark read ---- */
  const handleMarkAllRead = async () => {
    const ok = await markAllInboxRead(slug);
    if (ok) {
      setInbox((prev) => ({
        ...prev,
        events: prev.events.map((e) => ({ ...e, isRead: true })),
        unreadCount: 0,
      }));
      window.dispatchEvent(new CustomEvent("inbox-unread-change", { detail: { count: 0 } }));
    }
  };

  /** Mark the entire thread for an event as read (all comments/updates for that task/approval) */
  const handleMarkThreadRead = useCallback(async (event: OrchestrationCompanyInboxEvent) => {
    if (event.isRead) return;
    if (event.kind === "sprint_plan_draft") {
      const ok = await markInboxEventsRead(slug, [event.id]);
      if (ok) {
        setInbox((prev) => ({
          ...prev,
          events: prev.events.map((item) => item.id === event.id ? { ...item, isRead: true } : item),
          unreadCount: Math.max(0, prev.unreadCount - (!event.isRead ? 1 : 0)),
        }));
      }
      return;
    }
    const threadKey = eventThreadKey(event);
    const threadKind = eventThreadKind(event);
    const inFlightKey = `${threadKind}:${threadKey}`;
    if (markReadInFlightRef.current.has(inFlightKey)) return;

    markReadInFlightRef.current.add(inFlightKey);
    try {
      const ok = await markInboxThreadRead(slug, threadKey, threadKind);
      if (ok) {
        setInbox((prev) => ({
          ...prev,
          events: prev.events.map((e) =>
            eventThreadKind(e) === threadKind && eventThreadKey(e) === threadKey
              ? { ...e, isRead: true }
              : e
          ),
          unreadCount: Math.max(
            0,
            prev.unreadCount - (
              prev.events.some((e) => eventThreadKind(e) === threadKind && eventThreadKey(e) === threadKey && !e.isRead)
                ? 1
                : 0
            )
          ),
        }));
      }
    } finally {
      markReadInFlightRef.current.delete(inFlightKey);
    }
  }, [slug]);

  /* ---- Dismiss / archive ---- */
  const handleDismiss = async (event: OrchestrationCompanyInboxEvent) => {
    await archiveInboxEvents(slug, [event.id]);
    const nextEvents = visibleEventsForLens.filter((item) => item.id !== event.id);
    const currentIndex = visibleEventsForLens.findIndex((item) => item.id === event.id);
    const nextEvent = nextEvents[currentIndex] ?? nextEvents[currentIndex - 1] ?? nextEvents[0] ?? null;
    setInbox((prev) => ({ ...prev, events: prev.events.filter((item) => item.id !== event.id) }));
    setSelectedEventId(nextEvent?.id ?? null);
    setRequestedSelection(nextEvent ? inboxSelectionValue(nextEvent) : null);
    replaceSelectionParam(nextEvent);
    refreshQuietly();
  };

  const handleReviewDraft = useCallback((event: OrchestrationCompanyInboxEvent) => {
    if (!event.companyGoalId) return;
    router.push(buildCanonicalGoalPath(companyCode, event.companyGoalId));
  }, [companyCode, router]);

  const handleApproveDraft = useCallback(async (event: OrchestrationCompanyInboxEvent) => {
    if (!event.draftId || !event.companyGoalId) return;
    const taskCount = event.draftTaskCount ?? 0;
    const confirmed = window.confirm(`Approve "${event.draftSprintName ?? "this sprint plan"}" and create ${taskCount} ${taskCount === 1 ? "task" : "tasks"}?`);
    if (!confirmed) return;
    const result = await reviewSprintPlanDraft({
      companySlug: slug,
      companyGoalId: event.companyGoalId,
      draftId: event.draftId,
      action: "approve",
    });
    if (result) {
      window.dispatchEvent(new CustomEvent("goals-pending-drafts-change", { detail: { companySlug: slug } }));
      refreshQuietly();
    }
  }, [refreshQuietly, slug]);

  const handleRejectDraft = useCallback(async (event: OrchestrationCompanyInboxEvent) => {
    if (!event.draftId || !event.companyGoalId) return;
    const reason = window.prompt("Reason for rejecting this sprint plan");
    if (!reason?.trim()) return;
    const result = await reviewSprintPlanDraft({
      companySlug: slug,
      companyGoalId: event.companyGoalId,
      draftId: event.draftId,
      action: "reject",
      reason: reason.trim(),
    });
    if (result) {
      window.dispatchEvent(new CustomEvent("goals-pending-drafts-change", { detail: { companySlug: slug } }));
      refreshQuietly();
    }
  }, [refreshQuietly, slug]);

  const archiveVisible = useCallback(async (events: OrchestrationCompanyInboxEvent[]) => {
    const ids = events.map((event) => event.id);
    if (ids.length === 0) return;
    await archiveInboxEvents(slug, ids);
    setActionsOpen(false);
    refreshQuietly();
  }, [refreshQuietly, slug]);

  /* ---- Filtering ---- */
  const filteredEvents = useMemo(() => {
    let items = inbox.events;

    // Kind filtering is now server-side (via `kinds` param). Only apply lightweight
    // client-side filters that refine within the current server result set.
    if (activeTab === "unread") {
      items = items.filter((e) => !e.isRead);
    } else if (activeTab === "recent") {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      items = items.filter((e) => new Date(e.timestamp).getTime() > sevenDaysAgo);
    }

    // Category filter (only on "all" tab)
    if (activeTab === "all" && categoryFilter !== "everything") {
      items = items.filter((e) => eventMatchesCategory(e, categoryFilter));
    }

    // Approval status filter (only on "all" tab)
    if (activeTab === "all" && approvalStatusFilter !== "all") {
      items = items.filter((e) => {
        if (e.kind !== "approval") return true;
        return e.approvalStatus === approvalStatusFilter;
      });
    }

    // Search filter
    if (searchQuery.trim()) {
      items = items.filter((e) => eventMatchesSearch(e, searchQuery.trim()));
    }

    // Kind filter (toolbar)
    if (kindFilter !== "all") {
      items = items.filter((e) => e.kind === kindFilter);
    }

    // Sort
    if (sortDir === "oldest") {
      items = [...items].reverse();
    }

    return items;
  }, [inbox.events, activeTab, searchQuery, categoryFilter, approvalStatusFilter, kindFilter, sortDir]);

  const inboxGroupItems = useMemo<InboxGroupedEvent[]>(
    () => filteredEvents.map((event) => ({ ...event, updatedAt: event.timestamp })),
    [filteredEvents]
  );
  const sprintGroupedEvents = useMemo(() => groupBySprint(inboxGroupItems, "sprint"), [inboxGroupItems]);
  const visibleEventsForLens = useMemo(
    () => inboxLens === "by-sprint" ? flattenSprintGroupedItems(sprintGroupedEvents) : filteredEvents,
    [filteredEvents, inboxLens, sprintGroupedEvents]
  );

  const replaceSelectionParam = useCallback((event: OrchestrationCompanyInboxEvent | null) => {
    if (typeof window === "undefined") return;
    if (!event) {
      const url = new URL(window.location.href);
      url.searchParams.delete("taskId");
      url.searchParams.delete("task");
      url.searchParams.delete("item");
      url.searchParams.delete("issue");
      const query = url.searchParams.toString();
      router.replace(`${url.pathname}${query ? `?${query}` : ""}`, { scroll: false });
      return;
    }
    replaceInboxSelectionParam(event, (href) => router.replace(href, { scroll: false }));
  }, [router]);

  const handleArchiveAll = useCallback(() => archiveVisible(filteredEvents), [archiveVisible, filteredEvents]);
  const handleArchiveAllRead = useCallback(
    () => archiveVisible(filteredEvents.filter((event) => event.isRead)),
    [archiveVisible, filteredEvents]
  );
  const handleArchiveCompleted = useCallback(
    () => archiveVisible(filteredEvents.filter((event) => event.status === "done")),
    [archiveVisible, filteredEvents]
  );

  // Persist the current visible inbox items for prev/next navigation on task detail pages
  useEffect(() => {
    if (filteredEvents.length > 0 && company) {
      persistInboxContext(filteredEvents, company.code || slug);
    }
  }, [filteredEvents, company, slug]);

  useEffect(() => {
    if (visibleEventsForLens.length === 0) {
      if (selectedEventId !== null) setSelectedEventId(null);
      if (requestedSelection) replaceSelectionParam(null);
      return;
    }

    if (requestedSelection) {
      const requestedEvent = visibleEventsForLens.find((event) => eventMatchesInboxSelection(event, requestedSelection));
      if (requestedEvent) {
        if (selectedEventId !== requestedEvent.id) setSelectedEventId(requestedEvent.id);
      } else {
        const firstEvent = visibleEventsForLens[0];
        setSelectedEventId(firstEvent.id);
        setRequestedSelection(inboxSelectionValue(firstEvent));
        replaceSelectionParam(firstEvent);
      }
      return;
    }

    if (!selectedEventId || !visibleEventsForLens.some((event) => event.id === selectedEventId)) {
      const firstEvent = visibleEventsForLens[0];
      setSelectedEventId(firstEvent.id);
      setRequestedSelection(inboxSelectionValue(firstEvent));
      replaceSelectionParam(firstEvent);
    }
  }, [replaceSelectionParam, requestedSelection, selectedEventId, visibleEventsForLens]);

  const selectedEvent = useMemo(
    () => visibleEventsForLens.find((event) => event.id === selectedEventId) ?? null,
    [selectedEventId, visibleEventsForLens]
  );

  useEffect(() => {
    if (!selectedEvent || selectedEvent.isRead) return;
    void handleMarkThreadRead(selectedEvent);
  }, [handleMarkThreadRead, selectedEvent]);

  const selectedTaskLookup = selectedEvent?.taskId ?? selectedEvent?.taskKey ?? null;

  const refreshSelectedTask = useCallback(async () => {
    if (!selectedTaskLookup) return;
    const data = await getTaskDetail(selectedTaskLookup);
    if (data) setSelectedTaskData(data);
  }, [selectedTaskLookup]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedTaskLookup) {
      setSelectedTaskData(null);
      setSelectedTaskLoading(false);
      return;
    }

    setSelectedTaskLoading(true);
    getTaskDetail(selectedTaskLookup)
      .then((data) => {
        if (!cancelled) setSelectedTaskData(data);
      })
      .catch(() => {
        if (!cancelled) setSelectedTaskData(null);
      })
      .finally(() => {
        if (!cancelled) setSelectedTaskLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTaskLookup]);

  const handleSelectEvent = (event: OrchestrationCompanyInboxEvent) => {
    setSelectedEventId(event.id);
    setRequestedSelection(inboxSelectionValue(event));
    replaceSelectionParam(event);
    if (!event.isRead) void handleMarkThreadRead(event);
  };

  const patchSelectedTask = useCallback((patch: Partial<OrchestrationTask>) => {
    setSelectedTaskData((current) => {
      if (!current) return current;
      const updatedTask = { ...current.task, ...patch, updated: patch.updated ?? new Date().toISOString() };
      return {
        task: updatedTask,
        detail: {
          ...current.detail,
          task: {
            ...current.detail.task,
            ...(patch.status ? { status: patch.status } : {}),
            ...(patch.priority ? { priority: patch.priority } : {}),
            ...(patch.assignee !== undefined ? { assignee: patch.assignee } : {}),
            updated: updatedTask.updated,
          },
        },
      };
    });
  }, []);

  const handleStatusChange = useCallback(async (status: TaskStatus) => {
    const taskId = selectedTaskData?.task.id;
    if (!taskId) return;
    patchSelectedTask({ status });
    if (selectedEventId) {
      setInbox((prev) => ({
        ...prev,
        events: prev.events.map((event) => event.id === selectedEventId ? { ...event, status } : event),
      }));
    }
    const ok = await updateTaskStatus(taskId, status);
    if (!ok) void getTaskDetail(taskId).then((data) => { if (data) setSelectedTaskData(data); });
  }, [patchSelectedTask, selectedEventId, selectedTaskData?.task.id]);

  const handlePriorityChange = useCallback(async (priority: TaskPriority) => {
    const taskId = selectedTaskData?.task.id;
    if (!taskId) return;
    patchSelectedTask({ priority });
    const updated = await updateTask({ taskId, priority });
    if (updated) {
      patchSelectedTask({ priority: updated.priority, updated: updated.updated });
    } else {
      void getTaskDetail(taskId).then((data) => { if (data) setSelectedTaskData(data); });
    }
  }, [patchSelectedTask, selectedTaskData?.task.id]);

  const handleTagsChange = useCallback(async (tags: string[]) => {
    const taskId = selectedTaskData?.task.id;
    if (!taskId) return;
    patchSelectedTask({ tags });
    const updated = await updateTask({ taskId, labels: tags });
    if (updated) {
      patchSelectedTask({ tags: updated.tags, updated: updated.updated });
    } else {
      await refreshSelectedTask();
    }
  }, [patchSelectedTask, refreshSelectedTask, selectedTaskData?.task.id]);

  const handleAssigneeChange = useCallback(async (assignee: string) => {
    const taskId = selectedTaskData?.task.id;
    if (!taskId) return;
    patchSelectedTask({ assignee: assignee || undefined });
    const ok = await updateTaskAssignee(taskId, assignee);
    if (!ok) await refreshSelectedTask();
  }, [patchSelectedTask, refreshSelectedTask, selectedTaskData?.task.id]);

  const handleProjectChange = useCallback(async (projectId: string | null) => {
    const taskId = selectedTaskData?.task.id;
    if (!taskId) return;
    const project = projectId ? projects.find((item) => item.id === projectId) : null;
    patchSelectedTask({ project: projectId ?? "" });
    if (selectedEventId) {
      setInbox((prev) => ({
        ...prev,
        events: prev.events.map((event) => event.id === selectedEventId
          ? {
              ...event,
              projectId: projectId ?? "",
              projectSlug: project?.slug ?? "",
              projectName: project?.name ?? "No project",
              projectColor: project?.color ?? "#22d3ee",
            }
          : event),
      }));
    }
    const updated = await updateTask({ taskId, projectId });
    if (updated) {
      patchSelectedTask({ project: updated.project, updated: updated.updated });
    } else {
      void getTaskDetail(taskId).then((data) => { if (data) setSelectedTaskData(data); });
    }
  }, [patchSelectedTask, projects, selectedEventId, selectedTaskData?.task.id]);

  const handleExecutionOverrideChange = useCallback(async (patch: Partial<TaskExecutionOverridePatch>) => {
    const taskId = selectedTaskData?.task.id;
    if (!taskId) return;
    setSelectedTaskData((current) => {
      if (!current) return current;
      const optimisticTask: OrchestrationTask = {
        ...current.task,
        executionRuntimeProvider: patch.executionRuntimeProvider ?? current.task.executionRuntimeProvider,
        executionRuntimeLabel: patch.executionRuntimeLabel ?? current.task.executionRuntimeLabel,
        executionModelRouting: patch.executionModelRouting ?? current.task.executionModelRouting,
        executionModelRoutingLabel: patch.executionModelRoutingLabel ?? current.task.executionModelRoutingLabel,
        updated: new Date().toISOString(),
      };
      if (patch.executionEngine !== undefined && patch.executionEngine !== null) {
        optimisticTask.executionEngine = patch.executionEngine;
      }
      return {
        ...current,
        task: optimisticTask,
      };
    });
    const updated = await updateTask({
      taskId,
      executionEngine: patch.executionEngine,
      executionRuntimeProvider: patch.executionRuntimeProvider,
      executionRuntimeLabel: patch.executionRuntimeLabel,
      executionModelRouting: patch.executionModelRouting,
      executionModelRoutingLabel: patch.executionModelRoutingLabel,
    });
    if (updated) {
      await refreshSelectedTask();
    } else {
      void getTaskDetail(taskId).then((data) => { if (data) setSelectedTaskData(data); });
    }
  }, [refreshSelectedTask, selectedTaskData?.task.id]);

  /* ---- Time-split rendering (events are already 1-per-thread from server) ---- */
  const { todayEvents, earlierEvents } = useMemo(() => {
    const today: OrchestrationCompanyInboxEvent[] = [];
    const earlier: OrchestrationCompanyInboxEvent[] = [];
    for (const event of filteredEvents) {
      if (isToday(event.timestamp)) {
        today.push(event);
      } else {
        earlier.push(event);
      }
    }
    return { todayEvents: today, earlierEvents: earlier };
  }, [filteredEvents]);

  /* ---- Render guards ---- */
  if (!loading && !company) {
    return (
      <CompanyErrorState
        title="Company not found"
        detail="This company could not be resolved from orchestration data."
        href="/companies"
      />
    );
  }

  const TABS: { key: TabKey; label: string }[] = [
    { key: "mine", label: "Mine" },
    { key: "recent", label: "Recent" },
    { key: "unread", label: "Unread" },
    { key: "all", label: "All" },
  ];

  const CATEGORY_OPTIONS = [
    { value: "everything", label: "All categories" },
    { value: "tasks", label: "Tasks" },
    { value: "executions", label: "Executions" },
    { value: "approvals", label: "Approvals" },
  ];

  const APPROVAL_STATUS_OPTIONS = [
    { value: "all", label: "All approval statuses" },
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "revision_requested", label: "Revision requested" },
  ];

  return (
    <>
      <style>{`
        .hr-inbox-scroll {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .hr-inbox-scroll::-webkit-scrollbar {
          display: none;
        }
        .hr-inbox-resizer {
          background: transparent;
          cursor: col-resize;
          position: relative;
          justify-self: center;
          width: 10px;
          z-index: 5;
        }
      `}</style>
    <div
      style={{
        height: "calc(100dvh - 48px)",
        margin: "-" + space.md + "px -" + space.xl + "px -" + space.md + "px",
        display: "grid",
        gridTemplateColumns: detailsOpen
          ? `${listWidth}px 0 minmax(260px, 1fr) 0 ${detailsWidth}px`
          : `${listWidth}px 0 minmax(260px, 1fr)`,
        position: "relative",
        overflow: "hidden",
        background: color.bg,
        borderTop: "0.5px solid var(--border)",
      }}
    >
      <aside
        style={{
          background: color.bg,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "18px 16px 12px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <InboxIcon size={16} style={{ color: P.textSecondary, flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <h1 style={{ margin: 0, fontSize: 19, fontWeight: 650, color: P.text, letterSpacing: 0, whiteSpace: "nowrap" }}>
                  Inbox <span style={{ fontSize: 12, fontWeight: 450, color: P.textMuted }}>
                    ({filteredEvents.length} {filteredEvents.length === 1 ? "item" : "items"}, {inbox.unreadCount} unread)
                  </span>
                </h1>
              </div>
            </div>
            <div ref={actionsRef} style={{ position: "relative", flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setActionsOpen((value) => !value)}
                style={compactToolbarButton(actionsOpen || activeTab !== "mine" || kindFilter !== "all" || sortDir !== "newest" || showArchived)}
                title="Inbox actions"
              >
                <MoreHorizontal size={15} />
              </button>
              {actionsOpen && (
                <div style={{ ...inboxMenuStyle(), right: 0, left: "auto", minWidth: 230 }}>
                  <div style={menuLabelStyle}>View</div>
                  {TABS.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => { setActiveTab(tab.key); setActionsOpen(false); }}
                      style={menuItemStyle(activeTab === tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                  <MenuDivider />
                  <div style={menuLabelStyle}>Kind</div>
                  {(["all", "task", "execution", "approval", "sprint_plan_draft", "lead_supervisor_update"] as const).map((k) => (
                    <button key={k} type="button" onClick={() => { setKindFilter(k); }} style={menuItemStyle(kindFilter === k)}>
                      <Filter size={13} />
                      {k === "all" ? "All kinds" : k === "sprint_plan_draft" ? "Sprint plan drafts" : k === "lead_supervisor_update" ? "Lead updates" : k.charAt(0).toUpperCase() + k.slice(1) + "s"}
                    </button>
                  ))}
                  <MenuDivider />
                  <div style={menuLabelStyle}>Sort</div>
                  {(["newest", "oldest"] as const).map((dir) => (
                    <button key={dir} type="button" onClick={() => { setSortDir(dir); }} style={menuItemStyle(sortDir === dir)}>
                      <ArrowUpDown size={13} />
                      {dir === "newest" ? "Newest first" : "Oldest first"}
                    </button>
                  ))}
                  <button type="button" onClick={() => setShowArchived((value) => !value)} style={menuItemStyle(showArchived)}>
                    <Archive size={13} />
                    {showArchived ? "Hide archived" : "View archived"}
                  </button>
                  <MenuDivider />
                  <button type="button" onClick={() => void handleMarkAllRead()} style={menuItemStyle(false)}>
                    <CheckCircle2 size={13} />
                    Mark all as read
                  </button>
                  <button type="button" onClick={() => void handleArchiveAll()} style={menuItemStyle(false)}>
                    <Archive size={13} />
                    Archive all
                  </button>
                  <button type="button" onClick={() => void handleArchiveAllRead()} style={menuItemStyle(false)}>
                    <Archive size={13} />
                    Archive all read
                  </button>
                  <button type="button" onClick={() => void handleArchiveCompleted()} style={menuItemStyle(false)}>
                    <CheckCircle2 size={13} />
                    Archive completed
                  </button>
                </div>
              )}
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <SegmentedControl
              ariaLabel="Inbox lens"
              value={inboxLens}
              onChange={(value) => setInboxLens(value as InboxLens)}
              options={[
                { value: "chronological", label: "Chronological" },
                { value: "by-sprint", label: "By sprint" },
              ]}
            />
          </div>

          <div style={{ position: "relative", marginBottom: 10 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: P.textMuted, pointerEvents: "none" }} />
            <input
              type="text"
              placeholder="Search inbox"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                height: 34,
                borderRadius: radius.md,
                border: "0.5px solid " + P.cardBorder,
                background: "var(--surface-elevated)",
                padding: "0 12px 0 32px",
                fontSize: 13,
                color: P.text,
                outline: "none",
              }}
            />
          </div>

          {(activeTab !== "mine" || kindFilter !== "all" || showArchived) && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 18 }}>
              <span style={{ fontSize: 11, color: P.textMuted }}>
                {activeTab !== "mine" ? TABS.find((tab) => tab.key === activeTab)?.label : ""}
                {kindFilter !== "all" ? `${activeTab !== "mine" ? " · " : ""}${kindFilter}` : ""}
                {showArchived ? `${activeTab !== "mine" || kindFilter !== "all" ? " · " : ""}archived` : ""}
              </span>
            </div>
          )}

          {activeTab === "all" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <FilterDropdown value={categoryFilter} options={CATEGORY_OPTIONS} onChange={(v) => setCategoryFilter(v as CategoryFilter)} />
              <FilterDropdown value={approvalStatusFilter} options={APPROVAL_STATUS_OPTIONS} onChange={(v) => setApprovalStatusFilter(v as ApprovalStatusFilter)} />
            </div>
          )}
        </div>

        {error && (
          <div style={{ margin: 12, padding: "10px 12px", borderRadius: 8, border: "0.5px solid #7f1d1d", background: "rgba(127,29,29,0.15)", fontSize: 13, color: "#fca5a5" }}>
            {error}
          </div>
        )}

        <div className="hr-inbox-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "8px" }}>
          {loading ? (
            <div style={{ padding: "36px 12px", textAlign: "center", fontSize: 13, color: P.textMuted }}>Loading inbox...</div>
          ) : filteredEvents.length === 0 && !error ? (
            <div style={{ padding: "36px 18px", textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: 14, color: P.textSecondary }}>
                {activeTab === "unread" ? "All caught up." : searchQuery ? "No matching items." : "No inbox activity yet."}
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: P.textMuted }}>
                {searchQuery ? "Try a different search term." : "Task, approval, and run updates will appear here."}
              </p>
            </div>
          ) : inboxLens === "by-sprint" ? (
            <InboxSprintGroupsView
              grouped={sprintGroupedEvents}
              agents={agents}
              selectedEventId={selectedEventId}
              onSelect={handleSelectEvent}
              onDismiss={(event) => void handleDismiss(event)}
              onReviewDraft={handleReviewDraft}
              onApproveDraft={(event) => void handleApproveDraft(event)}
              onRejectDraft={(event) => void handleRejectDraft(event)}
              companyCode={companyCode}
            />
          ) : (
            <>
              {todayEvents.length > 0 && <InboxSectionLabel label="Today" count={todayEvents.length} />}
              {todayEvents.map((event) => (
                <InboxListItem
                  key={event.id}
                  event={event}
                  agents={agents}
                  selected={event.id === selectedEvent?.id}
                  onSelect={() => handleSelectEvent(event)}
                  onDismiss={() => void handleDismiss(event)}
                  onReviewDraft={handleReviewDraft}
                  onApproveDraft={(draftEvent) => void handleApproveDraft(draftEvent)}
                  onRejectDraft={(draftEvent) => void handleRejectDraft(draftEvent)}
                />
              ))}
              {earlierEvents.length > 0 && <InboxSectionLabel label="Earlier" count={earlierEvents.length} />}
              {earlierEvents.map((event) => (
                <InboxListItem
                  key={event.id}
                  event={event}
                  agents={agents}
                  selected={event.id === selectedEvent?.id}
                  onSelect={() => handleSelectEvent(event)}
                  onDismiss={() => void handleDismiss(event)}
                  onReviewDraft={handleReviewDraft}
                  onApproveDraft={(draftEvent) => void handleApproveDraft(draftEvent)}
                  onRejectDraft={(draftEvent) => void handleRejectDraft(draftEvent)}
                />
              ))}
            </>
          )}

          {inbox.hasMore && (
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore} style={loadMoreButtonStyle}>
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="hr-inbox-resizer" onMouseDown={startResize("list")} title="Resize inbox list" />

      <InboxReader
        event={selectedEvent}
        taskData={selectedTaskData}
        loading={selectedTaskLoading}
        company={company}
        projects={projects}
        agents={agents}
        slug={slug}
        onRefresh={refreshSelectedTask}
      />

      {detailsOpen && (
        <>
        <div className="hr-inbox-resizer" onMouseDown={startResize("details")} title="Resize details" />
        <InboxDetailsPanel
          event={selectedEvent}
          taskData={selectedTaskData}
          projects={projects}
          agents={agents}
          companyCode={company?.code ?? slug}
          onStatusChange={handleStatusChange}
          onPriorityChange={handlePriorityChange}
          onTagsChange={handleTagsChange}
          onAssigneeChange={handleAssigneeChange}
          onProjectChange={handleProjectChange}
          onExecutionOverrideChange={handleExecutionOverrideChange}
          onClose={() => setDetailsOpen(false)}
          onDismiss={handleDismiss}
        />
        </>
      )}
      {!detailsOpen && (
        <button
          type="button"
          onClick={() => setDetailsOpen(true)}
          title="Show properties"
          style={{
            position: "absolute",
            right: 16,
            top: 16,
            padding: "6px 10px",
            fontSize: 11,
            color: color.textSecondary,
            background: "rgba(41,37,36,0.5)",
            border: `0.5px solid ${color.border}`,
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Show properties
        </button>
      )}
    </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Split inbox layout helpers                                         */
/* ------------------------------------------------------------------ */

function compactToolbarButton(active: boolean): CSSProperties {
  return {
    width: 28,
    height: 28,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    border: "0.5px solid " + (active ? color.borderStrong : P.cardBorder),
    background: active ? color.surfaceHover : "transparent",
    color: active ? P.text : P.textSecondary,
    cursor: "pointer",
    boxShadow: active ? `0 0 0 1px ${color.accent} inset` : "none",
  };
}

function inboxMenuStyle(): CSSProperties {
  return {
    position: "absolute",
    top: "100%",
    left: 0,
    marginTop: 6,
    minWidth: 168,
    borderRadius: radius.md,
    border: "1px solid " + P.cardBorder,
    background: P.surfaceElevated,
    boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
    zIndex: 80,
    padding: 8,
  };
}

const menuLabelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 650,
  color: P.textMuted,
  padding: "4px 6px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

function menuItemStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    textAlign: "left",
    padding: "6px 8px",
    borderRadius: radius.sm,
    fontSize: 12,
    background: active ? "rgba(255,255,255,0.06)" : "transparent",
    border: "none",
    cursor: "pointer",
    color: active ? P.text : P.textSecondary,
    fontWeight: active ? 650 : 450,
  };
}

function MenuDivider() {
  return <div style={{ height: 1, background: color.border, margin: "6px 0" }} />;
}

const loadMoreButtonStyle: CSSProperties = {
  padding: "7px 18px",
  fontSize: 12,
  fontWeight: 550,
  borderRadius: radius.md,
  border: "0.5px solid rgba(120,113,108,0.3)",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

function draftActionButtonStyle(primary: boolean): CSSProperties {
  return {
    height: 24,
    padding: "0 8px",
    borderRadius: radius.sm,
    border: `0.5px solid ${primary ? color.borderStrong : color.border}`,
    background: primary ? "var(--surface-strong)" : "transparent",
    color: primary ? color.text : color.textSecondary,
    fontSize: 11,
    fontWeight: primary ? 650 : 550,
    cursor: "pointer",
  };
}

function InboxSectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ padding: "10px 8px 5px", display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 650, color: P.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </span>
      <span style={{ fontSize: 11, color: P.textMuted }}>({count})</span>
    </div>
  );
}

function findInboxEventAgent(event: OrchestrationCompanyInboxEvent, agents: OrchestrationAgent[]) {
  const agentKey = event.agentId?.trim().toLowerCase();
  const agentName = (event.agentName ?? event.requestedByName)?.trim().toLowerCase();

  return agents.find((agent) => (
    (agentKey && (agent.id.toLowerCase() === agentKey || agent.slug.toLowerCase() === agentKey)) ||
    (agentName && (agent.name.toLowerCase() === agentName || agent.slug.toLowerCase() === agentName))
  ));
}

function InboxAgentAvatar({ event, agents, size = 22 }: { event: OrchestrationCompanyInboxEvent; agents: OrchestrationAgent[]; size?: number }) {
  const agent = findInboxEventAgent(event, agents);
  return <AssigneeAvatar agent={agent} size={size} title={agent?.name ?? "Unassigned"} />;
}

function TimelineActorAvatar({ label, agents, size = 26 }: { label?: string; agents: OrchestrationAgent[]; size?: number }) {
  const actor = label?.trim();
  const agent = actor
    ? agents.find((item) =>
        item.name.toLowerCase() === actor.toLowerCase() ||
        item.id.toLowerCase() === actor.toLowerCase() ||
        item.slug.toLowerCase() === actor.toLowerCase()
      )
    : undefined;
  const avatarUrl = agent ? resolveAvatar(agent) : undefined;
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
    );
  }
  if (agent?.emoji) return <AvatarGlyph value={agent.emoji} size={size - 2} />;
  return (
    <span style={{ width: size, height: size, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: `0.5px solid ${color.border}`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: color.textMuted, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
      {(actor || "S").slice(0, 1).toUpperCase()}
    </span>
  );
}

function InboxListItem({
  event,
  agents,
  selected,
  onSelect,
  onDismiss,
  onReviewDraft,
  onApproveDraft,
  onRejectDraft,
}: {
  event: OrchestrationCompanyInboxEvent;
  agents: OrchestrationAgent[];
  selected: boolean;
  onSelect: () => void;
  onDismiss: () => void;
  onReviewDraft?: (event: OrchestrationCompanyInboxEvent) => void;
  onApproveDraft?: (event: OrchestrationCompanyInboxEvent) => void;
  onRejectDraft?: (event: OrchestrationCompanyInboxEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isUnread = !event.isRead;
  const title = inboxEventTitle(event);
  const activitySummary = inboxActivitySummary(event, title);
  const showDraftDecisionActions = event.kind === "sprint_plan_draft" && !event.draftMaterialized;
  const subtitleParts = [
    event.taskKey,
    event.agentName ?? event.requestedByName,
    event.projectName,
  ].filter(Boolean);
  const failed = event.eventType === "execution.failed";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        width: "100%",
        display: "block",
        position: "relative",
        textAlign: "left",
        border: "0.5px solid " + (selected ? color.borderStrong : "transparent"),
        borderRadius: radius.md,
        background: selected ? color.surfaceElevated : "transparent",
        padding: "9px 10px",
        marginBottom: 2,
        cursor: "pointer",
        boxShadow: selected ? `inset 2px 0 0 ${color.accent}` : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: isUnread ? "#3b82f6" : "transparent", flexShrink: 0 }} />
        <div style={{ flexShrink: 0 }}>
          {event.kind === "approval" && !event.agentName && !event.agentId && !event.requestedByName ? (
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--surface-elevated)", border: "0.5px solid var(--border)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <UserPlus size={12} color={P.textSecondary} />
            </span>
          ) : (
            <InboxAgentAvatar event={event} agents={agents} />
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 44px", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, lineHeight: 1.3, color: failed ? "#fca5a5" : isUnread ? P.text : P.textSecondary, fontWeight: isUnread || selected ? 650 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {title}
            </span>
            <span style={{ fontSize: 11, color: P.textMuted, whiteSpace: "nowrap", justifySelf: "end", opacity: hovered ? 0 : 1, transition: "opacity 100ms ease" }}>{formatAge(event.timestamp)}</span>
          </div>
          <div style={{ marginTop: 3, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            {event.status && <StatusDot status={event.status} />}
            <span style={{ fontSize: 11, color: P.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {subtitleParts.length > 0 ? subtitleParts.join(" · ") : eventVerb(event)}
            </span>
          </div>
          {activitySummary && (
            <div style={{ marginTop: 3, fontSize: 11, lineHeight: 1.25, color: selected ? P.textSecondary : P.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activitySummary}
            </div>
          )}
          {event.kind === "sprint_plan_draft" ? (
            <div
              style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
              onClick={(mouseEvent) => mouseEvent.stopPropagation()}
            >
              <button type="button" onClick={() => onReviewDraft?.(event)} style={draftActionButtonStyle(true)}>
                Review
              </button>
              {showDraftDecisionActions ? (
                <>
                  <button type="button" onClick={() => onApproveDraft?.(event)} style={draftActionButtonStyle(false)}>
                    Approve as proposed
                  </button>
                  <button type="button" onClick={() => onRejectDraft?.(event)} style={draftActionButtonStyle(false)}>
                    Reject
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
        title="Archive inbox item"
        style={{
          position: "absolute",
          right: 8,
          top: 7,
          width: 24,
          height: 24,
          borderRadius: 999,
          border: `0.5px solid ${color.border}`,
          background: selected ? color.surfaceElevated : color.surface,
          color: color.textMuted,
          opacity: hovered ? 1 : 0,
          pointerEvents: hovered ? "auto" : "none",
          transition: "opacity 100ms ease, background 100ms ease, color 100ms ease",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function InboxSprintGroupsView({
  grouped,
  agents,
  selectedEventId,
  onSelect,
  onDismiss,
  onReviewDraft,
  onApproveDraft,
  onRejectDraft,
  companyCode,
}: {
  grouped: ReturnType<typeof groupBySprint<InboxGroupedEvent>>;
  agents: OrchestrationAgent[];
  selectedEventId: string | null;
  onSelect: (event: OrchestrationCompanyInboxEvent) => void;
  onDismiss: (event: OrchestrationCompanyInboxEvent) => void;
  onReviewDraft: (event: OrchestrationCompanyInboxEvent) => void;
  onApproveDraft: (event: OrchestrationCompanyInboxEvent) => void;
  onRejectDraft: (event: OrchestrationCompanyInboxEvent) => void;
  companyCode: string;
}) {
  return (
    <SprintGroupedList
      grouped={grouped}
      mode="sprint"
      companyCode={companyCode}
      persistenceKeyPrefix={`hr:inbox:collapse:${companyCode}`}
      itemCountLabel="items"
      unassignedLabel="Unassigned"
      empty={(
        <div style={{ padding: "36px 18px", textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 14, color: P.textSecondary }}>No sprint-attributed activity yet.</p>
          <Link href={buildCanonicalCompanyPath(companyCode, "/goals")} style={{ display: "inline-block", marginTop: 8, fontSize: 12, color: P.textMuted }}>
            Open goals
          </Link>
        </div>
      )}
      renderItem={(event) => (
        <InboxListItem
          key={event.id}
          event={event}
          agents={agents}
          selected={event.id === selectedEventId}
          onSelect={() => onSelect(event)}
          onDismiss={() => onDismiss(event)}
          onReviewDraft={onReviewDraft}
          onApproveDraft={onApproveDraft}
          onRejectDraft={onRejectDraft}
        />
      )}
    />
  );
}

function InboxReader({
  event,
  taskData,
  loading,
  company,
  projects,
  agents,
  slug,
  onRefresh,
}: {
  event: OrchestrationCompanyInboxEvent | null;
  taskData: SelectedTaskData | null;
  loading: boolean;
  company: OrchestrationCompany | null;
  projects: OrchestrationProject[];
  agents: OrchestrationAgent[];
  slug: string;
  onRefresh: () => Promise<void>;
}) {
  const [commentDraft, setCommentDraft] = useState("");
  const [commentAttachments, setCommentAttachments] = useState<UploadedAttachment[]>([]);
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<OrchestrationTaskTimelineItem | null>(null);
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [reopenOnComment, setReopenOnComment] = useState(false);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [inlineReplyToId, setInlineReplyToId] = useState<string | null>(null);
  const [inlineReplyDraft, setInlineReplyDraft] = useState("");
  const [inlineReplyAttachments, setInlineReplyAttachments] = useState<Record<string, UploadedAttachment[]>>({});
  const [postingReply, setPostingReply] = useState(false);
  const [commentExpansion, setCommentExpansion] = useState<Record<string, boolean>>({});
  const [copiedCommentId, setCopiedCommentId] = useState<string | null>(null);
  const [executionOpen, setExecutionOpen] = useState(false);
  const [readerTab, setReaderTab] = useState<ReaderTabKey>("comments");
  const [subtaskCreating, setSubtaskCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localWorkingRun, setLocalWorkingRun] = useState<LocalWorkingRun | null>(null);
  const readerScrollRef = useRef<HTMLDivElement | null>(null);
  const [unsubscribedTasks, setUnsubscribedTasks] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem("mc:inbox:unsubscribed-tasks") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });

  const task = taskData?.task;
  const detail = taskData?.detail;
  const title = event ? inboxEventTitle(event) : task?.title ?? "";
  const description = task?.description?.trim();
  const companyCode = company?.code ?? slug;
  const selectedProject = task?.project
    ? projects.find((project) => project.id === task.project || project.slug === task.project || project.name === task.project)
    : undefined;
  const displayProject = event?.projectName ?? task?.project;
  const displayProjectColor =
    event?.projectColor ??
    projects.find((project) =>
      project.id === event?.projectId ||
      project.slug === event?.projectSlug ||
      project.name === displayProject
    )?.color ??
    (displayProject ? hashStringToColor(displayProject) : undefined);
  const timeline = detail?.timeline ?? [];
  const runTimeline = timeline.filter(isRunHistoryEvent);
  const visibleTimeline = visibleActivityTimeline(timeline);
  const commentTimeline = visibleTimeline.filter(isCommentTimelineItem);
  const activityTimeline = visibleTimeline.filter((item) => !isCommentTimelineItem(item));
  const childTasks = detail?.childTasks ?? [];
  const defaultExpandedCommentId = null;
  const taskId = task?.id ?? null;
  const readerSelectionKey = taskId ?? event?.id ?? null;
  const isUnsubscribed = taskId ? unsubscribedTasks.has(taskId) : false;
  const voiceLaunchAgent = task?.assignee
    ? agents.find((agent) =>
        agent.id === task.assignee ||
        agent.name === task.assignee ||
        agent.slug === task.assignee
      ) ?? null
    : null;
  const voiceBindingRequest = useMemo<VoiceBindingRequest | null>(() => {
    if (!task) return null;
    const req: VoiceBindingRequest = {
      companySlug: slug,
      taskId: task.id,
      mode: "discuss",
      source: "task-detail",
    };
    const projectId = selectedProject?.id ?? task.project;
    if (projectId) req.projectId = projectId;
    if (selectedProject?.slug) req.projectSlug = selectedProject.slug;
    if (task.key ?? event?.taskKey) req.taskKey = task.key ?? event?.taskKey;
    if (voiceLaunchAgent?.id) req.agentId = voiceLaunchAgent.id;
    return req;
  }, [event?.taskKey, selectedProject?.id, selectedProject?.slug, slug, task, voiceLaunchAgent?.id]);
  const visibleWorkingRun = detail?.runSummary.activeRun
    ? {
        taskId: task?.id ?? "",
        runId: detail.runSummary.activeRun.id,
        agentName: task?.assignee ?? event?.agentName ?? "Agent",
        startedAt: detail.runSummary.activeRun.startedAt ?? new Date().toISOString(),
        provider: detail.runSummary.activeRun.provider,
        label: "working" as const,
      }
    : localWorkingRun && localWorkingRun.taskId === task?.id
      ? localWorkingRun
      : null;
  const pollingTaskId = taskId;
  const pollingRunId = visibleWorkingRun?.runId ?? null;
  const pollingStartedAt = visibleWorkingRun?.startedAt ?? null;
  const workingRunEvents = visibleWorkingRun
    ? runTimeline
        .filter((item) => {
          if (!visibleWorkingRun.runId) return true;
          const metadataRunId = metadataString(item.metadata, ["runId", "run_id", "executionRunId"]);
          return item.linkedRunId === visibleWorkingRun.runId || metadataRunId === visibleWorkingRun.runId;
        })
        .slice()
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    : [];
  const approvalHref = event?.kind === "approval" && event.approvalId
    ? eventTargetHref(companyCode, event)
    : null;
  const approvalStatusLabel = event?.approvalStatus
    ? event.approvalStatus.replace(/_/g, " ")
    : "pending";

  useEffect(() => {
    setLocalWorkingRun(null);
    setExecutionOpen(false);
    setCommentExpansion({});
    setCommentDraft("");
    setCommentAttachments([]);
    setReplyTo(null);
    setReplyTarget(null);
    setInlineReplyToId(null);
    setInlineReplyDraft("");
    setInlineReplyAttachments({});
    setCopiedCommentId(null);
    setReaderTab("comments");
    setReopenOnComment(false);
    setVoiceModalOpen(false);
  }, [taskId]);

  useEffect(() => {
    if (!readerSelectionKey) return;
    const scrollEl = readerScrollRef.current;
    if (!scrollEl) return;
    requestAnimationFrame(() => {
      scrollEl.scrollTo({
        top: 0,
        behavior: "auto",
      });
    });
  }, [readerSelectionKey]);

  useEffect(() => {
    if (!localWorkingRun || localWorkingRun.taskId !== task?.id) return;
    if (detail?.runSummary.activeRun?.id === localWorkingRun.runId) {
      setLocalWorkingRun(null);
      return;
    }
    if (localWorkingRun.runId && detail?.runSummary.latestRun?.id === localWorkingRun.runId && !detail.runSummary.activeRun) {
      setLocalWorkingRun(null);
    }
  }, [detail?.runSummary.activeRun, detail?.runSummary.latestRun, localWorkingRun, task?.id]);

  useEffect(() => {
    if (!pollingTaskId || !pollingStartedAt) return;
    const timer = window.setInterval(() => {
      void onRefresh();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [onRefresh, pollingTaskId, pollingRunId, pollingStartedAt]);

  const showCommentWakeFeedback = (result: Awaited<ReturnType<typeof addTaskCommentWithResult>>) => {
    if (!task || !result.heartbeat?.attempted || !result.heartbeat.queued) return;
    setLocalWorkingRun({
      taskId: task.id,
      runId: result.heartbeat.runId,
      agentName: task.assignee ?? event?.agentName ?? "Agent",
      startedAt: new Date().toISOString(),
      provider: detail?.runSummary.activeRun?.provider ?? detail?.runSummary.latestRun?.provider,
      label: result.heartbeat.status === "running" ? "working" : "waking",
    });
  };

  if (!event) {
    return (
      <main style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, background: color.bg }}>
        <div style={{ textAlign: "center", color: P.textMuted }}>
          <InboxIcon size={24} />
          <p style={{ margin: "10px 0 0", fontSize: 14 }}>Select an inbox item to view details.</p>
        </div>
      </main>
    );
  }

  const toggleUnsubscribe = () => {
    if (!taskId) return;
    setUnsubscribedTasks((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      localStorage.setItem("mc:inbox:unsubscribed-tasks", JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const toggleCommentExpanded = (id: string, defaultExpanded: boolean) => {
    setCommentExpansion((current) => ({
      ...current,
      [id]: !(current[id] ?? defaultExpanded),
    }));
  };

  const submitComment = async () => {
    const attachmentsText = attachmentMarkdown(commentAttachments);
    const body = [commentDraft.trim(), attachmentsText].filter(Boolean).join("\n\n");
    if (!task || !body || posting) return;
    setPosting(true);
    const replyPrefix = replyTo
      ? `Replying to ${replyTo.actorLabel ?? replyTo.source} (${formatMinuteTimestamp(replyTo.timestamp)}):\n> ${(replyTo.body || replyTo.summary).replace(/\n/g, "\n> ").slice(0, 700)}\n\n`
      : "";
    const result = await addTaskCommentWithResult(task.id, `${replyPrefix}${body}`);
    if (result.ok) {
      if (reopenOnComment && (task.status === "done" || task.status === "cancelled")) {
        await updateTaskStatus(task.id, "backlog");
        setReopenOnComment(false);
      }
      showCommentWakeFeedback(result);
      setCommentDraft("");
      setCommentAttachments([]);
      setReplyTo(null);
      if (replyTarget && replyTarget !== task.assignee) {
        await updateTaskAssignee(task.id, replyTarget);
        setReplyTarget(null);
      }
      await onRefresh();
    }
    setPosting(false);
  };

  const submitInlineReply = async (item: OrchestrationTaskTimelineItem) => {
    const attachments = inlineReplyAttachments[item.id] ?? [];
    const attachmentsText = attachmentMarkdown(attachments);
    const body = [inlineReplyDraft.trim(), attachmentsText].filter(Boolean).join("\n\n");
    if (!task || !body || postingReply) return;
    setPostingReply(true);
    const replyPrefix = `Replying to ${item.actorLabel ?? item.source} (${formatMinuteTimestamp(item.timestamp)}):\n> ${(item.body || item.summary).replace(/\n/g, "\n> ").slice(0, 700)}\n\n`;
    const result = await addTaskCommentWithResult(task.id, `${replyPrefix}${body}`);
    if (result.ok) {
      showCommentWakeFeedback(result);
      setInlineReplyDraft("");
      setInlineReplyToId(null);
      setInlineReplyAttachments((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await onRefresh();
    }
    setPostingReply(false);
  };

  const createSubtask = async () => {
    if (!task || subtaskCreating) return;
    const subtaskTitle = window.prompt("Sub-task title");
    if (!subtaskTitle?.trim()) return;
    setSubtaskCreating(true);
    const created = await createTask({
      company: slug,
      title: subtaskTitle.trim(),
      description: `Sub-task of ${task.key ?? task.id}: ${task.title}`,
      priority: task.priority,
      status: "backlog",
      assignee: task.assignee,
      projectId: task.project || null,
      parentTaskId: task.id,
    });
    if (created) await onRefresh();
    setSubtaskCreating(false);
  };

  const uploadAttachments = async (files: File[]): Promise<UploadedAttachment[]> => {
    if (!task || uploading || files.length === 0) return [];
    setUploading(true);
    try {
      const formData = new FormData();
      for (const file of files) formData.append("files", file);
      formData.append("taskId", task.id);
      const response = await fetch("/api/tasks/attachments", { method: "POST", body: formData });
      if (response.ok) {
        const payload = await response.json() as { attachments?: UploadedAttachment[] };
        return payload.attachments ?? [];
      }
      return [];
    } finally {
      setUploading(false);
    }
  };

  const appendCommentAttachment = async (files: File[]) => {
    const attachments = await uploadAttachments(files);
    if (attachments.length > 0) setCommentAttachments((current) => [...current, ...attachments]);
  };

  const appendInlineReplyAttachment = async (files: File[], itemId: string) => {
    setInlineReplyToId(itemId);
    const attachments = await uploadAttachments(files);
    if (attachments.length > 0) {
      setInlineReplyAttachments((current) => ({
        ...current,
        [itemId]: [...(current[itemId] ?? []), ...attachments],
      }));
    }
  };

  const copyTaskKey = async () => {
    const key = task?.key ?? event.taskKey;
    if (!key || typeof navigator === "undefined") return;
    await navigator.clipboard?.writeText(`${key} ${title}`.trim());
  };

  const renderCommentCard = (item: OrchestrationTaskTimelineItem) => {
    const expandedByDefault = item.id === defaultExpandedCommentId || defaultCommentExpanded(item);
    return (
      <ActivityCommentCard
        key={item.id}
        item={item}
        agents={agents}
        companySlug={companyCode}
        collapsed={!(commentExpansion[item.id] ?? expandedByDefault)}
        onToggle={() => toggleCommentExpanded(item.id, expandedByDefault)}
        copied={copiedCommentId === item.id}
        onCopy={() => {
          const body = item.body || item.summary;
          void navigator.clipboard?.writeText(body);
          setCopiedCommentId(item.id);
          window.setTimeout(() => {
            setCopiedCommentId((current) => current === item.id ? null : current);
          }, 1500);
        }}
        replyOpen={inlineReplyToId === item.id}
        replyValue={inlineReplyToId === item.id ? inlineReplyDraft : ""}
        replyAttachments={inlineReplyAttachments[item.id] ?? []}
        postingReply={postingReply && inlineReplyToId === item.id}
        onStartReply={() => {
          setReplyTo(item);
          setInlineReplyToId(null);
          setInlineReplyDraft("");
          setReaderTab("comments");
          requestAnimationFrame(() => {
            const scrollEl = readerScrollRef.current;
            if (!scrollEl) return;
            scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
          });
        }}
        onCancelReply={() => {
          setInlineReplyToId(null);
          setInlineReplyDraft("");
          setInlineReplyAttachments((current) => {
            const next = { ...current };
            delete next[item.id];
            return next;
          });
        }}
        onReplyChange={setInlineReplyDraft}
        onSubmitReply={() => void submitInlineReply(item)}
        uploading={uploading}
        onReplyFiles={(files) => void appendInlineReplyAttachment(files, item.id)}
        onRemoveReplyAttachment={(attachmentId) => {
          setInlineReplyAttachments((current) => ({
            ...current,
            [item.id]: (current[item.id] ?? []).filter((attachment) => attachment.id !== attachmentId),
          }));
        }}
      />
    );
  };

  return (
    <>
    <main style={{ minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", background: color.bg }}>
      <div ref={readerScrollRef} className="hr-inbox-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>
        <div style={{ maxWidth: "none", margin: 0 }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
            {event.status && <StatusDot status={event.status} />}
            {task?.priority && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: color.textSecondary }}>
                <PriorityBars priority={task.priority} size={16} />
                {formatPriority(task.priority)}
              </span>
            )}
            {(task?.key ?? event.taskKey) && (
              <span style={{ fontSize: 12, color: color.textMuted, fontFamily: font.mono, whiteSpace: "nowrap" }}>
                {task?.key ?? event.taskKey}
              </span>
            )}
            {displayProject && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: color.textMuted }}>
                {displayProjectColor && <span style={{ width: 8, height: 8, borderRadius: 999, background: displayProjectColor }} />}
                {displayProject}
              </span>
            )}
            {(task?.key ?? event.taskKey) && (
              <button
                type="button"
                onClick={() => void copyTaskKey()}
                title="Copy task ID and title"
                style={{
                  marginLeft: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 8px",
                  fontSize: 11,
                  color: color.textMuted,
                  background: "transparent",
                  border: `0.5px solid ${color.border}`,
                  borderRadius: radius.sm,
                  cursor: "pointer",
                }}
              >
                <Copy size={12} />
                Copy
              </button>
            )}
          </div>
          <h2 style={{ margin: 0, fontSize: 26, lineHeight: 1.12, fontWeight: 700, color: P.text, letterSpacing: 0 }}>
            {title}
          </h2>

          {approvalHref && (
            <div style={{
              marginTop: 14,
              border: `0.5px solid ${color.border}`,
              borderRadius: radius.md,
              background: color.surfaceElevated,
              padding: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: color.text, fontSize: 14, fontWeight: 650 }}>
                  <UserPlus size={15} />
                  Approval request
                </div>
                <div style={{ marginTop: 5, color: color.textMuted, fontSize: 12, lineHeight: 1.4 }}>
                  {event.requestedByName ? `${event.requestedByName} requested this approval.` : "This item needs a user decision."}
                  {" "}
                  Status: {approvalStatusLabel}.
                </div>
              </div>
              <Link
                href={approvalHref}
                style={{
                  height: 34,
                  padding: "0 12px",
                  borderRadius: radius.md,
                  border: `0.5px solid ${color.borderStrong}`,
                  background: "transparent",
                  color: color.text,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 13,
                  fontWeight: 650,
                  whiteSpace: "nowrap",
                }}
              >
                Open approval
                <ExternalLink size={13} />
              </Link>
            </div>
          )}

          {loading ? (
            <p style={{ margin: "28px 0", color: P.textMuted, fontSize: 14 }}>Loading task detail...</p>
          ) : description ? (
            <div style={{ marginTop: 14, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: P.textSecondary, lineHeight: 1.5, fontSize: 14 }}>{description}</div>
          ) : (
            <div style={{ marginTop: 14, color: P.textMuted, fontSize: 14 }}>No description yet.</div>
          )}

          <section style={{ marginTop: 24, borderTop: `0.5px solid ${color.border}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottom: `0.5px solid ${color.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                {([
                  ["comments", `Comments (${commentTimeline.length})`, MessageSquare] as const,
                  ["subtasks", `Subtasks${childTasks.length ? ` (${childTasks.length})` : ""}`, GitBranch] as const,
                  ["activity", "Activity", Clock] as const,
                ]).map(([key, label, TabIcon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setReaderTab(key)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "12px 15px",
                      background: "transparent",
                      border: "none",
                      borderBottom: readerTab === key ? `2px solid ${color.accent}` : "2px solid transparent",
                      marginBottom: -1,
                      color: readerTab === key ? color.text : color.textMuted,
                      fontSize: 13,
                      fontWeight: 550,
                      cursor: "pointer",
                    }}
                  >
                    <TabIcon size={13} />
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {task && (
                  <button type="button" onClick={toggleUnsubscribe} style={{ border: "none", background: "transparent", color: isUnsubscribed ? color.accent : color.textMuted, fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <BellOff size={13} />
                    {isUnsubscribed ? "Unsubscribed" : "Unsubscribe"}
                  </button>
                )}
                <SubscriberGroup>
                  <SubscriberAvatar label={PUBLIC_HUMAN_LABEL} initials="O" />
                  {task?.assignee && <SubscriberAvatar label={task.assignee} assignee={task.assignee} agents={agents} />}
                </SubscriberGroup>
              </div>
            </div>

            <div style={{ paddingTop: 16 }}>
              {readerTab === "comments" && (
                <>
                  {commentTimeline.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {commentTimeline.map(renderCommentCard)}
                    </div>
                  ) : (
                    <div style={{ border: "0.5px solid var(--border)", borderRadius: radius.md, padding: "18px", color: P.textMuted, fontSize: 14 }}>
                      No comments loaded for this item yet.
                    </div>
                  )}
                </>
              )}

              {readerTab === "subtasks" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                    <button
                      type="button"
                      onClick={() => void createSubtask()}
                      disabled={!task || subtaskCreating}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 10px",
                        fontSize: 12,
                        color: task ? color.textSecondary : color.textMuted,
                        background: "transparent",
                        border: `0.5px solid ${color.border}`,
                        borderRadius: radius.sm,
                        cursor: task && !subtaskCreating ? "pointer" : "default",
                      }}
                    >
                      <Plus size={12} />
                      {subtaskCreating ? "Adding..." : "Add subtask"}
                    </button>
                  </div>
                  {childTasks.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {childTasks.map((child) => (
                        <Link
                          key={child.id}
                          href={buildCanonicalCompanyPath(companyCode, `/tasks/${encodeURIComponent(child.key ?? child.id)}`)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            padding: "10px 12px",
                            borderRadius: radius.md,
                            border: `0.5px solid ${color.border}`,
                            background: "rgba(255,255,255,0.02)",
                            textDecoration: "none",
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: color.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {child.key ? `${child.key} · ${child.title}` : child.title}
                            </div>
                            <div style={{ marginTop: 3, fontSize: 11, color: color.textMuted }}>
                              {STATUS_LABEL[child.status] ?? child.status} · {child.priority} · {child.assignee ?? "Unassigned"}
                            </div>
                          </div>
                          <span style={{ fontSize: 11, color: color.textMuted, flexShrink: 0 }}>{relativeAge(child.updated)}</span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: "22px 0", fontSize: 13, color: color.textMuted, textAlign: "center" }}>
                      No subtasks yet.
                    </div>
                  )}
                </div>
              )}

              {readerTab === "activity" && (
                <>
                  <ExecutionHistoryInline
                    open={executionOpen}
                    onToggle={() => setExecutionOpen((value) => !value)}
                    runSummary={detail?.runSummary}
                    events={runTimeline}
                  />

                  {visibleWorkingRun && (
                    <WorkingRunBanner
                      agentName={visibleWorkingRun.agentName}
                      startedAt={visibleWorkingRun.startedAt}
                      provider={visibleWorkingRun.provider}
                      label={visibleWorkingRun.label}
                      events={workingRunEvents}
                    />
                  )}

                  {activityTimeline.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {activityTimeline.map((item) => <ActivityEventRow key={item.id} item={item} agents={agents} />)}
                    </div>
                  ) : (
                    <div style={{ border: "0.5px solid var(--border)", borderRadius: radius.md, padding: "18px", color: P.textMuted, fontSize: 14 }}>
                      No activity events loaded for this item yet.
                    </div>
                  )}
                </>
              )}
            </div>

            {task && readerTab === "comments" && (
              <CommentComposer
                value={commentDraft}
                attachments={commentAttachments}
                onChange={setCommentDraft}
                posting={posting}
                uploading={uploading}
                replyTo={replyTo}
                agents={agents}
                replyTarget={replyTarget}
                onReplyTargetChange={setReplyTarget}
                taskStatus={task.status}
                reopenOnComment={reopenOnComment}
                onReopenChange={setReopenOnComment}
                onTalk={() => setVoiceModalOpen(true)}
                talkDisabled={!voiceLaunchAgent}
                talkTitle={voiceLaunchAgent?.name
                  ? `Talk to ${voiceLaunchAgent.name} about this task`
                  : "Assign an agent to talk about this task"}
                onClearReply={() => setReplyTo(null)}
                onSubmit={() => void submitComment()}
                onFiles={(files) => void appendCommentAttachment(files)}
                onRemoveAttachment={(attachmentId) => setCommentAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))}
              />
            )}
          </section>
        </div>
      </div>
    </main>
    {task && voiceBindingRequest && (
      <TaskVoiceModal
        open={voiceModalOpen}
        onClose={() => setVoiceModalOpen(false)}
        agent={voiceLaunchAgent}
        bindingRequest={voiceBindingRequest}
        taskTitle={task.title}
        projectName={selectedProject?.name ?? displayProject}
        onSessionEnd={() => {
          window.setTimeout(() => {
            void onRefresh();
          }, 900);
        }}
      />
    )}
    </>
  );
}

function activityTone(item: OrchestrationTaskTimelineItem): { icon: ReactNode; accent: string; label: string } {
  const eventType = timelineEventType(item);
  if (eventType === "task.created") {
    return { icon: <User size={12} />, accent: color.textMuted, label: "Created" };
  }
  switch (item.provenance) {
    case "status_change":
      return { icon: <CheckCircle2 size={12} />, accent: color.positive, label: "Status" };
    case "run_event":
    case "engine_event":
      return { icon: <Bot size={12} />, accent: color.accent, label: "Run" };
    case "subtask_event":
      return { icon: <GitBranch size={12} />, accent: color.info, label: "Sub-task" };
    case "approval_event":
      return { icon: <UserPlus size={12} />, accent: color.warning, label: "Approval" };
    case "imported_report":
      return { icon: <Link2 size={12} />, accent: color.accent, label: "Report" };
    default:
      return { icon: <Clock size={12} />, accent: color.textMuted, label: "Activity" };
  }
}

type RunActivityGroup = {
  id: string;
  status: "Completed" | "Failed" | "Running" | "Event";
  timestamp: string;
  duration?: string;
  provider?: string;
  events: OrchestrationTaskTimelineItem[];
};

type RunUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalCostUsd: number;
};
type RunUsageState = {
  key: string;
  totals: RunUsageTotals;
};

function taskRunIdsKey(detail?: OrchestrationTaskDetail): string {
  const ids = new Set<string>();
  if (detail?.runSummary.latestRun?.id) ids.add(detail.runSummary.latestRun.id);
  if (detail?.runSummary.activeRun?.id) ids.add(detail.runSummary.activeRun.id);
  for (const item of detail?.timeline ?? []) {
    if (item.source !== "execution_runs") continue;
    const metadataRunId = metadataString(item.metadata, ["runId", "run_id", "executionRunId"]);
    const runId = item.linkedRunId ?? metadataRunId;
    if (runId) ids.add(runId);
  }
  return Array.from(ids).slice(0, 5).join("|");
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

function metadataString(metadata: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function statusFromRunText(text: string): RunActivityGroup["status"] {
  if (/fail|error|cancel/i.test(text)) return "Failed";
  if (/complete|finished|success|done/i.test(text)) return "Completed";
  if (/start|running|pending|wake/i.test(text)) return "Running";
  return "Event";
}

function formatDurationBetween(startIso?: string, endIso?: string): string | undefined {
  if (!startIso || !endIso) return undefined;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function buildRunGroups(
  events: OrchestrationTaskTimelineItem[],
  runSummary?: OrchestrationTaskDetail["runSummary"],
): RunActivityGroup[] {
  const groups = new Map<string, RunActivityGroup>();
  const hasExecutionRuns = events.some((item) => item.source === "execution_runs");

  for (const item of events) {
    if (hasExecutionRuns && (item.source === "heartbeat_runs" || item.source === "heartbeat_run_events")) {
      continue;
    }
    const fallbackMinute = item.timestamp.slice(0, 16);
    const key = item.linkedRunId ?? metadataString(item.metadata, ["runId", "run_id", "executionRunId"]) ?? `minute:${fallbackMinute}`;
    const current = groups.get(key);
    const status = statusFromRunText(`${item.summary} ${item.body ?? ""}`);
    const provider = metadataString(item.metadata, ["provider", "runtime", "adapter"]);
    if (!current) {
      groups.set(key, {
        id: key,
        status,
        timestamp: item.timestamp,
        provider,
        events: [item],
      });
      continue;
    }
    current.events.push(item);
    if (new Date(item.timestamp).getTime() > new Date(current.timestamp).getTime()) current.timestamp = item.timestamp;
    if (current.status !== "Failed") {
      if (status === "Failed" || status === "Completed" || current.status === "Event") current.status = status;
    }
    if (!current.provider && provider) current.provider = provider;
  }

  const rows = Array.from(groups.values()).map((group) => {
    const sorted = group.events.slice().sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return {
      ...group,
      events: sorted,
      duration: formatDurationBetween(sorted[0]?.timestamp, sorted[sorted.length - 1]?.timestamp),
    };
  });

  if (rows.length === 0 && runSummary?.latestRun) {
    rows.push({
      id: runSummary.latestRun.id,
      status: statusFromRunText(runSummary.latestRun.status),
      timestamp: runSummary.latestRun.finishedAt ?? runSummary.latestRun.startedAt ?? new Date().toISOString(),
      duration: formatDurationBetween(runSummary.latestRun.startedAt, runSummary.latestRun.finishedAt ?? undefined),
      provider: formatRunProvider(runSummary.latestRun.provider),
      events: [],
    });
  }

  const visibleRows = rows.filter((group) => group.status !== "Failed");

  return visibleRows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function runStatusColor(status: RunActivityGroup["status"]): string {
  if (status === "Completed") return color.positive;
  if (status === "Failed") return color.negative;
  if (status === "Running") return color.accent;
  return color.textMuted;
}

function runEventLabel(item: OrchestrationTaskTimelineItem): string {
  const eventType = timelineEventType(item);
  const role = metadataText(item.metadata, "role");
  if (eventType.startsWith("tool_call")) return "Tool";
  if (eventType === "tool_result") return "Result";
  if (eventType.startsWith("assistant_text")) return "Agent";
  if (eventType === "thinking_summary") return "Thinking";
  if (role === "assistant") return "Agent";
  if (role === "tool") return "Tool";
  if (item.source === "execution_runs") return "Run";
  return item.provenance === "engine_event" ? "Agent" : "Run";
}

function runEventDetail(item: OrchestrationTaskTimelineItem): string {
  const title = metadataText(item.metadata, "title");
  const body = item.body?.trim();
  if (title && body && item.summary === title) return `${title} ${body}`;
  return item.summary || body || timelineEventType(item).replace(/_/g, " ");
}

function ExecutionHistoryInline({
  open,
  onToggle,
  runSummary,
  events,
}: {
  open: boolean;
  onToggle: () => void;
  runSummary?: OrchestrationTaskDetail["runSummary"];
  events: OrchestrationTaskTimelineItem[];
}) {
  const runGroups = buildRunGroups(events, runSummary);
  const count = runGroups.length;
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(() => new Set());
  const defaultOpenRunId = runGroups[0]?.id;
  const toggleRun = (id: string) => {
    setExpandedRuns((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          border: "none",
          background: "transparent",
          color: color.textMuted,
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          fontSize: 13,
          cursor: "pointer",
          padding: "3px 0",
        }}
      >
        <ChevronRight size={14} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms ease" }} />
        <Clock size={14} />
        Execution history ({count})
      </button>
      {open && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
          {runGroups.length === 0 ? (
            <div style={{ padding: "6px 0 6px 30px", fontSize: 12, color: color.textMuted }}>No detailed execution events loaded.</div>
          ) : runGroups.map((group) => {
            const expanded = expandedRuns.has(group.id) || (expandedRuns.size === 0 && group.id === defaultOpenRunId);
            const statusColor = runStatusColor(group.status);
            return (
              <div key={group.id}>
                <button
                  type="button"
                  onClick={() => toggleRun(group.id)}
                  style={{
                    width: "100%",
                    border: "none",
                    borderRadius: 0,
                    background: "transparent",
                    color: color.textSecondary,
                    display: "grid",
                    gridTemplateColumns: "16px 18px minmax(0, 1fr) auto auto",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 0",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 12,
                  }}
                >
                  <ChevronRight size={13} style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 120ms ease" }} />
                  <span style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${statusColor}`, color: statusColor, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    {group.status === "Completed" && <CheckCircle2 size={11} />}
                  </span>
                  <span style={{ minWidth: 0, display: "inline-flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                    <span style={{ whiteSpace: "nowrap" }}>{formatMinuteTimestamp(group.timestamp)}</span>
                    {group.duration && <span style={{ color: color.textMuted, whiteSpace: "nowrap" }}>{group.duration}</span>}
                    {group.provider && <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: color.textMuted }}>{group.provider}</span>}
                  </span>
                  <span style={{ color: statusColor, fontWeight: 650, whiteSpace: "nowrap" }}>{group.status}</span>
                  <span style={{ color: color.textMuted, fontSize: 11 }}>{group.events.length || ""}</span>
                </button>
                {expanded && group.events.length > 0 && (
                  <div style={{ margin: "2px 0 4px 34px", borderLeft: `1px solid ${color.border}`, overflow: "hidden" }}>
                    {group.events.slice(0, 10).map((item) => (
                      <div key={item.id} style={{ minHeight: 24, display: "grid", gridTemplateColumns: "16px 70px minmax(0, 1fr)", gap: 8, alignItems: "center", padding: "4px 0 4px 10px", color: color.textMuted, fontSize: 12 }}>
                        <ChevronRight size={12} />
                        <span style={{ color: item.provenance === "engine_event" ? color.accent : color.textSecondary, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {runEventLabel(item)}
                        </span>
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{runEventDetail(item)}</span>
                      </div>
                    ))}
                    {group.events.length > 10 && (
                      <div style={{ padding: "4px 0 6px 104px", fontSize: 12, color: color.textMuted }}>
                        {group.events.length - 10} more events
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WorkingRunBanner({
  agentName,
  startedAt,
  provider,
  label,
  events,
}: {
  agentName: string;
  startedAt?: string;
  provider?: string;
  label?: "waking" | "working";
  events?: OrchestrationTaskTimelineItem[];
}) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const actionText = label === "waking" ? "is waking up" : "is working";
  const visibleEvents = (events ?? []).slice(-8);
  return (
    <>
      <button
        type="button"
        onClick={() => setTranscriptOpen(true)}
        style={{
          width: "100%",
          margin: "8px 0 12px",
          borderRadius: radius.md,
          border: `0.5px solid rgba(59,130,246,0.5)`,
          background: "rgba(59,130,246,0.075)",
          color: color.text,
          display: "grid",
          gridTemplateColumns: "26px 16px minmax(0, 1fr) auto auto",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 13,
        }}
      >
        <span style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: `0.5px solid ${color.border}`, color: color.textMuted, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Bot size={14} />
        </span>
        <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid rgba(59,130,246,0.3)`, borderTopColor: color.info, display: "inline-block" }} />
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <strong style={{ fontWeight: 700 }}>{agentName}</strong> {actionText}
          {startedAt ? <span style={{ color: color.textMuted, marginLeft: 8 }}>{relativeAge(startedAt)}</span> : null}
        </span>
        {provider && <span style={{ color: color.textMuted, fontSize: 12, whiteSpace: "nowrap" }}>{formatRunProvider(provider)}</span>}
        <span style={{ color: color.textMuted, fontSize: 12, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {visibleEvents.length ? `${visibleEvents.length} steps` : "Starting"}
          <Expand size={13} />
        </span>
      </button>
      {transcriptOpen && (
        <RunTranscriptOverlay
          title={`${agentName} ${actionText}`}
          subtitle={[provider ? formatRunProvider(provider) : null, startedAt ? relativeAge(startedAt) : null, visibleEvents.length ? `${visibleEvents.length} recent steps` : "Starting"].filter(Boolean).join(" · ")}
          events={visibleEvents}
          onClose={() => setTranscriptOpen(false)}
        />
      )}
    </>
  );
}

function RunTranscriptOverlay({
  title,
  subtitle,
  events,
  onClose,
}: {
  title: string;
  subtitle: string;
  events: OrchestrationTaskTimelineItem[];
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        background: "rgba(0,0,0,0.46)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "44px 24px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(880px, calc(100vw - 48px))",
          maxHeight: "calc(100vh - 88px)",
          overflow: "hidden",
          border: `0.5px solid ${color.border}`,
          borderRadius: radius.lg,
          background: color.surface,
          boxShadow: "0 24px 70px rgba(0,0,0,0.45)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `0.5px solid ${color.border}` }}>
          <Bot size={15} color={color.textMuted} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: color.text }}>{title}</div>
            {subtitle && <div style={{ marginTop: 2, fontSize: 11, color: color.textMuted }}>{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} title="Close transcript" style={{ border: "none", background: "transparent", color: color.textMuted, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4 }}>
            ×
          </button>
        </div>
        <div style={{ maxHeight: "calc(100vh - 170px)", overflowY: "auto", padding: "8px 14px 14px" }}>
          {events.length === 0 ? (
            <div style={{ color: color.textMuted, fontSize: 13, padding: "10px 0" }}>Waiting for the first run step...</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {events.map((item, index) => (
                <div key={item.id} style={{ display: "grid", gridTemplateColumns: "70px minmax(0, 1fr) 34px", gap: 10, alignItems: "start", padding: "8px 0", borderTop: index === 0 ? "none" : `0.5px solid ${color.border}` }}>
                  <span style={{ color: item.provenance === "engine_event" ? color.accent : color.textSecondary, fontWeight: 700, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {runEventLabel(item)}
                  </span>
                  <span style={{ minWidth: 0, color: color.textSecondary, fontSize: 12, lineHeight: 1.45, overflowWrap: "anywhere" }}>
                    {runEventDetail(item)}
                  </span>
                  <span style={{ color: color.textMuted, fontSize: 11, justifySelf: "end" }}>#{index + 1}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityEventRow({ item, agents }: { item: OrchestrationTaskTimelineItem; agents: OrchestrationAgent[] }) {
  const tone = activityTone(item);
  const label = activityEventText(item);
  const toStatus = metadataText(item.metadata, "toStatus")?.replace(/_/g, "-") as TaskStatus | undefined;
  const eventType = timelineEventType(item);
  const icon = eventType === "task.created"
    ? <TimelineActorAvatar label={displayActorName(item.actorLabel)} agents={agents} size={18} />
    : eventType === "task.status_changed" && toStatus
      ? <StatusDot status={toStatus} />
      : tone.icon;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `${ACTIVITY_ICON_RAIL}px minmax(0, 1fr) ${ACTIVITY_TIME_RAIL}px`, gap: ACTIVITY_RAIL_GAP, alignItems: "center", color: color.textSecondary, fontSize: 13, padding: `3px ${ACTIVITY_SIDE_INSET}px` }}>
      <span style={{ width: 18, height: 18, borderRadius: "50%", background: eventType === "task.status_changed" || eventType === "task.created" ? "transparent" : "rgba(255,255,255,0.05)", color: tone.accent, display: "inline-flex", alignItems: "center", justifyContent: "center", justifySelf: "center" }}>
        {icon}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ color: color.textMuted, fontSize: 12, whiteSpace: "nowrap", justifySelf: "end" }}>{relativeAge(item.timestamp)}</span>
    </div>
  );
}

function ActivityCommentCard({
  item,
  agents,
  companySlug,
  collapsed,
  onToggle,
  copied,
  onCopy,
  replyOpen,
  replyValue,
  replyAttachments,
  postingReply,
  onStartReply,
  onCancelReply,
  onReplyChange,
  onSubmitReply,
  uploading,
  onReplyFiles,
  onRemoveReplyAttachment,
}: {
  item: OrchestrationTaskTimelineItem;
  agents: OrchestrationAgent[];
  companySlug: string;
  collapsed: boolean;
  onToggle: () => void;
  copied: boolean;
  onCopy: () => void;
  replyOpen: boolean;
  replyValue: string;
  replyAttachments: UploadedAttachment[];
  postingReply: boolean;
  onStartReply: () => void;
  onCancelReply: () => void;
  onReplyChange: (value: string) => void;
  onSubmitReply: () => void;
  uploading: boolean;
  onReplyFiles: (files: File[]) => void;
  onRemoveReplyAttachment: (attachmentId: string) => void;
}) {
  const actor = displayActorName(item.actorLabel ?? item.source);
  const body = item.body || item.summary;
  const voiceSession = isVoiceSessionComment(item);
  const eventLabel = voiceSession ? `${PUBLIC_HUMAN_LABEL} and ${actor} voice session` : `${actor} commented`;
  const age = relativeAge(item.timestamp);
  const commentOutline = color.border;
  return (
    <div style={{ border: `0.5px solid ${commentOutline}`, borderRadius: radius.md, background: color.surface, overflow: "hidden" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: `${ACTIVITY_ICON_RAIL}px 28px minmax(0, 1fr)`,
        alignItems: "center",
        gap: ACTIVITY_RAIL_GAP,
        padding: collapsed ? `7px ${ACTIVITY_SIDE_INSET}px` : `8px ${ACTIVITY_SIDE_INSET}px 7px`,
        background: color.surface,
        borderBottom: collapsed ? "none" : `0.5px solid ${commentOutline}`,
      }}>
        <button type="button" onClick={onToggle} title={collapsed ? "Expand comment" : "Collapse comment"} style={{ width: 22, height: 22, borderRadius: 6, border: "none", background: "transparent", color: color.textMuted, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 2 }}>
          <ChevronRight size={14} style={{ transform: collapsed ? "none" : "rotate(90deg)", transition: "transform 120ms ease" }} />
        </button>
        <TimelineActorAvatar label={actor} agents={agents} size={22} />
        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: color.text, whiteSpace: "nowrap" }}>{eventLabel}</span>
          <span style={{ color: color.textMuted, fontSize: 12, whiteSpace: "nowrap" }} title={formatMinuteTimestamp(item.timestamp)}>{age}</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              title="Reply to comment"
              onClick={(event) => {
                event.stopPropagation();
                onStartReply();
              }}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 2,
                color: color.textMuted,
                opacity: 0.5,
                display: "inline-flex",
                alignItems: "center",
              }}
              onMouseEnter={(event) => { event.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(event) => { event.currentTarget.style.opacity = "0.5"; }}
            >
              <MessageSquare size={11} />
            </button>
            <button
              type="button"
              title={copied ? "Copied" : "Copy comment"}
              onClick={(event) => {
                event.stopPropagation();
                onCopy();
              }}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 2,
                color: color.textMuted,
                opacity: 0.5,
                display: "inline-flex",
                alignItems: "center",
              }}
              onMouseEnter={(event) => { event.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(event) => { event.currentTarget.style.opacity = "0.5"; }}
            >
              {copied ? (
                <span style={{ fontSize: 10, fontWeight: 700, color: color.positive }}>Copied</span>
              ) : (
                <Copy size={11} />
              )}
            </button>
          </span>
        </div>
      </div>
      {!collapsed && (
        <>
          <div style={{ padding: "13px 22px 15px", fontSize: 14, color: color.textSecondary, lineHeight: 1.55, overflowWrap: "anywhere" }}>
            <MarkdownText text={body} companySlug={companySlug} taskKeyPrefix={companySlug} />
          </div>
          <div style={{ borderTop: `0.5px solid ${color.border}`, padding: `7px ${ACTIVITY_SIDE_INSET}px 8px` }}>
            <InlineActivityComposer
              value={replyOpen ? replyValue : ""}
              attachments={replyAttachments}
              placeholder="Leave a reply..."
              posting={postingReply}
              uploading={uploading}
              onActivate={onStartReply}
              onCancel={replyOpen ? onCancelReply : undefined}
              onChange={onReplyChange}
              onSubmit={onSubmitReply}
              onFiles={onReplyFiles}
              onRemoveAttachment={onRemoveReplyAttachment}
            />
          </div>
        </>
      )}
    </div>
  );
}

function CommentComposer({
  value,
  attachments,
  onChange,
  posting,
  uploading,
  replyTo,
  agents,
  replyTarget,
  onReplyTargetChange,
  taskStatus,
  reopenOnComment,
  onReopenChange,
  onTalk,
  talkDisabled,
  talkTitle,
  onClearReply,
  onSubmit,
  onFiles,
  onRemoveAttachment,
}: {
  value: string;
  attachments: UploadedAttachment[];
  onChange: (value: string) => void;
  posting: boolean;
  uploading: boolean;
  replyTo: OrchestrationTaskTimelineItem | null;
  agents: OrchestrationAgent[];
  replyTarget: string | null;
  onReplyTargetChange: (value: string | null) => void;
  taskStatus?: TaskStatus;
  reopenOnComment: boolean;
  onReopenChange: (value: boolean) => void;
  onTalk: () => void;
  talkDisabled: boolean;
  talkTitle: string;
  onClearReply: () => void;
  onSubmit: () => void;
  onFiles: (files: File[]) => void;
  onRemoveAttachment: (attachmentId: string) => void;
}) {
  const showReopen = taskStatus === "done" || taskStatus === "cancelled";
  const [replyPickerOpen, setReplyPickerOpen] = useState(false);
  const replyPickerRef = useRef<HTMLDivElement>(null);
  const canSubmit = (value.trim().length > 0 || attachments.length > 0) && !posting;

  const handleFiles = (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => file.size > 0);
    if (list.length === 0) return;
    onFiles(list);
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const directFiles = Array.from(event.clipboardData.files ?? []);
    const itemFiles = Array.from(event.clipboardData.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const files = directFiles.length > 0 ? directFiles : itemFiles;
    if (files.length === 0) return;
    event.preventDefault();
    handleFiles(files);
  };

  useEffect(() => {
    if (!replyPickerOpen) return;
    const close = (event: MouseEvent) => {
      if (replyPickerRef.current && !replyPickerRef.current.contains(event.target as Node)) setReplyPickerOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [replyPickerOpen]);

  return (
    <div style={{ marginTop: 12 }}>
      {replyTo && (
        <div style={{ padding: "0 4px 8px", display: "flex", alignItems: "center", gap: 8, color: color.textMuted, fontSize: 12 }}>
          Replying to {replyTo.actorLabel ?? replyTo.source}
          <button type="button" onClick={onClearReply} style={{ marginLeft: "auto", border: "none", background: "transparent", color: color.textMuted, cursor: "pointer" }}>×</button>
        </div>
      )}
      <div style={{ border: `0.5px solid ${color.border}`, borderRadius: radius.md, background: color.surface, padding: 10 }}>
        <textarea
          value={value}
          placeholder={replyTo ? "Leave a reply..." : "Leave a comment..."}
          rows={3}
          onPaste={handlePaste}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
          style={{
            width: "100%",
            minHeight: 56,
            resize: "vertical",
            border: "none",
            outline: "none",
            background: "transparent",
            color: color.text,
            fontSize: 13,
            lineHeight: 1.45,
            fontFamily: "inherit",
          }}
        />
        {attachments.length > 0 && (
          <AttachmentDraftPreview attachments={attachments} onRemove={onRemoveAttachment} />
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <label
            title={uploading ? "Uploading..." : "Attach or paste files"}
            style={{
              cursor: uploading ? "wait" : "pointer",
              display: "inline-flex",
              padding: 4,
              color: uploading ? color.accent : color.textMuted,
            }}
          >
            <Link2 size={14} color={uploading ? color.accent : color.textMuted} />
            <input
              type="file"
              multiple
              style={{ display: "none" }}
              disabled={uploading}
              onChange={(event) => {
                if (event.target.files) handleFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          {agents.length > 0 && (
            <div ref={replyPickerRef} style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setReplyPickerOpen((value) => !value)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 8px",
                  borderRadius: 6,
                  fontSize: 11,
                  border: `0.5px solid ${replyTarget ? "rgba(217,119,6,0.4)" : color.border}`,
                  background: replyTarget ? "rgba(217,119,6,0.08)" : "transparent",
                  color: replyTarget ? color.accent : color.textSecondary,
                  cursor: "pointer",
                }}
              >
                <AtSign size={11} />
                {replyTarget
                  ? agents.find((agent) => agent.name === replyTarget || agent.slug === replyTarget || agent.id === replyTarget)?.name ?? replyTarget
                  : "Assign"}
              </button>
              {replyPickerOpen && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 4px)",
                    left: 0,
                    background: "var(--surface-elevated)",
                    border: `0.5px solid ${color.border}`,
                    borderRadius: 8,
                    padding: "4px 0",
                    minWidth: 170,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
                    zIndex: 40,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => { onReplyTargetChange(null); setReplyPickerOpen(false); }}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "7px 12px",
                      fontSize: 12,
                      color: !replyTarget ? color.text : color.textSecondary,
                      background: !replyTarget ? "rgba(255,255,255,0.05)" : "transparent",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    No assignment change
                  </button>
                  {agents.map((agent) => {
                    const selected = replyTarget === agent.name;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => { onReplyTargetChange(agent.name); setReplyPickerOpen(false); }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          width: "100%",
                          padding: "7px 12px",
                          fontSize: 12,
                          color: selected ? color.text : color.textSecondary,
                          background: selected ? "rgba(255,255,255,0.05)" : "transparent",
                          border: "none",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        {(() => {
                          const avatar = resolveAvatar(agent);
                          return avatar
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={avatar} alt="" style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                            : <AvatarGlyph value={agent.emoji} size={13} />;
                        })()}
                        {agent.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {showReopen && (
            <label style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              color: color.textSecondary,
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 6,
              border: `0.5px solid ${reopenOnComment ? "rgba(59,130,246,0.4)" : color.border}`,
              background: reopenOnComment ? "rgba(59,130,246,0.08)" : "transparent",
            }}>
              <input
                type="checkbox"
                checked={reopenOnComment}
                onChange={(event) => onReopenChange(event.target.checked)}
                style={{
                  appearance: "none",
                  WebkitAppearance: "none",
                  width: 13,
                  height: 13,
                  borderRadius: 3,
                  flexShrink: 0,
                  border: `1.5px solid ${reopenOnComment ? "#3b82f6" : "rgba(120,113,108,0.5)"}`,
                  background: reopenOnComment ? "#3b82f6" : "transparent",
                  cursor: "pointer",
                }}
              />
              <RotateCcw size={11} />
              Re-open
            </label>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: color.text }}>⌘ + Enter</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onTalk();
            }}
            disabled={talkDisabled}
            title={talkTitle}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              fontSize: 12,
              fontWeight: 600,
              background: color.surfaceElevated,
              color: talkDisabled ? color.textMuted : color.accent,
              border: `0.5px solid ${talkDisabled ? color.border : "rgba(217,119,6,0.24)"}`,
              borderRadius: 6,
              cursor: talkDisabled ? "not-allowed" : "pointer",
            }}
          >
            <Mic size={12} />
            Talk
          </button>
          <button
            type="button"
            onClick={() => onSubmit()}
            disabled={!canSubmit}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              background: canSubmit ? color.surfaceHover : color.surfaceElevated,
              color: canSubmit ? color.text : color.textSecondary,
              border: `0.5px solid ${color.border}`,
              borderRadius: 6,
              cursor: canSubmit ? "pointer" : "default",
            }}
          >
            {posting ? "Posting..." : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InlineActivityComposer({
  value,
  attachments,
  placeholder,
  posting,
  uploading,
  onActivate,
  onCancel,
  onChange,
  onSubmit,
  onFiles,
  onRemoveAttachment,
}: {
  value: string;
  attachments: UploadedAttachment[];
  placeholder: string;
  posting: boolean;
  uploading: boolean;
  onActivate?: () => void;
  onCancel?: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onFiles: (files: File[]) => void;
  onRemoveAttachment: (attachmentId: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const expanded = value.trim().length > 0 || value.includes("\n") || attachments.length > 0;
  const canSubmit = (value.trim().length > 0 || attachments.length > 0) && !posting;

  const handleFiles = (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => file.size > 0);
    if (list.length === 0) return;
    onActivate?.();
    onFiles(list);
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const directFiles = Array.from(event.clipboardData.files ?? []);
    const itemFiles = Array.from(event.clipboardData.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const files = directFiles.length > 0 ? directFiles : itemFiles;
    if (files.length > 0) {
      event.preventDefault();
      handleFiles(files);
    }
  };

  const activate = () => {
    onActivate?.();
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div
      onClick={activate}
      style={{
        background: "transparent",
        overflow: "visible",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) 28px 28px 30px", gap: 10, alignItems: expanded ? "start" : "center", padding: expanded ? "8px 0" : "4px 0" }}>
        <span style={{ width: COMPOSER_AVATAR_SIZE, height: COMPOSER_AVATAR_SIZE, borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: `0.5px solid ${color.border}`, color: color.textSecondary, display: "inline-flex", alignItems: "center", justifyContent: "center", justifySelf: "center", alignSelf: expanded ? "start" : "center", marginTop: expanded ? 4 : 0, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
          T
        </span>
        <div style={{ minWidth: 0 }}>
          <textarea
            ref={textareaRef}
            value={value}
            placeholder={placeholder}
            rows={expanded ? 3 : 1}
            onPaste={handlePaste}
            onChange={(event) => {
              onActivate?.();
              onChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }}
            style={{
              width: "100%",
              minHeight: expanded ? 72 : 28,
              maxHeight: 240,
              resize: expanded ? "vertical" : "none",
              border: "none",
              outline: "none",
              background: "transparent",
              color: color.text,
              fontSize: 13,
              lineHeight: 1.45,
              fontFamily: "inherit",
              padding: expanded ? "1px 0" : "4px 0 0",
              overflow: expanded ? "auto" : "hidden",
            }}
          />
          {attachments.length > 0 && (
            <AttachmentDraftPreview attachments={attachments} onRemove={onRemoveAttachment} />
          )}
          {expanded && onCancel && (
            <button type="button" onClick={(event) => { event.stopPropagation(); onCancel(); }} style={{ border: "none", background: "transparent", color: color.textMuted, cursor: "pointer", fontSize: 12, padding: "6px 0 0" }}>
              Cancel
            </button>
          )}
        </div>
        <button type="button" title="Expand composer" onClick={(event) => { event.stopPropagation(); activate(); }} style={composerIconButtonStyle(false)}>
          <Expand size={14} />
        </button>
        <label title={uploading ? "Uploading..." : "Attach or paste files"} style={composerIconButtonStyle(uploading)}>
          <Link2 size={15} />
          <input
            type="file"
            multiple
            style={{ display: "none" }}
            disabled={uploading}
            onChange={(event) => {
              if (event.target.files) handleFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onSubmit(); }}
          disabled={!canSubmit}
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            border: `0.5px solid ${color.border}`,
            background: canSubmit ? color.accent : color.surfaceHover,
            color: canSubmit ? "#fff" : color.textMuted,
            cursor: canSubmit ? "pointer" : "default",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
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
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

function composerIconButtonStyle(active: boolean): CSSProperties {
  return {
    border: "none",
    background: "transparent",
    color: active ? color.accent : color.textMuted,
    cursor: active ? "wait" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 7,
    padding: 0,
  };
}

function InboxDetailsPanel({
  event,
  taskData,
  projects,
  agents,
  companyCode,
  onStatusChange,
  onPriorityChange,
  onTagsChange,
  onAssigneeChange,
  onProjectChange,
  onExecutionOverrideChange,
  onClose,
  onDismiss,
}: {
  event: OrchestrationCompanyInboxEvent | null;
  taskData: SelectedTaskData | null;
  projects: OrchestrationProject[];
  agents: OrchestrationAgent[];
  companyCode: string;
  onStatusChange: (status: TaskStatus) => void;
  onPriorityChange: (priority: TaskPriority) => void;
  onTagsChange: (tags: string[]) => void;
  onAssigneeChange: (assignee: string) => void;
  onProjectChange: (projectId: string | null) => void;
  onExecutionOverrideChange: (patch: Partial<TaskExecutionOverridePatch>) => void;
  onClose: () => void;
  onDismiss: (event: OrchestrationCompanyInboxEvent) => void;
}) {
  const task = taskData?.task;
  const runSummary = taskData?.detail.runSummary;
  const plannedExecution = taskData?.detail.plannedExecution;
  const activeResolvedExecution = runSummary?.activeRun?.resolvedExecution;
  const latestResolvedExecution = runSummary?.latestRun?.resolvedExecution;
  const executionRunIdsKey = taskRunIdsKey(taskData?.detail);
  const [runUsageState, setRunUsageState] = useState<RunUsageState | null>(null);
  const runUsageTotals = runUsageState?.key === executionRunIdsKey ? runUsageState.totals : null;

  useEffect(() => {
    if (!executionRunIdsKey) return;

    let cancelled = false;
    const loadUsage = async () => {
      try {
        const totals: RunUsageTotals = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalCostUsd: 0,
        };
        const executionRunIds = executionRunIdsKey.split("|").filter(Boolean);
        const metricsRows = await Promise.all(
          executionRunIds.map(async (runId) => {
            const response = await fetch(`/api/orchestration/engine/runs/${encodeURIComponent(runId)}/events`, {
              cache: "no-store",
            });
            if (!response.ok) return null;
            const data = await response.json() as {
              metrics?: Partial<RunUsageTotals>;
            };
            return data.metrics ?? null;
          })
        );
        for (const metrics of metricsRows) {
          if (!metrics) continue;
          totals.inputTokens += metrics.inputTokens ?? 0;
          totals.outputTokens += metrics.outputTokens ?? 0;
          totals.cacheReadInputTokens += metrics.cacheReadInputTokens ?? 0;
          totals.cacheCreationInputTokens += metrics.cacheCreationInputTokens ?? 0;
          totals.totalCostUsd += metrics.totalCostUsd ?? 0;
        }
        if (!cancelled) setRunUsageState({ key: executionRunIdsKey, totals });
      } catch {
        if (!cancelled) setRunUsageState(null);
      }
    };

    void loadUsage();
    return () => {
      cancelled = true;
    };
  }, [executionRunIdsKey]);

  if (!event) {
    return (
      <aside style={{ background: color.bg, padding: "16px 20px 16px 0", minWidth: 0, overflow: "hidden" }}>
        <div style={{ border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface, padding: 18, color: color.textMuted, fontSize: 13 }}>
          No item selected.
        </div>
      </aside>
    );
  }

  const href = eventTargetHref(companyCode, event);
  const targetLabel = event.kind === "approval" ? "Open approval" : "Open task";
  const displayProject = event.projectName ?? task?.project;
  const selectedProject = task?.project ? projects.find((project) => project.id === task.project) : null;
  const sprintId = taskData?.detail.sprintId ?? event.sprintId;
  const sprintKey = taskData?.detail.sprintKey ?? null;
  const sprintName = taskData?.detail.sprintName ?? event.sprintName;
  const companyGoalId = taskData?.detail.companyGoalId ?? event.companyGoalId;
  const companyGoalKey = taskData?.detail.companyGoalKey ?? null;
  const companyGoalName = taskData?.detail.companyGoalName ?? event.companyGoalName;
  const createdBy = (() => {
    const raw = task?.createdBy ?? event.requestedByName;
    if (isLegacyHumanActor(raw)) return PUBLIC_HUMAN_LABEL;
    if (raw === "mission-control" || raw === "pixel-ui") return "HiveRunner";
    if (raw === "system") return "System";
    if (raw) return raw;
    return task?.assignee ?? "System";
  })();

  return (
    <aside style={{ background: color.bg, padding: "16px 20px 16px 0", minWidth: 0, overflow: "hidden" }}>
      <div className="task-detail-scrollbarless hr-inbox-scroll" style={{
        maxHeight: "calc(100vh - 90px)",
        overflowY: "auto",
        background: color.surface,
        border: `0.5px solid ${color.border}`,
        borderRadius: radius.lg,
        padding: `${space.xl}px ${space.xl}px`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: color.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Properties
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: color.textMuted, cursor: "pointer", padding: 2, fontSize: 18, lineHeight: 1 }}
            title="Close properties"
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <DetailRow label="Status">
            {task ? (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <InlineStatusPicker current={task.status} onChange={onStatusChange} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", color: color.text, fontSize: 12 }}>{STATUS_META[task.status]?.label ?? STATUS_LABEL[task.status] ?? task.status}</span>
              </div>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: color.textSecondary, fontSize: 12 }}>
                <StatusDot status={event.status} />
                {event.status ? STATUS_META[event.status]?.label ?? event.status : "Not set"}
              </span>
            )}
          </DetailRow>
          <DetailRow label="Priority">
            {task ? (
              <InlinePriorityPicker current={task.priority} onChange={onPriorityChange} />
            ) : (
              <span style={{ fontSize: 12, color: color.textMuted }}>Not set</span>
            )}
          </DetailRow>
          <DetailRow label="Tags">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: color.textSecondary, minWidth: 0 }}>
              <Tag size={12} />
              {task ? (
                <InlineTagsEditor tags={task.tags ?? []} onChange={onTagsChange} />
              ) : (
                <span>No tags</span>
              )}
            </div>
          </DetailRow>
          <DetailRow label="Assignee">
            {task ? (
              <InlineAssigneePicker current={task.assignee} agents={agents} onChange={onAssigneeChange} />
            ) : (
              <AssigneeInline assignee={event.agentName} agents={agents} />
            )}
          </DetailRow>
          <DetailRow label="Project">
            {task ? (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <InlineProjectPicker
                  currentProjectId={task.project || null}
                  currentProjectName={displayProject}
                  projects={projects}
                  onChange={onProjectChange}
                />
                {selectedProject && (
                  <Link
                    href={`/${encodeURIComponent(companyCode.toUpperCase())}/projects/${encodeURIComponent(selectedProject.slug)}`}
                    title={`Open ${selectedProject.name}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      color: color.textMuted,
                      textDecoration: "none",
                      flexShrink: 0,
                    }}
                  >
                    <ExternalLink size={11} />
                  </Link>
                )}
              </div>
            ) : (
              <span style={{ fontSize: 12, color: color.textSecondary }}>{displayProject ?? "No project"}</span>
            )}
          </DetailRow>
          {sprintId && (
            <>
              <DetailRow label="Sprint">
                <InboxPlanningLink href={buildCanonicalGoalPath(companyCode, sprintKey ?? sprintId)} label={sprintName ?? "Sprint"} />
              </DetailRow>
              {companyGoalId && (
                <DetailRow label="Company goal">
                  <InboxPlanningLink href={buildCanonicalGoalPath(companyCode, companyGoalKey ?? companyGoalId)} label={companyGoalName ?? "Company goal"} />
                </DetailRow>
              )}
            </>
          )}
          {(plannedExecution || activeResolvedExecution || latestResolvedExecution) && (
            <ExecutionEnvironmentPanel
              task={task}
              planned={plannedExecution}
              active={activeResolvedExecution}
              latest={latestResolvedExecution}
              onOverrideChange={onExecutionOverrideChange}
            />
          )}

          <div style={{ height: 1, background: color.border, margin: "4px 0" }} />

          <DetailRow label="Created by">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: color.textMuted, minWidth: 0 }}>
              <User size={12} />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{createdBy}</span>
            </span>
          </DetailRow>
          <DetailRow label="Created">
            <span style={{ fontSize: 12, color: color.textMuted }}>{task?.created ? formatShortDate(task.created) : formatShortDate(event.timestamp)}</span>
          </DetailRow>
          <DetailRow label="Updated">
            <span style={{ fontSize: 12, color: color.textMuted }}>{relativeAge(task?.updated ?? event.timestamp)}</span>
          </DetailRow>
          {task?.completedAt && (
            <DetailRow label="Completed at">
              <span style={{ fontSize: 12, color: color.textMuted }}>{formatShortDate(task.completedAt)}</span>
            </DetailRow>
          )}

          {runSummary && (
            <>
              <div style={{ height: 1, background: color.border, margin: "4px 0" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: color.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Run Usage
                </div>
                <DetailRow label="Runs" value={String(runSummary.totalRuns)} compact />
                {runSummary.latestRun && (
                  <DetailRow
                    label="Latest"
                    value={`${formatRunProvider(runSummary.latestRun.provider)} ${runSummary.latestRun.status}`.trim()}
                    compact
                  />
                )}
                {runSummary.latestRun?.workspaceChangedDuringRunCount !== undefined && (
                  <DetailRow
                    label="Files"
                    value={
                      runSummary.latestRun.workspaceWarningCount
                        ? `${runSummary.latestRun.workspaceChangedDuringRunCount} changed · ${runSummary.latestRun.workspaceWarningCount} warning`
                        : `${runSummary.latestRun.workspaceChangedDuringRunCount} changed`
                    }
                    compact
                  />
                )}
                {runSummary.activeRun && (
                  <DetailRow
                    label="Active"
                    value={`${formatRunProvider(runSummary.activeRun.provider)} ${runSummary.activeRun.status}`.trim()}
                    compact
                  />
                )}
                {runUsageTotals && (
                  <>
                    <DetailRow label="Input" value={formatCompactNumber(runUsageTotals.inputTokens)} compact />
                    <DetailRow label="Output" value={formatCompactNumber(runUsageTotals.outputTokens)} compact />
                    <DetailRow
                      label="Cache"
                      value={`${formatCompactNumber(runUsageTotals.cacheReadInputTokens)} read / ${formatCompactNumber(runUsageTotals.cacheCreationInputTokens)} write`}
                      compact
                    />
                    <DetailRow label="Cost" value={formatUsd(runUsageTotals.totalCostUsd)} compact />
                  </>
                )}
              </div>
            </>
          )}

          <div style={{ height: 1, background: color.border, margin: "4px 0" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Link href={href} style={{ height: 34, borderRadius: radius.md, border: "0.5px solid " + color.border, display: "inline-flex", alignItems: "center", justifyContent: "center", color: color.textSecondary, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
              {targetLabel}
            </Link>
            <button type="button" onClick={() => onDismiss(event)} style={{ height: 34, borderRadius: radius.md, border: "0.5px solid " + color.border, background: "transparent", color: color.textMuted, cursor: "pointer", fontSize: 13 }}>
              Archive inbox item
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function InboxPlanningLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      style={{
        minWidth: 0,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        color: color.textSecondary,
        textDecoration: "none",
        fontSize: 12,
      }}
      title={label}
    >
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <ExternalLink size={11} style={{ flexShrink: 0, color: color.textMuted }} />
    </Link>
  );
}

function InlineProjectPicker({
  currentProjectId,
  currentProjectName,
  projects,
  onChange,
}: {
  currentProjectId: string | null;
  currentProjectName?: string;
  projects: OrchestrationProject[];
  onChange: (projectId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selectedProject = currentProjectId ? projects.find((project) => project.id === currentProjectId) : null;
  const label = selectedProject?.name ?? currentProjectName ?? "No project";
  const projectColor = selectedProject?.color ?? (label && label !== "No project" ? hashStringToColor(label) : P.textMuted);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 0, display: "inline-flex" }}>
      <button
        type="button"
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen((value) => !value); }}
        style={{
          minWidth: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          border: "none",
          background: "transparent",
          color: color.textSecondary,
          fontSize: 12,
          cursor: "pointer",
          padding: "2px 4px",
          borderRadius: radius.sm,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: projectColor, flexShrink: 0 }} />
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 60, marginTop: 5, minWidth: 210, maxWidth: 260, border: "1px solid " + P.cardBorder, borderRadius: radius.md, background: P.surfaceElevated, boxShadow: "0 16px 36px rgba(0,0,0,0.35)", padding: 6 }}>
          <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onChange(null); setOpen(false); }} style={projectMenuItemStyle(!currentProjectId)}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: P.textMuted, flexShrink: 0 }} />
            No project
          </button>
          {projects.map((project) => (
            <button key={project.id} type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onChange(project.id); setOpen(false); }} style={projectMenuItemStyle(project.id === currentProjectId)}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: project.color || hashStringToColor(project.name), flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function projectMenuItemStyle(active: boolean): CSSProperties {
  return {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: "none",
    borderRadius: radius.sm,
    background: active ? "rgba(255,255,255,0.06)" : "transparent",
    color: P.textSecondary,
    cursor: "pointer",
    fontSize: 12,
    padding: "7px 8px",
    textAlign: "left",
  };
}

function AssigneeInline({ assignee, agents }: { assignee?: string; agents: OrchestrationAgent[] }) {
  if (!assignee) {
    return <span style={{ fontSize: 12, color: color.textMuted }}>Unassigned</span>;
  }

  const agent = agents.find(
    (item) => item.name.toLowerCase() === assignee.toLowerCase() || item.id.toLowerCase() === assignee.toLowerCase() || item.slug.toLowerCase() === assignee.toLowerCase()
  );
  const avatarUrl = agent ? resolveAvatar(agent) : undefined;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 12, color: color.textSecondary }}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
      ) : agent ? (
        <AvatarGlyph value={agent.emoji} size={14} />
      ) : (
        <span style={{ width: 16, height: 16, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: `0.5px solid ${color.border}`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: color.textMuted, fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
          {assignee.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent?.name ?? assignee}</span>
    </span>
  );
}

function SubscriberAvatar({
  label,
  initials,
  assignee,
  agents = [],
}: {
  label: string;
  initials?: string;
  assignee?: string;
  agents?: OrchestrationAgent[];
}) {
  const agent = assignee
    ? agents.find(
      (item) => item.name.toLowerCase() === assignee.toLowerCase() || item.id.toLowerCase() === assignee.toLowerCase() || item.slug.toLowerCase() === assignee.toLowerCase()
    )
    : undefined;
  const avatarUrl = agent ? resolveAvatar(agent) : undefined;
  const displayLabel = agent?.name ?? label;

  return (
    <span
      title={displayLabel}
      style={{
        width: 24,
        height: 24,
        borderRadius: "50%",
        background: "rgba(255,255,255,0.07)",
        border: `0.5px solid ${color.border}`,
        color: color.textSecondary,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 700,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : agent ? (
        <AvatarGlyph value={agent.emoji} size={18} />
      ) : (
        initials ?? displayLabel.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

function SubscriberGroup({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", paddingLeft: 2 }}>
      {Array.isArray(children)
        ? children.map((child, index) => (
          <span key={index} style={{ display: "inline-flex", marginLeft: index === 0 ? 0 : -7 }}>
            {child}
          </span>
        ))
        : children}
    </span>
  );
}

function ExecutionEnvironmentPanel({
  task,
  planned,
  active,
  latest,
  onOverrideChange,
}: {
  task?: OrchestrationTask | null;
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
          fontSize: 11,
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
        {task ? (
          <TaskExecutionOverrideControls task={task} onChange={onOverrideChange} />
        ) : null}
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
  const selectStyle: CSSProperties = {
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
  const labelStyle: CSSProperties = {
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
              fontSize: 11,
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

function DetailRow({
  label,
  value,
  status,
  compact = false,
  children,
}: {
  label: string;
  value?: string;
  status?: TaskStatus;
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: compact ? "0" : "0" }}>
      <span style={{ width: 96, fontSize: 11, color: color.textMuted, flexShrink: 0, whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, display: "inline-flex", alignItems: "center", gap: 7, justifyContent: "flex-start", color: color.textSecondary, fontSize: 12, overflow: "visible", textTransform: label === "Type" ? "capitalize" : "none" }}>
        {children ?? (
          <>
            {status && <StatusDot status={status} />}
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value ?? "Not set"}</span>
          </>
        )}
      </div>
    </div>
  );
}

function formatPriority(priority: OrchestrationTask["priority"]): string {
  switch (priority) {
    case "P0": return "Critical";
    case "P1": return "High";
    case "P2": return "Medium";
    case "P3": return "Low";
    default: return priority;
  }
}
