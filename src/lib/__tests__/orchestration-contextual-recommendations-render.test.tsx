import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ContextualRecommendationRollup,
  type ContextualRecommendationSurface,
  emptyContextualRecommendationCounts,
} from "@/components/orchestration/ContextualRecommendationRollup";

function markup(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

function expectAll(html: string, patterns: RegExp[]): void {
  for (const pattern of patterns) assert.match(html, pattern);
}

function expectNone(html: string, patterns: RegExp[]): void {
  for (const pattern of patterns) assert.doesNotMatch(html, pattern);
}

const html = renderToStaticMarkup(
  <ContextualRecommendationRollup
    surface="task"
    improveHref="/INS/improve?surface=task&taskKey=INS-251"
    counts={{ total: 4, critical: 1, high: 1, medium: 2 }}
    notables={[
      {
        id: "critical-1",
        severity: "critical",
        title: "Fix critical runner mismatch",
        href: "/INS/improve?recommendation=critical-1",
      },
      {
        id: "medium-1",
        severity: "medium",
        title: "Medium recommendation should stay in Improve",
        href: "/INS/improve?recommendation=medium-1",
      },
      {
        id: "high-1",
        severity: "high",
        title: "Review template drift",
        href: "/INS/improve?recommendation=high-1",
      },
    ]}
  />,
);

expectAll(html, [
  /data-contextual-recommendations/,
  /data-recommendation-surface="task"/,
  /Contextual recommendations/,
  /4 open/,
  /1 critical/,
  /1 high/,
  /Fix critical runner mismatch/,
  /Review template drift/,
  /href="\/INS\/improve\?surface=task&amp;taskKey=INS-251"/,
  /href="\/INS\/improve\?recommendation=critical-1"/,
]);
expectNone(html, [
  /Medium recommendation should stay in Improve/,
  /Dismiss|Suppress|Accept for approval|Apply recommendation|Edit recommendation/,
]);

const emptyHtml = markup(
  <ContextualRecommendationRollup
    surface="evals"
    improveHref="/INS/improve?surface=evals"
    counts={emptyContextualRecommendationCounts()}
  />,
);

expectAll(emptyHtml, [
  /0 open/,
  /0 critical/,
  /0 high/,
  /No high or critical recommendations in this context/,
]);

const surfaces: ContextualRecommendationSurface[] = ["run-trace", "evals", "template", "team", "goal", "sprint", "task"];
for (const surface of surfaces) {
  const surfaceHtml = markup(
    <ContextualRecommendationRollup
      surface={surface}
      improveHref={`/INS/improve?surface=${surface}`}
      counts={emptyContextualRecommendationCounts()}
    />,
  );
  assert.match(surfaceHtml, new RegExp(`data-recommendation-surface="${surface}"`));
  assert.match(surfaceHtml, new RegExp(`href="/INS/improve\\?surface=${surface}"`));
  assert.doesNotMatch(surfaceHtml, /Dismiss|Suppress|Accept for approval|Apply recommendation|Edit recommendation/);
}

console.log("Contextual recommendation rollup render tests passed");
