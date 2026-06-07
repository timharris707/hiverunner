import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ExperimentLaunchPanel,
  launchBlockedMessage,
  variantSelectionErrors,
} from "@/components/orchestration/ExperimentLaunchPanel";
import { buildRunTraceExperimentLaunchModel } from "@/lib/orchestration/experiment-launch";

// --- Gating logic: invalid variant selections are rejected -------------------

// Zero selected variants is rejected.
assert.deepEqual(variantSelectionErrors(0, 2), ["Select at least one proposed variant."]);

// More than three is rejected regardless of cap (hard upper bound).
assert.deepEqual(variantSelectionErrors(4, 3), ["Experiments can approve at most three variants."]);

// Selecting above the reviewed cap is rejected and names the cap.
assert.deepEqual(
  variantSelectionErrors(3, 2),
  ["Selected variants must stay at or below the reviewed variant cap of 2."],
);

// One-to-three within the cap is accepted.
assert.deepEqual(variantSelectionErrors(1, 1), []);
assert.deepEqual(variantSelectionErrors(2, 2), []);
assert.deepEqual(variantSelectionErrors(3, 3), []);

// --- Gating order: live gating and limit review block approval ---------------

// API context is required before anything else.
assert.equal(
  launchBlockedMessage({ apiReady: false, liveReady: true, limitsReviewed: true, reviewErrors: [], fallback: "fallback" }),
  "Experiment approval needs a company context before calling the API.",
);

// Live workspace mode is visibly gated until explicit governed selection.
assert.equal(
  launchBlockedMessage({ apiReady: true, liveReady: false, limitsReviewed: true, reviewErrors: [], fallback: "fallback" }),
  "Live workspace mode requires explicit governed operator selection before approval.",
);

// Review errors (e.g. invalid variant selection) surface before the limit-review gate.
assert.equal(
  launchBlockedMessage({
    apiReady: true,
    liveReady: true,
    limitsReviewed: true,
    reviewErrors: ["Select at least one proposed variant."],
    fallback: "fallback",
  }),
  "Select at least one proposed variant.",
);

// Selected variants are approved only after the limit review is confirmed.
assert.equal(
  launchBlockedMessage({ apiReady: true, liveReady: true, limitsReviewed: false, reviewErrors: [], fallback: "fallback" }),
  "Review limits before approving selected variants.",
);

// --- Render proof: reviewed-trace launch surface wires the controls ----------

const model = buildRunTraceExperimentLaunchModel({
  runId: "run-exp-1",
  runStatus: "succeeded",
  taskKey: "INS-273",
  taskTitle: "Wire variant review, approvals, and limits",
  taskStatus: "review",
  agentName: "Meridian",
  providerLabel: "Anthropic",
  runnerModel: "claude-opus-4-8",
  captureQuality: "complete",
  evidenceGapCount: 0,
  reviewOutcome: "returned",
});

assert.equal(model.availability.state, "available");

const html = renderToStaticMarkup(
  React.createElement(ExperimentLaunchPanel, { model, companyKey: "insight" }),
);

// Limit review controls render with the bounded-cost rationale and the gate copy.
assert.match(html, /Review limits before approval/);
assert.match(html, /no attempt starts from this approval step/);
assert.match(html, /I reviewed the variant count, attempt limit, and timebox before approving\./);

// Live workspace mode is offered but visibly governed before execution.
assert.match(html, /Live workspace/);
assert.match(html, /Requires explicit governed operator choice before execution\./);

// Proposed variants render with the "why each variant exists" reason copy (1-3 cap).
assert.match(html, /Review return fix/);
assert.match(html, /Evidence linking/);
assert.match(html, /Reviewer returns usually hinge on missing or weak evidence links\./);

// Approval-before-run: the approve button renders disabled until the limit review
// is confirmed (limitsReviewed defaults to false on first render).
assert.match(html, /Approve selected variants/);
assert.match(html, /<button[^>]*disabled[^>]*>/);

// The stub notice states the approval-then-execution contract.
assert.match(html, /approved only after the limit review/);
assert.match(html, /ready for attempt execution/);

console.log("ExperimentLaunchPanel gating + render states passed");
