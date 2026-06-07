import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EvalsLibrarySurface, readEvalLibraryFilters } from "@/components/orchestration/EvalsLibraryView";
import type {
  OrchestrationEvalCase,
  OrchestrationEvalLibraryFacets,
  OrchestrationEvalLibraryFilters,
} from "@/lib/orchestration/types";

const facets: OrchestrationEvalLibraryFacets = {
  projects: [{ value: "project-1", label: "HiveRunner", count: 1 }],
  taskTypes: [{ value: "feature", label: "feature", count: 1 }],
  templates: [{ value: "starter-build", label: "starter-build", count: 1 }],
  agents: [{ value: "agent-1", label: "Samantha", count: 1 }],
  runners: [{ value: "openai", label: "openai", count: 1 }],
  models: [{ value: "gpt-5.5", label: "gpt-5.5", count: 1 }],
  reviewOutcomes: [{ value: "accepted", label: "accepted", count: 1 }],
  tags: [{ value: "api", label: "api", count: 1 }],
};

const filters: OrchestrationEvalLibraryFilters = {
  projectId: "project-1",
  taskType: "feature",
  template: "starter-build",
  agent: "agent-1",
  runner: "openai",
  model: "gpt-5.5",
  reviewOutcome: "accepted",
  tag: "api",
  dateFrom: "2026-06-06",
  dateTo: "2026-06-07",
};

const evalCase: OrchestrationEvalCase = {
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
    key: "INS-222",
    title: "Create Evals navigation and library surface",
    type: "feature",
    tags: ["api", "evals"],
  },
  sourceRun: {
    id: "run-1",
    traceRoute: "/INS/tasks/INS-222/runs/run-1",
    executionEngine: "hiverunner",
    runnerProvider: "openai",
    providerId: "codex",
    runnerModel: "gpt-5.5",
    agentId: "agent-1",
    agentName: "Samantha",
  },
  sourceSprint: {
    id: "sprint-1",
    key: "INS-S002",
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
    rationale: "The reviewed run satisfies the task contract and has reusable evidence.",
    notes: null,
    reviewerAgentId: "agent-2",
    reviewerName: "Gator",
    reviewedAt: "2026-06-07T00:00:00.000Z",
  },
  captureQuality: "complete",
  evidenceGaps: [],
  snapshotSha256: "aaaaaaaaaaaabbbbbbbbbbbbccccccccccccddddddddddddeeeeeeeeeeeeffffffff",
  version: 1,
  parentEvalCaseId: null,
  idempotencyKey: "run-1:accepted",
  createdByAgentId: "agent-2",
  createdByUserId: null,
  createdAt: "2026-06-07T00:00:00.000Z",
  experimentReports: [{
    id: "report-1",
    experimentId: "experiment-1",
    companyId: "company-1",
    status: "accepted",
    title: "Comparison report",
    summary: "Variant A reduced review return risk.",
    objective: "Improve accepted outcome repeatability.",
    sourceKind: "eval_case",
    sourceRunId: "run-1",
    sourceEvalCaseId: "eval-case-1",
    sourceTaskId: "task-1",
    sourceTaskKey: "INS-222",
    sourceTaskTitle: "Create Evals navigation and library surface",
    sprintId: "sprint-1",
    sprintKey: "INS-S002",
    goalKey: "INS-G001",
    winningVariantId: "variant-1",
    winningVariantKey: "variant-a",
    winningVariantName: "Evidence-focused variant",
    recommendationId: "rec-1",
    reportSha256: "bbbbbbbbbbbbaaaaaaaaaaaaccccccccccccddddddddddddeeeeeeeeeeeeffffffff",
    createdAt: "2026-06-07T01:00:00.000Z",
    updatedAt: "2026-06-07T01:00:00.000Z",
    href: "/INS/evals/eval-case-1?evidence=experiment-report-report-1",
    links: [],
    redactionPolicy: "hiverunner.experiment_report_read.redaction.v1",
  }],
};

function render(filtersInput: OrchestrationEvalLibraryFilters, cases: OrchestrationEvalCase[], total = cases.length, error?: string | null) {
  return renderToStaticMarkup(
    <EvalsLibrarySurface
      companyCode="INS"
      loading={false}
      error={error}
      cases={cases}
      total={total}
      facets={facets}
      filters={filtersInput}
    />,
  );
}

const html = render(filters, [evalCase]);

assert.match(html, /data-evals-library="true"/);
assert.match(html, /Evals/);
assert.match(html, /Contextual recommendations/);
assert.match(html, /href="\/INS\/improve\?surface=evals"/);
assert.match(html, /Experiment launch/);
assert.match(html, /Preferred source: Eval Case/);
assert.match(html, /Source summary/);
assert.match(html, /Objective/);
assert.match(html, /Improve accepted outcome/);
assert.match(html, /Workspace mode/);
assert.match(html, /Snapshot/);
assert.match(html, /Branch/);
assert.match(html, /Live workspace/);
assert.match(html, /Proposed variants/);
assert.match(html, /Acceptance proof/);
assert.match(html, /Why:/);
assert.match(html, /Variant cap/);
assert.match(html, /Attempt limit/);
assert.match(html, /Timebox/);
assert.match(html, /Review limits before approval/);
assert.match(html, /Approve selected variants/);
assert.match(html, /Library Filters/);
assert.match(html, /Saved Cases/);
assert.match(html, /INS-222 · Create Evals navigation and library surface/);
assert.match(html, /href="\/INS\/tasks\/INS-222"/);
assert.match(html, /href="\/INS\/tasks\/INS-222\/runs\/run-1"/);
assert.match(html, /Experiment evidence/);
assert.match(html, /Comparison report/);
assert.match(html, /Variant A reduced review return risk/);
assert.match(html, /href="\/INS\/evals\/eval-case-1\?evidence=experiment-report-report-1"/);
assert.match(html, /starter-build/);
assert.match(html, /Samantha/);
assert.match(html, /openai/);
assert.match(html, /gpt-5.5/);
assert.match(html, /value="project-1" selected/);
assert.match(html, /value="2026-06-06"/);
assert.doesNotMatch(html, /scorecard/i);
assert.doesNotMatch(html, /href="[^"]*\/experiments/);
assert.doesNotMatch(html, /Dismiss|Suppress|Accept for approval|Apply recommendation|Edit recommendation/);
assert.doesNotMatch(html, /href="[^"]*\/experiments/);

const emptyHtml = render({}, [], 0);
assert.match(emptyHtml, /No eval cases saved yet/);
assert.match(emptyHtml, /No Eval Case selected/);
assert.match(emptyHtml, /No launch source/);
assert.match(emptyHtml, /No saved Eval Cases are available/);

const filteredEmptyHtml = render({ tag: "missing" }, [], 0);
assert.match(filteredEmptyHtml, /No eval cases match these filters/);

const errorHtml = render({}, [], 0, "Eval cases could not be loaded.");
assert.match(errorHtml, /Launch source error/);
assert.match(errorHtml, /experiment launch needs a reviewed source/);

const parsedFilters = readEvalLibraryFilters(new URLSearchParams("projectId=project-1&reviewOutcome=accepted&tag=api"));
assert.deepEqual(parsedFilters, {
  projectId: "project-1",
  reviewOutcome: "accepted",
  tag: "api",
});

console.log("Evals library render tests passed");
