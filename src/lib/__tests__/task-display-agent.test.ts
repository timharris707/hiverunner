import assert from "node:assert/strict";

import { cleanAgentReference, getTaskAgentOfRecord, shouldShowAgentOfRecord, taskAgentDisplayLabel } from "@/components/tasks/task-display-agent";
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

assert.equal(cleanAgentReference("icon:crown Oracle"), "Oracle");
assert.equal(
  getTaskAgentOfRecord(
    {
      status: "done" as TaskStatus,
      assignee: "Lens",
      displayAgentId: undefined,
      displayAgentName: "icon:crown Clarity",
    },
    agents,
  )?.name,
  "Clarity",
);
assert.equal(
  taskAgentDisplayLabel({
    assignee: "Lens",
    displayAgentName: "icon:crown Clarity",
  }),
  "Clarity",
);

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
