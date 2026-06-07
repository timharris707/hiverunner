import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  RunTraceView,
  type RunEventsResponse,
  type TimelineEvent,
} from "@/components/orchestration/RunTraceView";
import { buildRunTraceViewModel } from "@/lib/orchestration/run-trace";

const now = Date.parse("2026-06-06T20:00:00.000Z");

function event(id: string, kind: TimelineEvent["kind"], offsetMs: number, summary = id): TimelineEvent {
  return {
    id,
    kind,
    summary,
    ts: now + offsetMs,
    source: "execution_transcript",
  };
}

function metrics(overrides: Partial<RunEventsResponse["metrics"]> = {}): RunEventsResponse["metrics"] {
  return {
    durationMs: 60_000,
    promptChars: 1200,
    promptBuildMs: 50,
    totalDurationMs: 60_000,
    thinkingDurationMs: null,
    actionExecutionMs: 500,
    importDurationMs: 40,
    messageCountBefore: 4,
    sessionReused: false,
    inputTokens: 120,
    outputTokens: 80,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null,
    totalCostUsd: 0.05,
    messagesImported: 1,
    actionsFound: 1,
    actionsExecuted: 1,
    actionsSkippedDedup: null,
    reportsImported: null,
    approvalsCreated: null,
    tasksCreated: null,
    assistantTextLength: 140,
    plainTextLength: null,
    errorCount: null,
    ...overrides,
  };
}

function baseResponse(overrides: Partial<RunEventsResponse> = {}): RunEventsResponse {
  const response: RunEventsResponse = {
    run: {
      id: "run-1",
      agentId: "agent-1",
      agentName: "Samantha",
      agentSlug: "samantha",
      agentEmoji: "sparkles",
      companyId: "company-1",
      status: "completed",
      providerId: "codex",
      invocationSource: "codex",
      triggerDetail: null,
      startedAt: new Date(now).toISOString(),
      finishedAt: new Date(now + 60_000).toISOString(),
      durationMs: 60_000,
      wakeupRequestId: "wake-1",
      idempotencyKey: "idem-1",
      sessionIdBefore: null,
      sessionIdAfter: "session-1",
      usage: { totalCostUsd: 0.05 },
      result: { actionsFound: 1, actionsExecuted: 1 },
      exitCode: 0,
      error: null,
      createdAt: new Date(now).toISOString(),
    },
    task: {
      id: "task-1",
      title: "Extract shared RunTraceView",
      key: "INS-210",
      status: "in_progress",
      priority: "critical",
    },
    context: {
      wakeSource: "issue_assigned",
      wakeReason: "engine_auto_task_assignment",
      direction: "Keep the work moving until done.",
      directionTaskId: "task-1",
      issueId: "INS-210",
      taskKey: "INS-210",
    },
    invocation: {
      providerId: "codex",
      runTable: "execution_runs",
      wakeupRequestId: "wake-1",
      idempotencyKey: "idem-1",
      wakeupStatus: "completed",
      requestedAt: new Date(now - 1000).toISOString(),
      claimedAt: new Date(now).toISOString(),
      completedAt: new Date(now + 60_000).toISOString(),
      linkedHeartbeatCount: 1,
      note: "Execution run invocation evidence.",
    },
    metrics: metrics(),
    resolvedExecution: undefined,
    workspaceRunVisibility: {
      schema: "hiverunner.workspace_run_visibility.v1",
      capturedAt: new Date(now + 60_000).toISOString(),
      readOnlyIntent: false,
      roots: [{
        root: "/workspace",
        exists: true,
        isGitRepo: true,
        beforeDirtyCount: 0,
        afterDirtyCount: 1,
        changedDuringRunCount: 1,
        changedDuringRun: [{ path: "src/components/orchestration/RunTraceView.tsx", before: null, after: "M", changeType: "added" }],
        beforeEntries: [],
        afterEntries: [],
        warning: null,
      }],
      totals: {
        trackedRoots: 1,
        gitRoots: 1,
        beforeDirtyCount: 0,
        afterDirtyCount: 1,
        changedDuringRunCount: 1,
      },
      warnings: [],
    },
    providerExecution: {
      source: "codex",
      cliCommand: "codex exec",
      modelId: "gpt-5",
      modelName: "GPT-5",
      factoryBuildId: null,
      factoryTaskId: null,
      factoryTaskTitle: null,
      openclawRunId: null,
      openclawStatus: null,
      structuredTelemetry: true,
      observedLiveText: true,
      observedThinking: false,
      observedStructuredTools: true,
      toolCallNames: ["apply_patch"],
      assistantSummary: "Implemented the shared view.",
      thinkingSummary: null,
      resultSubtype: null,
      resultErrors: [],
      linkedHeartbeatCount: 1,
      note: "Provider execution summary.",
    },
    skillEffectiveness: {
      events: [{
        id: "skill-1",
        skillId: "skill-1",
        skillSlug: "frontend-implementation-workflow",
        skillName: "Frontend implementation workflow",
        skillVersion: 2,
        eventType: "explicit_use",
        outcome: null,
        source: "agent",
        agentName: "Samantha",
        taskKey: "INS-210",
        note: "Applied focused frontend implementation workflow.",
        createdAt: new Date(now + 30_000).toISOString(),
      }],
      totals: {
        availableCount: 1,
        explicitUseCount: 1,
        passCount: 0,
        failCount: 0,
        blockedCount: 0,
        unknownCount: 0,
      },
    },
    memoryEvidence: { evidence: [{ id: "memory-1" }] },
    transcript: {
      entries: [{
        id: "transcript-1",
        body: "Final answer in clean Markdown.",
        type: "assistant_text_final",
        source: "codex",
        authorName: "Samantha",
        ts: now + 45_000,
        eventKind: "assistant_text_final",
        role: "assistant",
      }],
      provenance: {
        label: "Provider transcript events",
        note: "Provider output was normalized into transcript events.",
        totalEntries: 1,
        source: "execution_run_transcript_events",
        fullTranscriptAvailable: true,
      },
    },
    timeline: [
      event("started", "run_start", 0, "Run started"),
      event("assistant", "assistant_text_final", 45_000, "Assistant produced final output"),
      event("artifact", "run_progress", 50_000, "registered artifact"),
      event("memory", "run_progress", 52_000, "memory receipt"),
      event("review", "run_progress", 53_000, "review state updated"),
      event("done", "run_end", 60_000, "Run completed"),
    ],
    provenance: {
      timeline: {
        label: "Provider transcript events",
        note: "Timeline includes normalized provider transcript events.",
        sources: ["execution_runs", "execution_run_transcript_events"],
      },
      runTable: "execution_runs",
    },
    provider: {
      id: "codex",
      displayName: "Codex",
      tier: 4,
      tierLabel: "Structured tools",
      capabilities: {
        liveText: true,
        actionDetection: true,
        structuredTools: true,
        thinking: true,
        runSteering: true,
        persistedTranscript: true,
      },
    },
    ...overrides,
  };
  return { ...response, trace: buildRunTraceViewModel(response) };
}

function render(data: RunEventsResponse, live = false) {
  return renderToStaticMarkup(
    <RunTraceView
      data={data}
      companyHref={(subpath) => `/companies/insight${subpath}`}
      routeKind="task"
      taskKey="INS-210"
      isLive={live}
      liveStreamingText={live ? "still working" : null}
      nowMs={now + 30_000}
    />,
  );
}

const completedHtml = render(baseResponse());
assert.match(completedHtml, /Execution timeline/);
assert.match(completedHtml, /Trace coverage/);
assert.match(completedHtml, /Trace annotations deferred/);
assert.match(completedHtml, /voice-session or task-comment scoped/);
assert.match(completedHtml, /Raw trace metadata/);
assert.match(completedHtml, /Workspace changes/);
assert.match(completedHtml, /Runtime skills/);
assert.doesNotMatch(completedHtml, /Eval capture suggestion/);
assert.ok(completedHtml.indexOf("Execution timeline") < completedHtml.indexOf("Invocation &amp; session"));

const suggestedHtml = render(baseResponse({
  evalCaseSuggestion: {
    schema: "hiverunner.eval_case_suggestion.v1",
    outcome: "accepted",
    source: "review_status_event",
    title: "Accepted run suggested for eval capture",
    detail: "A reviewer accepted this run from the review lane. Save only after operator confirmation.",
    defaultRationale: "Accepted after review: reusable trace evidence.",
    reviewerAgentId: "reviewer-1",
    reviewerName: "Gator",
    reviewedAt: "2026-06-06T21:00:00.000Z",
    requiresOperatorConfirmation: true,
    requiresLowCaptureConfirmation: true,
    requiresFailedTraceConfirmation: false,
    warnings: ["Trace capture quality is partial; saving requires low-capture confirmation."],
  },
}));
assert.match(suggestedHtml, /Accepted run suggested for eval capture/);
assert.match(suggestedHtml, /Operator confirmation required/);
assert.match(suggestedHtml, /Save as eval case/);
assert.match(suggestedHtml, /Trace capture quality is partial/);
assert.match(suggestedHtml, /Evidence gap:/);

const failedHtml = render(baseResponse({
  run: {
    ...baseResponse().run,
    id: "run-failed",
    status: "failed",
    error: "Command exited with code 1",
    exitCode: 1,
  },
  metrics: metrics({ errorCount: 1, totalCostUsd: null }),
  timeline: [
    event("started-failed", "run_start", 0, "Run started"),
    event("failed", "run_error", 10_000, "Run failed"),
  ],
}));
assert.match(failedHtml, /Failed/);
assert.match(failedHtml, /Command exited with code 1/);
assert.match(failedHtml, /Trace coverage/);

const runningHtml = render(baseResponse({
  run: {
    ...baseResponse().run,
    id: "run-running",
    status: "running",
    finishedAt: null,
    durationMs: null,
  },
  timeline: [
    event("started-running", "run_start", 0, "Run started"),
  ],
}), true);
assert.match(runningHtml, /LIVE/);
assert.match(runningHtml, /Live output/);
assert.match(runningHtml, /still working/);

const minimalHtml = render(baseResponse({
  run: {
    ...baseResponse().run,
    id: "run-minimal",
    status: "succeeded",
    providerId: "none",
    invocationSource: "manual",
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    wakeupRequestId: null,
    idempotencyKey: null,
    sessionIdAfter: null,
    usage: {},
    result: {},
    exitCode: null,
  },
  task: null,
  context: null,
  invocation: {
    providerId: "none",
    runTable: "execution_runs",
    wakeupRequestId: null,
    idempotencyKey: null,
    wakeupStatus: null,
    requestedAt: null,
    claimedAt: null,
    completedAt: null,
    linkedHeartbeatCount: 0,
    note: null,
  },
  metrics: metrics({
    durationMs: null,
    promptChars: null,
    promptBuildMs: null,
    totalDurationMs: null,
    actionExecutionMs: null,
    importDurationMs: null,
    messageCountBefore: null,
    inputTokens: null,
    outputTokens: null,
    totalCostUsd: null,
    messagesImported: null,
    actionsFound: null,
    actionsExecuted: null,
    assistantTextLength: null,
  }),
  workspaceRunVisibility: null,
  skillEffectiveness: {
    events: [],
    totals: { availableCount: 0, explicitUseCount: 0, passCount: 0, failCount: 0, blockedCount: 0, unknownCount: 0 },
  },
  memoryEvidence: null,
  transcript: {
    entries: [],
    provenance: {
      label: "Persisted agent comments",
      note: "No transcript was captured.",
      totalEntries: 0,
      source: "comments",
      fullTranscriptAvailable: false,
    },
  },
  timeline: [],
  provider: {
    id: "none",
    displayName: "Manual",
    tier: 0,
    tierLabel: "Minimal",
    capabilities: {
      liveText: false,
      actionDetection: false,
      structuredTools: false,
      thinking: false,
      runSteering: false,
      persistedTranscript: false,
    },
  },
}));
assert.match(minimalHtml, /Minimal trace/);
assert.match(minimalHtml, /No events recorded for this run/);
assert.match(minimalHtml, /No persisted transcript entries were captured/);

console.log("RunTraceView render states passed");
