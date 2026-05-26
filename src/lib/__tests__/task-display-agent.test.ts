import assert from "node:assert/strict";

import { getTaskAgentOfRecord, shouldShowAgentOfRecord } from "@/components/tasks/task-display-agent";
import type { OrchestrationAgent, TaskStatus } from "@/lib/orchestration/types";

const agents = [
  { id: "worker-1", name: "Clarity", slug: "clarity", role: "Builder", status: "idle" },
  { id: "reviewer-1", name: "Lens", slug: "lens", role: "Reviewer", status: "idle" },
] as OrchestrationAgent[];

const doneTask = {
  status: "done" as TaskStatus,
  assignee: "Lens",
  displayAgentId: "worker-1",
  displayAgentName: "Clarity",
};

assert.equal(getTaskAgentOfRecord(doneTask, agents)?.name, "Clarity");
assert.equal(shouldShowAgentOfRecord(doneTask), true);

assert.equal(
  shouldShowAgentOfRecord({
    status: "review" as TaskStatus,
    assignee: "Lens",
    displayAgentId: "worker-1",
    displayAgentName: "Clarity",
  }),
  false,
);

console.log("Task display agent tests passed");
