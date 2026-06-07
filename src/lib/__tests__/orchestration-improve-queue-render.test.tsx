import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DEFAULT_IMPROVE_FILTERS,
  ImproveQueueSurface,
  applyImproveQueueAction,
  countImproveStatuses,
  createSeedImproveRecommendations,
  createSeedImproveTriggerControls,
  createSeedImproveTriggerFirings,
  filterImproveRecommendations,
  readImproveFilters,
} from "@/components/orchestration/ImproveQueueView";
import { buildCanonicalImprovePath } from "@/lib/orchestration/route-paths";

const recommendations = createSeedImproveRecommendations("INS");
const triggerControls = createSeedImproveTriggerControls();
const triggerFirings = createSeedImproveTriggerFirings();

function render(filters = DEFAULT_IMPROVE_FILTERS) {
  return renderToStaticMarkup(
    <ImproveQueueSurface
      companyCode="INS"
      companyName="Insight"
      loading={false}
      recommendations={recommendations}
      triggerControls={triggerControls}
      triggerFirings={triggerFirings}
      filters={filters}
      selectedRecommendationId="improve-1"
    />,
  );
}

const html = render();

assert.equal(buildCanonicalImprovePath("INS"), "/INS/improve");
assert.match(html, /data-improve-queue="true"/);
assert.match(html, /Improve/);
assert.match(html, /Trigger Controls/);
assert.match(html, /Recent Trigger Firings/);
assert.match(html, /Recommendation Queue/);
assert.match(html, /role="tablist"/);
assert.match(html, /Suggested/);
assert.match(html, /Needs More Evidence/);
assert.match(html, /Accepted For Approval/);
assert.match(html, /Dismissed/);
assert.match(html, /Superseded/);
assert.match(html, /Applied/);
assert.match(html, /Severe single failure/);
assert.match(html, /Repeated review return/);
assert.match(html, /Created Recommendation/);
assert.match(html, /trigger_disabled/);
assert.match(html, /Review return pattern/);
assert.match(html, /Evidence Preview/);
assert.match(html, /Accept for approval/);
assert.match(html, /Dismiss/);
assert.match(html, /Suppress/);
assert.match(html, /Edit recommendation/);
assert.match(html, /href="\/INS\/tasks\/INS-242\/runs\/run-ins-242-7"/);
assert.doesNotMatch(html, /scorecard/i);
assert.doesNotMatch(html, /leaderboard/i);

const counts = countImproveStatuses(recommendations);
assert.equal(counts.suggested, 1);
assert.equal(counts["needs-more-evidence"], 1);
assert.equal(counts["accepted-for-approval"], 1);
assert.equal(counts.dismissed, 1);
assert.equal(counts.superseded, 1);
assert.equal(counts.applied, 1);

const activeSuggested = filterImproveRecommendations(recommendations, DEFAULT_IMPROVE_FILTERS);
assert.equal(activeSuggested.length, 1);
assert.equal(activeSuggested[0].id, "improve-1");

const suppressedOnly = filterImproveRecommendations(recommendations, {
  ...DEFAULT_IMPROVE_FILTERS,
  status: "all",
  suppression: "suppressed",
});
assert.deepEqual(suppressedOnly.map((item) => item.id), ["improve-4"]);

const emptyHtml = render({
  ...DEFAULT_IMPROVE_FILTERS,
  status: "all",
  query: "does-not-exist",
});
assert.match(emptyHtml, /No recommendations match these filters/);

const parsed = readImproveFilters(new URLSearchParams("status=accepted-for-approval&trigger=repeated_review_return&severity=high&confidence=high&suppression=all&q=proof"));
assert.deepEqual(parsed, {
  status: "accepted-for-approval",
  trigger: "repeated_review_return",
  severity: "high",
  confidence: "high",
  suppression: "all",
  query: "proof",
});

const accepted = applyImproveQueueAction(recommendations, { type: "accept", id: "improve-1" });
assert.equal(accepted.find((item) => item.id === "improve-1")?.status, "accepted-for-approval");
assert.equal(accepted.find((item) => item.id === "improve-1")?.approvalDraftId, "draft-improve-1");

const dismissed = applyImproveQueueAction(recommendations, {
  type: "dismiss",
  id: "improve-1",
  category: "wrong_diagnosis",
  note: "Reviewer evidence points elsewhere.",
});
assert.equal(dismissed.find((item) => item.id === "improve-1")?.status, "dismissed");
assert.equal(dismissed.find((item) => item.id === "improve-1")?.dismissalCategory, "wrong_diagnosis");
assert.equal(dismissed.find((item) => item.id === "improve-1")?.dismissalNote, "Reviewer evidence points elsewhere.");

const suppressed = applyImproveQueueAction(recommendations, {
  type: "suppress",
  id: "improve-1",
});
const suppressedItem = suppressed.find((item) => item.id === "improve-1");
assert.equal(suppressedItem?.status, "dismissed");
assert.equal(suppressedItem?.suppressed, true);
assert.equal(suppressedItem?.suppressedScope, "Frontend implementation tasks in Sprint 4");

const improveQueueSource = readFileSync("src/components/orchestration/ImproveQueueView.tsx", "utf8");
assert.match(improveQueueSource, /suppressCompanyImproveRecommendation\(\s*companySlug,\s*action\.id,/);
assert.match(improveQueueSource, /scopeType: recommendation\.scopeType/);
assert.match(improveQueueSource, /scopeKey,/);
assert.doesNotMatch(improveQueueSource, /createCompanyImprovementSuppression/);
assert.doesNotMatch(improveQueueSource, /scopeKey: [^\n]*action\.scope/);

const edited = applyImproveQueueAction(recommendations, {
  type: "edit",
  id: "improve-1",
  patch: {
    proposedChange: "Require browser proof and console health for Improve queue work.",
    scope: "Improve queue UI",
    affected: ["Samantha", "Lens"],
    rationale: "The queue has multiple stateful actions.",
  },
});
const editedItem = edited.find((item) => item.id === "improve-1");
assert.equal(editedItem?.proposedChange, "Require browser proof and console health for Improve queue work.");
assert.equal(editedItem?.scope, "Improve queue UI");
assert.deepEqual(editedItem?.affected, ["Samantha", "Lens"]);
assert.equal(editedItem?.rationale, "The queue has multiple stateful actions.");

console.log("Improve queue render tests passed");
