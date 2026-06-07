import { expect, test, type Page } from "@playwright/test";

const now = Date.parse("2026-06-06T22:00:00.000Z");

function runTraceResponse(options: {
  runId: string;
  runStatus?: "completed" | "running";
  taskStatus?: string;
  evalCaseSuggestion?: Record<string, unknown> | null;
}) {
  const runStatus = options.runStatus ?? "completed";
  const finishedAt = runStatus === "running" ? null : new Date(now + 45_000).toISOString();
  const durationMs = runStatus === "running" ? null : 45_000;
  const annotations = {
    schema: "hiverunner.run_trace_annotations.v1",
    state: "deferred",
    annotations: [],
    decision: {
      reason: "Trace annotations are deferred for this fixture.",
      notes: [],
    },
  };
  const evidenceGaps = [{
    id: "missing_transcript",
    label: "not_captured",
    title: "Transcript missing",
    detail: "Provider transcript entries were not captured for this run.",
    affectsCaptureQuality: true,
  }];

  return {
    run: {
      id: options.runId,
      agentId: "agent-1",
      agentName: "Samantha",
      agentSlug: "samantha",
      agentEmoji: "sparkles",
      companyId: "company-1",
      status: runStatus,
      providerId: "codex",
      invocationSource: "codex",
      triggerDetail: null,
      startedAt: new Date(now).toISOString(),
      finishedAt,
      durationMs,
      wakeupRequestId: "wake-1",
      idempotencyKey: "idem-1",
      sessionIdBefore: null,
      sessionIdAfter: "session-1",
      usage: { totalCostUsd: 0.04 },
      result: { actionsFound: 1, actionsExecuted: 1 },
      exitCode: 0,
      error: null,
      createdAt: new Date(now).toISOString(),
    },
    task: {
      id: "task-1",
      title: "Add Save as eval case action to Run Trace",
      key: "INS-223",
      status: options.taskStatus ?? "done",
      priority: "critical",
    },
    context: {
      wakeSource: "issue_assigned",
      wakeReason: "engine_auto_task_assignment",
      direction: "Keep the work moving until done.",
      directionTaskId: "task-1",
      issueId: "INS-223",
      taskKey: "INS-223",
    },
    invocation: {
      providerId: "codex",
      runTable: "execution_runs",
      wakeupRequestId: "wake-1",
      idempotencyKey: "idem-1",
      wakeupStatus: runStatus === "running" ? "claimed" : "completed",
      requestedAt: new Date(now - 1000).toISOString(),
      claimedAt: new Date(now).toISOString(),
      completedAt: finishedAt,
      linkedHeartbeatCount: 1,
      note: "Execution run invocation evidence.",
    },
    metrics: {
      durationMs,
      promptChars: 1000,
      promptBuildMs: 50,
      totalDurationMs: durationMs,
      thinkingDurationMs: null,
      actionExecutionMs: 400,
      importDurationMs: 30,
      messageCountBefore: 3,
      sessionReused: false,
      inputTokens: 100,
      outputTokens: 60,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      totalCostUsd: 0.04,
      messagesImported: 1,
      actionsFound: 1,
      actionsExecuted: 1,
      actionsSkippedDedup: null,
      reportsImported: null,
      approvalsCreated: null,
      tasksCreated: null,
      assistantTextLength: 120,
      plainTextLength: null,
      errorCount: null,
    },
    resolvedExecution: null,
    workspaceRunVisibility: null,
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
      assistantSummary: "Implemented the save flow.",
      thinkingSummary: null,
      resultSubtype: null,
      resultErrors: [],
      linkedHeartbeatCount: 1,
      note: "Provider execution summary.",
    },
    skillEffectiveness: {
      events: [],
      totals: { availableCount: 0, explicitUseCount: 0, passCount: 0, failCount: 0, blockedCount: 0, unknownCount: 0 },
    },
    memoryEvidence: null,
    transcript: {
      entries: [{
        id: "transcript-1",
        body: "Final answer in clean Markdown.",
        type: "assistant_text_final",
        source: "codex",
        authorName: "Samantha",
        ts: now + 35_000,
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
      { id: "started", kind: "run_start", summary: "Run started", ts: now, source: "execution_transcript" },
      { id: "review", kind: "run_progress", summary: "Review accepted", ts: now + 40_000, source: "execution_transcript" },
      { id: "done", kind: "run_end", summary: runStatus === "running" ? "Still running" : "Run completed", ts: now + 45_000, source: "execution_transcript" },
    ],
    trace: {
      schema: "hiverunner.run_trace_view.v1",
      evidenceSummary: {
        timelineEventCount: 3,
        transcriptEntryCount: 1,
        hasUsage: true,
        hasRunMetadata: true,
        hasMemoryEvidence: false,
        hasWorkspaceVisibility: false,
        hasSkillEvidence: false,
        hasRawPayload: false,
        categoryCounts: { artifact: 0, memory: 0, review: 1 },
      },
      captureQuality: {
        label: "partial",
        title: "Partial trace",
        detail: "Useful trace evidence was captured, but at least one expected evidence category is missing.",
        missingRequiredEvidence: ["missing_transcript"],
      },
      annotations,
      evidenceGaps,
    },
    traceExport: {
      schema: "hiverunner.run_trace_redacted_export.v1",
      summary: {
        runId: options.runId,
        taskKey: "INS-223",
        copyText: `Run Trace\nRun: ${options.runId}`,
        annotationCount: 0,
      },
      redaction: {
        policy: "hiverunner.run_trace_redaction.v1",
        location: "server",
        totalRedactions: 0,
        categories: {},
      },
      annotations,
      captureQuality: { label: "partial" },
      evidenceGaps,
    },
    evalCaseSuggestion: options.evalCaseSuggestion ?? null,
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
  };
}

function normalAcceptedSuggestion() {
  return {
    schema: "hiverunner.eval_case_suggestion.v1",
    outcome: "accepted",
    source: "review_status_event",
    title: "Accepted run suggested for eval capture",
    detail: "A reviewer accepted this run from the review lane. Save only after operator confirmation.",
    defaultRationale: "Accepted after review: reusable trace evidence.",
    reviewerAgentId: "reviewer-1",
    reviewerName: "Gator",
    reviewedAt: "2026-06-06T22:01:00.000Z",
    requiresOperatorConfirmation: true,
    requiresLowCaptureConfirmation: false,
    requiresFailedTraceConfirmation: false,
    warnings: [],
  };
}

function acceptedSuggestion() {
  return {
    schema: "hiverunner.eval_case_suggestion.v1",
    outcome: "accepted",
    source: "review_status_event",
    title: "Accepted run suggested for eval capture",
    detail: "A reviewer accepted this run from the review lane. Save only after operator confirmation.",
    defaultRationale: "Accepted after review: reusable trace evidence.",
    reviewerAgentId: "reviewer-1",
    reviewerName: "Gator",
    reviewedAt: "2026-06-06T22:01:00.000Z",
    requiresOperatorConfirmation: true,
    requiresLowCaptureConfirmation: true,
    requiresFailedTraceConfirmation: false,
    warnings: ["Trace capture quality is partial; saving requires low-capture confirmation."],
  };
}

function returnedSuggestion() {
  return {
    schema: "hiverunner.eval_case_suggestion.v1",
    outcome: "returned",
    source: "review_status_event",
    title: "Returned run suggested for eval capture",
    detail: "A reviewer returned this run from the review lane. Save only after operator confirmation.",
    defaultRationale: "Returned after review.",
    reviewerAgentId: "reviewer-1",
    reviewerName: "Gator",
    reviewedAt: "2026-06-06T22:01:00.000Z",
    requiresOperatorConfirmation: true,
    requiresLowCaptureConfirmation: false,
    requiresFailedTraceConfirmation: false,
    warnings: [],
  };
}

function blockedSuggestion() {
  return {
    schema: "hiverunner.eval_case_suggestion.v1",
    outcome: "blocked",
    source: "run_status_event",
    title: "Blocked run suggested for eval capture",
    detail: "This run ended in a blocked state.",
    defaultRationale: "Run was blocked.",
    reviewerAgentId: null,
    reviewerName: null,
    reviewedAt: null,
    requiresOperatorConfirmation: true,
    requiresLowCaptureConfirmation: false,
    requiresFailedTraceConfirmation: false,
    warnings: [],
  };
}

async function mockRunTrace(
  page: Page,
  response: ReturnType<typeof runTraceResponse>,
  onSave?: (payload: Record<string, unknown>) => void,
) {
  await page.route(/\/api\/orchestration\/engine\/runs\/[^/]+\/events$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
  await page.route(/\/api\/orchestration\/engine\/runs\/[^/]+\/eval-case$/, async (route) => {
    onSave?.(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        evalCase: { id: "eval-case-1" },
        links: { evalCase: "/INS/evals?evalCase=eval-case-1" },
        warnings: ["Saved with partial trace capture quality."],
      }),
    });
  });
}

test.describe("INS-223 Run Trace eval case action", () => {
  test("saves a standard accepted trace (good capture)", async ({ page }) => {
    let savePayload: Record<string, unknown> | null = null;
    await mockRunTrace(
      page,
      runTraceResponse({ runId: "run-eligible-good", evalCaseSuggestion: normalAcceptedSuggestion() }),
      (payload) => {
        savePayload = payload;
      },
    );

    await page.goto("/companies/insight/tasks/INS-223/runs/run-eligible-good");

    await expect(page.getByRole("button", { name: "Save as eval case" })).toBeVisible();
    await page.getByRole("button", { name: "Save as eval case" }).click();
    
    const dialog = page.getByRole("dialog", { name: "Save reviewed trace as eval case" });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("Eval case rationale")).toHaveValue("Accepted after review: reusable trace evidence.");

    await page.getByLabel("Confirm this reviewed run should become an immutable eval case.").check();
    await expect(page.getByLabel("Confirm the trace has enough evidence despite low capture quality.")).toHaveCount(0); // Should not be present

    await dialog.getByRole("button", { name: "Confirm and save" }).click();

    await expect(page.getByRole("link", { name: "Eval case saved." })).toHaveAttribute("href", "/INS/evals?evalCase=eval-case-1");
    expect(savePayload).toMatchObject({
      outcome: "accepted",
      confirmReviewed: true,
    });
  });

  test("saves an accepted trace (with low-capture confirmation)", async ({ page }) => {
    let savePayload: Record<string, unknown> | null = null;
    await mockRunTrace(
      page,
      runTraceResponse({ runId: "run-eligible", evalCaseSuggestion: acceptedSuggestion() }),
      (payload) => {
        savePayload = payload;
      },
    );

    await page.goto("/companies/insight/tasks/INS-223/runs/run-eligible");

    await expect(page.getByRole("button", { name: "Save as eval case" })).toBeVisible();
    await expect(page.getByText("Trace capture quality is partial; saving requires low-capture confirmation.")).toBeVisible();
    await expect(page.getByText(/Evidence gap: Transcript missing/)).toBeVisible();

    await page.getByRole("button", { name: "Save as eval case" }).click();
    const dialog = page.getByRole("dialog", { name: "Save reviewed trace as eval case" });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("Eval case rationale")).toHaveValue("Accepted after review: reusable trace evidence.");

    await page.getByLabel("Confirm this reviewed run should become an immutable eval case.").check();
    await page.getByLabel("Confirm the trace has enough evidence despite low capture quality.").check();
    await page.getByLabel("Eval case rationale").fill("");
    await expect(dialog.getByRole("button", { name: "Confirm and save" })).toBeDisabled();

    await page.getByLabel("Eval case rationale").fill("Reviewed rationale from the UI test.");
    await expect(dialog.getByRole("button", { name: "Confirm and save" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Confirm and save" }).click();

    await expect(page.getByRole("link", { name: "Eval case saved." })).toHaveAttribute("href", "/INS/evals?evalCase=eval-case-1");
    expect(savePayload).toMatchObject({
      outcome: "accepted",
      confirmReviewed: true,
      confirmPartialCapture: true,
      confirmLowCaptureQuality: true,
      reviewerAgentId: "reviewer-1",
      reviewerName: "Gator",
      reviewedAt: "2026-06-06T22:01:00.000Z",
    });
    expect(savePayload?.rationaleByOutcome).toMatchObject({
      accepted: "Reviewed rationale from the UI test.",
    });
  });

  test("saves a returned trace", async ({ page }) => {
    let savePayload: Record<string, unknown> | null = null;
    await mockRunTrace(
      page,
      runTraceResponse({ runId: "run-returned", evalCaseSuggestion: returnedSuggestion() }),
      (payload) => {
        savePayload = payload;
      },
    );

    await page.goto("/companies/insight/tasks/INS-223/runs/run-returned");

    await expect(page.getByRole("button", { name: "Save as eval case" })).toBeVisible();
    await page.getByRole("button", { name: "Save as eval case" }).click();
    
    const dialog = page.getByRole("dialog", { name: "Save reviewed trace as eval case" });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("Eval case rationale")).toHaveValue("Returned after review.");

    await page.getByLabel("Confirm this reviewed run should become an immutable eval case.").check();
    // Does not require low capture quality confirmation because requiresLowCaptureConfirmation is false in returnedSuggestion
    await dialog.getByRole("button", { name: "Confirm and save" }).click();

    await expect(page.getByRole("link", { name: "Eval case saved." })).toHaveAttribute("href", "/INS/evals?evalCase=eval-case-1");
    expect(savePayload).toMatchObject({
      outcome: "returned",
      confirmReviewed: true,
    });
  });

  test("saves a blocked trace", async ({ page }) => {
    let savePayload: Record<string, unknown> | null = null;
    await mockRunTrace(
      page,
      runTraceResponse({ runId: "run-blocked", evalCaseSuggestion: blockedSuggestion() }),
      (payload) => {
        savePayload = payload;
      },
    );

    await page.goto("/companies/insight/tasks/INS-223/runs/run-blocked");

    await expect(page.getByRole("button", { name: "Save as eval case" })).toBeVisible();
    await page.getByRole("button", { name: "Save as eval case" }).click();
    
    // A blocked run uses run status, so the dialog might be slightly differently titled or the same
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("Eval case rationale")).toHaveValue("Run was blocked.");

    await page.getByLabel(/Confirm this/).check();
    await dialog.getByRole("button", { name: "Confirm and save" }).click();

    await expect(page.getByRole("link", { name: "Eval case saved." })).toHaveAttribute("href", "/INS/evals?evalCase=eval-case-1");
    expect(savePayload).toMatchObject({
      outcome: "blocked",
      confirmReviewed: true, // "operator confirmation" usually maps to confirmReviewed or something similar.
    });
  });

  test("hides the save action for an ineligible running trace", async ({ page }) => {
    await mockRunTrace(page, runTraceResponse({
      runId: "run-running",
      runStatus: "running",
      taskStatus: "in_progress",
      evalCaseSuggestion: null,
    }));

    await page.goto("/companies/insight/tasks/INS-223/runs/run-running");

    await expect(page.getByText("Trace coverage")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save as eval case" })).toHaveCount(0);
  });
});
