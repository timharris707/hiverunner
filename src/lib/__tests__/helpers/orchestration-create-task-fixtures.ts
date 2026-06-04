import assert from "node:assert";
import { randomUUID } from "node:crypto";

export const DEFAULT_ORCHESTRATION_COMPANY_ID = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
export const DEFAULT_ORCHESTRATION_COMPANY_SLUG = "hiverunner-workspace";

type ProjectFixture = {
  id: string;
  companyId: string;
};

type AgentFixture = {
  id: string;
  name: string;
};

type TaskFixture = {
  id: string;
  key?: string | null;
};

type CreateProjectFn = (input: {
  companyId: string;
  name: string;
  description: string;
  color: string;
  emoji: string;
  status: string;
}) => { project: ProjectFixture };

type CreateProjectAgentFn = (input: {
  projectId: string;
  name: string;
  emoji: string;
  role: string;
  personality: string;
  openclawAgentId: string;
  status: string;
  skills: string[];
}) => { agent: AgentFixture };

type CreateTaskFn = (input: {
  projectId: string;
  title: string;
  description: string;
  priority: string;
  type: string;
  status: string;
  assignee: string;
  parentTaskId?: string;
  labels: string[];
  createdBy: string;
}) => { task: TaskFixture };

export type CreateTaskAction = {
  action: "create_task";
  title: string;
  description?: string;
  assignee?: string;
  project?: string;
  parent?: string;
  dependsOn?: string[];
  type?: string;
};

export type ExecuteCreateTask = (
  action: CreateTaskAction,
  input: { agentId: string; agentName: string; companyId: string; taskKey: string; runId: string },
  db: unknown,
) => Promise<string | null>;

function suffix(length: number): string {
  return Math.random().toString(36).slice(2, 2 + length);
}

export function createFixtureProject(
  createProject: CreateProjectFn,
  options: {
    companyId?: string;
    namePrefix: string;
    label: string;
    description: string;
    color: string;
    emoji: string;
  },
): ProjectFixture {
  return createProject({
    companyId: options.companyId ?? DEFAULT_ORCHESTRATION_COMPANY_ID,
    name: `${options.namePrefix} ${options.label} ${Date.now()}-${suffix(2)}`,
    description: options.description,
    color: options.color,
    emoji: options.emoji,
    status: "active",
  }).project;
}

export function createFixtureAgent(
  createProjectAgent: CreateProjectAgentFn,
  options: {
    projectId: string;
    label?: string;
    namePrefix: string;
    openclawPrefix: string;
    emoji: string;
    role: string;
    skills: string[];
    status?: string;
  },
): AgentFixture {
  const labelPart = options.label ? `${options.label}-` : "";
  return createProjectAgent({
    projectId: options.projectId,
    name: `${options.namePrefix}-${labelPart}${suffix(2)}`,
    emoji: options.emoji,
    role: options.role,
    personality: "Deterministic",
    openclawAgentId: `${options.openclawPrefix}-${labelPart}${suffix(6)}`,
    status: options.status ?? "idle",
    skills: options.skills,
  }).agent;
}

export function createBasicFixtureTask(
  createTask: CreateTaskFn,
  options: {
    projectId: string;
    title: string;
    assignee: string;
    createdBy: string;
    description?: string;
    priority?: string;
    type?: string;
    status?: string;
    parentTaskId?: string;
  },
): TaskFixture {
  return createTask({
    projectId: options.projectId,
    title: options.title,
    description: options.description ?? "x",
    priority: options.priority ?? "P2",
    type: options.type ?? "feature",
    status: options.status ?? "in-progress",
    assignee: options.assignee,
    parentTaskId: options.parentTaskId,
    labels: [],
    createdBy: options.createdBy,
  }).task;
}

export async function executeFixtureCreateTask(
  executeCreateTask: ExecuteCreateTask,
  db: unknown,
  options: {
    action: CreateTaskAction;
    actor: AgentFixture;
    companyId: string;
    taskKey: string;
    assertMessage?: string;
  },
): Promise<string> {
  const taskId = await executeCreateTask(
    options.action,
    {
      agentId: options.actor.id,
      agentName: options.actor.name,
      companyId: options.companyId,
      taskKey: options.taskKey,
      runId: randomUUID(),
    },
    db,
  );
  assert.ok(taskId, options.assertMessage);
  return taskId;
}
