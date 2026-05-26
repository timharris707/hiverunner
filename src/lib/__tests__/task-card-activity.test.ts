import assert from "node:assert/strict";

import { isReviewActivityText, selectPrimaryTaskUpdateComment, taskCardActivityLabel } from "@/components/tasks/task-card-activity";

assert.equal(isReviewActivityText("**Review: Approved**\n\nLooks good."), true);
assert.equal(isReviewActivityText("Review Decision: DONE Closing task."), true);
assert.equal(isReviewActivityText("**Visual QA Review Passed**\n\nScreenshots verified."), true);
assert.equal(isReviewActivityText("Verification complete"), false);

assert.equal(
  taskCardActivityLabel({
    status: "done",
    displayAgentName: "Swift",
    latestCommentAuthor: "Gator",
    latestCommentText: "**Review: Approved**\n\nAll requirements met.",
    updatedRelativeLabel: "28m ago",
  }),
  "Swift completed this task · reviewed by Gator · 28m ago",
);

assert.equal(
  taskCardActivityLabel({
    status: "done",
    displayAgentName: "Gator",
    latestCommentAuthor: "Gator",
    latestCommentText: "Review: Approved",
    updatedRelativeLabel: "28m ago",
  }),
  "Gator completed this task · 28m ago",
);

assert.equal(
  taskCardActivityLabel({
    status: "in-progress",
    displayAgentName: "Mannie",
    latestCommentAuthor: "Mannie",
    latestCommentText: "Implementation update",
    updatedRelativeLabel: "5m ago",
  }),
  "Mannie updated this task · 5m ago",
);

assert.equal(
  selectPrimaryTaskUpdateComment([
    {
      text: "[STUCK_AGENT_WATCHDOG] Agent Swift has not heartbeated since 2026-05-18T12:00:00.000Z.",
      timestamp: "2026-05-18T12:30:00.000Z",
      author: "System",
      type: "status_update",
      source: "engine",
    },
    {
      text: "**Review: Approved**\n\nThe implementation satisfies the request.",
      timestamp: "2026-05-18T12:20:00.000Z",
      author: "Gator",
      type: "review",
      source: "mission_control",
    },
  ])?.text,
  "**Review: Approved**\n\nThe implementation satisfies the request.",
);

assert.equal(
  selectPrimaryTaskUpdateComment([
    {
      text: "[STUCK_AGENT_WATCHDOG] Agent Swift has not heartbeated since 2026-05-18T12:00:00.000Z.",
      timestamp: "2026-05-18T12:30:00.000Z",
      author: "System",
      type: "status_update",
      source: "engine",
    },
  ]),
  undefined,
);

console.log("Task card activity label tests passed");
