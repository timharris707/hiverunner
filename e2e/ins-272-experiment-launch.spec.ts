import { expect, test, type Page } from "@playwright/test";

const now = Date.parse("2026-06-07T18:00:00.000Z");

const facets = {
  projects: [{ value: "project-1", label: "HiveRunner", count: 1 }],
  taskTypes: [{ value: "feature", label: "feature", count: 1 }],
  templates: [{ value: "starter-build", label: "starter-build", count: 1 }],
  agents: [{ value: "agent-1", label: "Samantha", count: 1 }],
  runners: [{ value: "openai", label: "openai", count: 1 }],
  models: [{ value: "gpt-5.5", label: "gpt-5.5", count: 1 }],
  reviewOutcomes: [{ value: "accepted", label: "accepted", count: 1 }],
  tags: [{ value: "experiment", label: "experiment", count: 1 }],
};

const evalCase = {
  id: "eval-case-1",
  companyId: "company-1",
  projectId: "project-1",
  sourceProject: {
    id: "project-1",
    slug: "hiverunner",
    name: "HiveRunner",
    color: "#22c55e",
  },
  sourceTask: {
    id: "task-1",
    key: "INS-272",
    title: "Build experiment launch experience",
    type: "feature",
    tags: ["experiment", "run-intelligence"],
  },
  sourceRun: {
    id: "run-reviewed",
    traceRoute: "/companies/insight/tasks/INS-272/runs/run-reviewed",
    executionEngine: "hiverunner",
    runnerProvider: "openai",
    providerId: "codex",
    runnerModel: "gpt-5.5",
    agentId: "agent-1",
    agentName: "Samantha",
  },
  sourceSprint: {
    id: "sprint-1",
    key: "INS-S006",
  },
  sourceGoal: {
    id: "goal-1",
    key: "INS-G001",
  },
  templateContext: {
    templateId: "starter-build",
    templateName: "starter-build",
  },
  review: {
    outcome: "accepted",
    rationale: "The reviewed run satisfies the task contract and has reusable experiment evidence.",
    notes: null,
    reviewerAgentId: "agent-2",
    reviewerName: "Gator",
    reviewedAt: "2026-06-07T17:45:00.000Z",
  },
  captureQuality: "complete",
  evidenceGaps: [],
  snapshotSha256: "aaaaaaaaaaaabbbbbbbbbbbbccccccccccccddddddddddddeeeeeeeeeeeeffffffff",
  version: 1,
  parentEvalCaseId: null,
  idempotencyKey: "run-reviewed:accepted",
  createdByAgentId: "agent-2",
  createdByUserId: null,
  createdAt: "2026-06-07T17:45:00.000Z",
};

function runTraceResponse() {
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
    id: "missing_workspace",
    label: "not_captured",
    title: "Workspace diff missing",
    detail: "Workspace diff evidence was not captured for this fixture.",
    affectsCaptureQuality: true,
  }];

  return {
    run: {
      id: "run-reviewed",
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
      finishedAt: new Date(now + 45_000).toISOString(),
      durationMs: 45_000,
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
      title: "Build experiment launch experience",
      key: "INS-272",
      status: "review",
      priority: "critical",
    },
    context: {
      wakeSource: "issue_assigned",
      wakeReason: "sprint_approved_start",
      direction: "Build the experiment launch experience.",
      directionTaskId: "task-1",
      issueId: "INS-272",
      taskKey: "INS-272",
    },
    invocation: {
      providerId: "codex",
      runTable: "execution_runs",
      wakeupRequestId: "wake-1",
      idempotencyKey: "idem-1",
      wakeupStatus: "completed",
      requestedAt: new Date(now - 1000).toISOString(),
      claimedAt: new Date(now).toISOString(),
      completedAt: new Date(now + 45_000).toISOString(),
      linkedHeartbeatCount: 1,
      note: "Execution run invocation evidence.",
    },
    metrics: {
      durationMs: 45_000,
      promptChars: 1000,
      promptBuildMs: 50,
      totalDurationMs: 45_000,
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
      assistantSummary: "Built experiment launch controls.",
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
      { id: "review", kind: "run_progress", summary: "Review returned", ts: now + 40_000, source: "execution_transcript" },
      { id: "done", kind: "run_end", summary: "Run completed", ts: now + 45_000, source: "execution_transcript" },
    ],
    trace: {
      schema: "hiverunner.run_trace_view.v1",
      runId: "run-reviewed",
      status: "completed",
      providerId: "codex",
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
        detail: "Useful trace evidence was captured, but one expected evidence category is missing.",
        missingRequiredEvidence: ["missing_workspace"],
      },
      annotations,
      evidenceGaps,
    },
    traceExport: {
      schema: "hiverunner.run_trace_redacted_export.v1",
      summary: {
        runId: "run-reviewed",
        taskKey: "INS-272",
        status: "completed",
        providerId: "codex",
        captureQuality: "partial",
        timelineEventCount: 3,
        evidenceGapCount: 1,
        copyText: "Run Trace\\nRun: run-reviewed",
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
    evalCaseSuggestion: {
      schema: "hiverunner.eval_case_suggestion.v1",
      outcome: "returned",
      source: "review_status_event",
      title: "Returned run suggested for eval capture",
      detail: "A reviewer returned this run from the review lane.",
      defaultRationale: "Returned after review.",
      reviewerAgentId: "reviewer-1",
      reviewerName: "Gator",
      reviewedAt: "2026-06-07T17:45:00.000Z",
      requiresOperatorConfirmation: true,
      requiresLowCaptureConfirmation: false,
      requiresFailedTraceConfirmation: false,
      warnings: [],
    },
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

async function mockLaunchData(page: Page) {
  await page.route("**/api/orchestration/companies?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        companies: [{
          id: "company-1",
          slug: "insight",
          code: "INS",
          name: "Insight",
          description: "Insight test company",
          status: "active",
          created: "2026-06-07T00:00:00.000Z",
          workspace: { root: "/tmp/insight", source: "manual" },
          theme: {},
          stats: {},
        }],
      }),
    });
  });

  await page.route("**/api/orchestration/companies/insight/evals**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cases: [evalCase],
        total: 1,
        filters: {},
        facets,
      }),
    });
  });

  await page.route("**/api/orchestration/companies/*/experiments", async (route) => {
    const payload = route.request().postDataJSON() as {
      source?: { kind?: string };
      workspaceMode?: string;
      limits?: { variantCap?: number; attemptLimit?: number; timeboxMinutes?: number };
      variants?: Array<{ key: string; name: string }>;
    };
    const variants = payload.variants ?? [];
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        experiment: {
          id: `experiment-${payload.source?.kind ?? "source"}`,
          status: "draft",
          workspaceMode: payload.workspaceMode ?? "snapshot",
          limits: payload.limits ?? { variantCap: 2, attemptLimit: 3, timeboxMinutes: 30 },
          variants: variants.map((variant, index) => ({
            id: `variant-${index + 1}`,
            key: variant.key,
            name: variant.name,
            status: "draft",
          })),
        },
      }),
    });
  });

  await page.route("**/api/orchestration/companies/*/experiments/*", async (route) => {
    const payload = route.request().postDataJSON() as { variantKeys?: string[] };
    const variantKeys = payload.variantKeys ?? [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        experiment: {
          id: "experiment-approved",
          status: "approved",
          workspaceMode: "snapshot",
          limits: { variantCap: 2, attemptLimit: 3, timeboxMinutes: 30 },
          variants: variantKeys.map((key, index) => ({
            id: `variant-${index + 1}`,
            key,
            name: key,
            status: "approved",
          })),
        },
      }),
    });
  });

  await page.route("**/api/orchestration/companies/*/improve**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        companyControl: {},
        triggers: [],
        recommendations: [],
        firings: [],
        suppressions: [],
      }),
    });
  });

  await page.route("**/api/orchestration/engine/runs/run-reviewed/events", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(runTraceResponse()),
    });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentScroll: document.documentElement.scrollWidth,
    bodyScroll: document.body.scrollWidth,
  }));
  expect(overflow.documentScroll).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.bodyScroll).toBeLessThanOrEqual(overflow.viewport + 1);
}

test.describe("INS-272 experiment launch experience", () => {
  test("launches from reviewed Run Trace with accessible controls and guarded live mode", async ({ page }) => {
    await mockLaunchData(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/companies/insight/tasks/INS-272/runs/run-reviewed");

    const launch = page.getByLabel("Experiment launch").first();
    await expect(launch.getByText("Eval Case preferred")).toBeVisible();
    await expect(launch.getByText("Reviewed Run Trace")).toBeVisible();
    await expect(launch.getByRole("group", { name: "Objective" })).toBeVisible();
    await expect(launch.getByRole("group", { name: "Workspace mode" })).toBeVisible();
    await expect(launch.getByLabel(/Reduce review returns/)).toBeChecked();
    await expect(launch.getByLabel(/Snapshot/)).toBeChecked();
    await expect(launch.getByRole("group", { name: "Proposed variants" })).toBeVisible();
    await expect(launch.getByText("Review return fix")).toBeVisible();
    await expect(launch.getByText(/Why:/).first()).toBeVisible();

    await launch.getByLabel(/Live workspace/).check();
    await expect(launch.getByRole("button", { name: "Approve selected variants" })).toBeDisabled();
    await launch.getByLabel(/Explicitly choose governed live workspace/).check();
    await expect(launch.getByRole("button", { name: "Approve selected variants" })).toBeDisabled();
    await launch.getByLabel(/Smaller work slice/).check();
    await expect(launch.getByText(/Selected variants must stay at or below/)).toBeVisible();
    await launch.getByLabel(/Smaller work slice/).uncheck();
    await launch.getByLabel(/I reviewed the variant count, attempt limit, and timebox/).check();
    await expect(launch.getByRole("button", { name: "Approve selected variants" })).toBeEnabled();

    await launch.getByRole("button", { name: "Approve selected variants" }).click();
    await expect(launch.getByText(/Approved experiment ready for attempt execution/)).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 900, height: 800 });
    await expectNoHorizontalOverflow(page);
  });

  test("launches from Eval Case as the preferred source without layout overflow", async ({ page }) => {
    await mockLaunchData(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/companies/insight/evals");

    const row = page.locator('[data-eval-case-id="eval-case-1"]');
    await expect(row.getByRole("heading", { name: "INS-272 · Build experiment launch experience" })).toBeVisible();
    await row.locator("summary").click();

    await expect(row.getByText("Preferred source: Eval Case")).toBeVisible();
    await expect(row.getByText("Source summary")).toBeVisible();
    await expect(row.getByRole("group", { name: "Objective" })).toBeVisible();
    await expect(row.getByRole("group", { name: "Workspace mode" })).toBeVisible();
    await expect(row.getByRole("group", { name: "Proposed variants" })).toBeVisible();
    await expect(row.getByLabel(/Improve accepted outcome/)).toBeChecked();
    await expect(row.getByText("Acceptance proof")).toBeVisible();
    await expect(row.getByLabel(/Variant cap/)).toHaveValue("2");
    await expect(row.getByLabel(/Attempt limit/)).toHaveValue("3");

    await row.getByLabel(/Variant cap/).fill("4");
    await expect(row.getByText(/Variant cap must stay between 1 and 3 variants/)).toBeVisible();
    await expect(row.getByRole("button", { name: "Approve selected variants" })).toBeDisabled();
    await row.getByLabel(/Variant cap/).fill("2");
    await row.getByLabel(/Branch/).check();
    await row.getByLabel(/I reviewed the variant count, attempt limit, and timebox/).check();
    await row.getByRole("button", { name: "Approve selected variants" }).click();
    await expect(row.getByText(/Approved experiment ready for attempt execution/)).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 900, height: 800 });
    await expectNoHorizontalOverflow(page);
  });
});
