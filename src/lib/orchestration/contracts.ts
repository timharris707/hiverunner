import { z } from "zod";

export const taskStatusSchema = z.enum([
  "backlog",
  "on-deck",
  "in-progress",
  "review",
  "done",
  "blocked",
]);

export const taskPrioritySchema = z.enum(["P0", "P1", "P2", "P3"]);

export const taskTypeSchema = z.enum([
  "feature",
  "bug",
  "maintenance",
  "research",
  "infrastructure",
  "directive",
]);

export const projectStatusSchema = z.enum(["active", "paused", "archived"]);
export const companyStatusSchema = z.enum(["active", "paused", "archived"]);
export const sprintStatusSchema = z.enum(["planned", "active", "done"]);
export const commentTypeSchema = z.enum(["comment", "status_update", "code_link", "review", "blocker"]);
export const agentStatusSchema = z.enum(["idle", "working", "paused", "offline", "error"]);

const queryBooleanSchema = z
  .enum(["1", "0", "true", "false"])
  .transform((value) => value === "1" || value === "true");

export const listCompaniesQuerySchema = z.object({
  includeArchived: queryBooleanSchema.optional().default(false),
  includeNonProduction: queryBooleanSchema.optional().default(false),
});

export const listProjectsQuerySchema = z.object({
  company: z.string().trim().min(1).optional(),
  includeArchived: queryBooleanSchema.optional().default(false),
  includeNonProduction: queryBooleanSchema.optional().default(false),
});

export const listCompanyInboxQuerySchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  status: taskStatusSchema.optional(),
  search: z.string().trim().min(1).max(240).optional(),
  includeDone: queryBooleanSchema.optional().default(false),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().trim().min(1).optional(),
  unreadSince: z.string().datetime({ offset: true }).optional(),
  includeTaskSnapshot: queryBooleanSchema.optional().default(true),
  /** Filter by event kind. Comma-separated: "task", "execution", "approval". Omit for all. */
  kinds: z.string().trim().min(1).optional(),
});

export const listCompanyGoalsQuerySchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  status: sprintStatusSchema.optional(),
  includeCompleted: queryBooleanSchema.optional().default(true),
});

export const listCompanyHeartbeatSettingsQuerySchema = z.object({
  includeNonProduction: queryBooleanSchema.optional().default(false),
});

export const listCompanyExecutionSettingsQuerySchema = z.object({
  includeNonProduction: queryBooleanSchema.optional().default(false),
});

export const listTasksQuerySchema = z.object({
  company: z.string().trim().min(1).optional(),
  projectId: z.string().min(1).optional(),
  assignee: z.string().trim().min(1).optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  type: taskTypeSchema.optional(),
  search: z.string().trim().min(1).max(240).optional(),
  sort: z
    .enum(["updated-desc", "created-desc", "priority-asc", "priority-desc"])
    .optional()
    .default("updated-desc"),
  sourceReviewId: z.string().trim().min(1).max(120).optional(),
  sourceTakeawayId: z.string().trim().min(1).max(120).optional(),
  includeArchived: queryBooleanSchema.optional().default(false),
  includeNonProduction: queryBooleanSchema.optional().default(false),
});

export const listActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  agentId: z.string().trim().min(1).optional(),
});

export const listAlertsQuerySchema = z.object({
  projectId: z.string().trim().min(1).optional(),
});

export const projectLookupQuerySchema = z.object({
  name: z.string().trim().min(1),
  companyId: z.string().trim().min(1).optional(),
});

export const agentLookupQuerySchema = z.object({
  name: z.string().trim().min(1),
  companyId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
});

export const agentProfileQuerySchema = z.object({
  company: z.string().trim().min(1).optional(),
  executionLimit: z.coerce.number().int().min(1).max(100).optional().default(20),
  activityLimit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const createProjectSchema = z.object({
  companyId: z.string().trim().min(1),
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  description: z.string().max(5000).optional().default(""),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().default("#0ea5e9"),
  emoji: z.string().trim().max(8).optional().default("🛰️"),
  owner: z.string().trim().max(100).optional(),
  status: projectStatusSchema.optional().default("active"),
  avatarThemeName: z.string().trim().min(1).max(120).optional(),
  staleAlertThresholdsHours: z
    .object({
      review: z.number().min(0).max(168).optional(),
      inProgress: z.number().min(0).max(168).optional(),
      blocked: z.number().min(0).max(168).optional(),
    })
    .optional(),
});

export const updateProjectSettingsSchema = z
  .object({
    emoji: z.string().trim().max(8).optional(),
    status: projectStatusSchema.optional(),
    staleAlertThresholdsHours: z
      .object({
        review: z.number().min(0).max(168).optional(),
        inProgress: z.number().min(0).max(168).optional(),
        blocked: z.number().min(0).max(168).optional(),
      })
      .optional(),
  })
  .refine(
    (value) =>
      value.emoji !== undefined || value.status !== undefined || value.staleAlertThresholdsHours !== undefined,
    {
      message: "At least one settings field must be provided",
      path: [],
    }
  );

export const createCompanySchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  description: z.string().max(5000).optional().default(""),
  status: companyStatusSchema.optional().default("active"),
  theme: z
    .object({
      name: z.string().trim().min(2).max(120),
      promptTemplate: z.string().trim().min(8).max(3000),
      keywords: z.array(z.string().trim().min(1).max(60)).max(24).optional().default([]),
      sampleUrl: z.string().url().optional(),
    })
    .optional(),
});

export const updateCompanySchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    description: z.string().max(5000).optional(),
    status: companyStatusSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.slug !== undefined ||
      value.description !== undefined ||
      value.status !== undefined,
    {
      message: "At least one company field must be provided",
      path: [],
    }
  );

export const updateCompanyThemeSchema = z
  .object({
    presetId: z.string().trim().min(1).max(120).optional(),
    name: z.string().trim().min(2).max(120).optional(),
    promptTemplate: z.string().trim().min(8).max(3000).optional(),
    keywords: z.array(z.string().trim().min(1).max(60)).max(24).optional(),
    sampleUrl: z.string().url().nullable().optional(),
  })
  .refine(
    (value) =>
      value.presetId !== undefined ||
      value.name !== undefined ||
      value.promptTemplate !== undefined ||
      value.keywords !== undefined ||
      value.sampleUrl !== undefined,
    {
      message: "At least one theme field must be provided",
      path: [],
    }
  );

export const createTaskSchema = z.object({
  projectId: z.string().trim().min(1),
  title: z.string().trim().min(2).max(240),
  description: z.string().max(10000).optional().default(""),
  priority: taskPrioritySchema.optional().default("P2"),
  type: taskTypeSchema.optional().default("feature"),
  status: taskStatusSchema.optional().default("backlog"),
  assignee: z.string().trim().min(1).optional(),
  sprintId: z.string().trim().min(1).optional(),
  parentTaskId: z.string().trim().min(1).optional(),
  labels: z.array(z.string().trim().min(1).max(60)).max(32).optional().default([]),
  blockedReason: z.string().max(2000).optional(),
  createdBy: z.string().trim().min(1).max(100).optional().default("api"),
  columnOrder: z.number().int().min(0).optional(),
  sourceReviewId: z.string().trim().min(1).max(120).optional(),
  sourceTakeawayId: z.string().trim().min(1).max(120).optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(2).max(240).optional(),
    description: z.string().max(10000).optional(),
    priority: taskPrioritySchema.optional(),
    type: taskTypeSchema.optional(),
    sprintId: z.string().trim().min(1).nullable().optional(),
    parentTaskId: z.string().trim().min(1).nullable().optional(),
    labels: z.array(z.string().trim().min(1).max(60)).max(32).optional(),
    blockedReason: z.string().max(2000).nullable().optional(),
    reviewNotes: z.string().max(5000).nullable().optional(),
    actorUserId: z.string().trim().min(1).max(100).optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.priority !== undefined ||
      value.type !== undefined ||
      value.sprintId !== undefined ||
      value.parentTaskId !== undefined ||
      value.labels !== undefined ||
      value.blockedReason !== undefined ||
      value.reviewNotes !== undefined,
    {
      message: "At least one task field must be provided",
      path: [],
    }
  );

export const reorderTaskSchema = z.object({
  taskId: z.string().trim().min(1),
  status: taskStatusSchema,
  columnOrder: z.number().int().min(0).optional(),
  blockedReason: z.string().max(2000).nullable().optional(),
  reviewNotes: z.string().max(5000).nullable().optional(),
  actorUserId: z.string().trim().min(1).max(100).optional(),
});

export const assignTaskSchema = z.object({
  assignee: z.string().trim().min(1).nullable().optional(),
  actorUserId: z.string().trim().min(1).max(100).optional(),
});

export const cancelTaskExecutionSchema = z.object({
  actorUserId: z.string().trim().min(1).max(100).optional(),
  note: z.string().trim().min(1).max(5000).optional(),
  targetStatus: z.enum(["on-deck", "in-progress"]).optional().default("on-deck"),
});

export const createSprintSchema = z.object({
  name: z.string().trim().min(2).max(120),
  goal: z.string().max(4000).optional().default(""),
  status: sprintStatusSchema.optional().default("planned"),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).nullable().optional(),
  parentId: z.string().trim().min(1).optional(),
  owner: z.string().trim().max(200).nullable().optional(),
});

export const updateSprintSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    goal: z.string().max(4000).optional(),
    status: sprintStatusSchema.optional(),
    startDate: z.string().datetime({ offset: true }).optional(),
    endDate: z.string().datetime({ offset: true }).nullable().optional(),
    parentId: z.string().trim().min(1).nullable().optional(),
    owner: z.string().trim().max(200).nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.goal !== undefined ||
      value.status !== undefined ||
      value.startDate !== undefined ||
      value.endDate !== undefined ||
      value.parentId !== undefined ||
      value.owner !== undefined,
    {
      message: "At least one sprint field must be provided",
      path: [],
    }
  );

export const createCompanyGoalSchema = createSprintSchema.extend({
  projectId: z.string().trim().min(1),
});

export const updateCompanyGoalSchema = updateSprintSchema.extend({
  sprintId: z.string().trim().min(1),
});

export const deleteCompanyGoalSchema = z.object({
  sprintId: z.string().trim().min(1),
});

export const createTaskCommentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  type: commentTypeSchema.optional().default("comment"),
  authorAgentId: z.string().trim().min(1).optional(),
  authorUserId: z.string().trim().min(1).max(100).optional(),
});

export const createProjectAgentSchema = z.object({
  companyId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(2).max(120),
  emoji: z.string().trim().max(8).optional().default("🤖"),
  role: z.string().trim().min(2).max(160),
  personality: z.string().max(4000).optional().default(""),
  avatarUrl: z.string().url().optional(),
  model: z.string().trim().min(1).max(120).optional(),
  paperclipAgentId: z.string().trim().min(1).max(120).optional(),
  openclawAgentId: z.string().trim().min(1).max(120).optional(),
  reportingTo: z.string().trim().min(1).optional(),
  skills: z.array(z.string().trim().min(1).max(80)).max(50).optional().default([]),
  status: agentStatusSchema.optional().default("idle"),
});

export const agentHeartbeatSchema = z.object({
  status: agentStatusSchema.optional(),
  currentTaskId: z.string().trim().min(1).nullable().optional(),
  runtimeMinutesDelta: z.number().int().min(0).max(1_440).optional().default(0),
  observedAt: z.string().datetime({ offset: true }).optional(),
  source: z.enum(["cron", "openclaw", "manual"]).optional().default("cron"),
});

export const updateCompanyHeartbeatSettingsSchema = z
  .object({
    agentId: z.string().trim().min(1),
    heartbeatEnabled: z.boolean().optional(),
    intervalSeconds: z.number().int().min(0).max(86_400).optional(),
  })
  .refine(
    (value) =>
      value.heartbeatEnabled !== undefined ||
      value.intervalSeconds !== undefined,
    {
      message: "At least one heartbeat settings field must be provided",
      path: [],
    }
  );

export const updateCompanyExecutionSettingsSchema = z
  .object({
    agentId: z.string().trim().min(1),
    modelId: z.string().trim().min(1).max(200).optional(),
    timeoutSeconds: z.number().int().min(0).max(86_400).optional(),
    graceSeconds: z.number().int().min(0).max(86_400).optional(),
  })
  .refine(
    (value) =>
      value.modelId !== undefined ||
      value.timeoutSeconds !== undefined ||
      value.graceSeconds !== undefined,
    {
      message: "At least one execution settings field must be provided",
      path: [],
    }
  );

/* ── Routines ── */

export const routineStatusSchema = z.enum(["active", "paused", "archived"]);
export const routinePrioritySchema = z.enum(["critical", "high", "medium", "low"]);
export const routineConcurrencyPolicySchema = z.enum(["coalesce_if_active", "always_enqueue", "skip_if_active"]);
export const routineCatchUpPolicySchema = z.enum(["skip_missed", "enqueue_missed_with_cap"]);

export const listRoutinesQuerySchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  status: routineStatusSchema.optional(),
});

export const createRoutineSchema = z.object({
  title: z.string().trim().min(2).max(240),
  description: z.string().max(10000).optional().default(""),
  projectId: z.string().trim().min(1),
  assigneeAgentId: z.string().trim().min(1),
  priority: routinePrioritySchema.optional().default("medium"),
  concurrencyPolicy: routineConcurrencyPolicySchema.optional().default("coalesce_if_active"),
  catchUpPolicy: routineCatchUpPolicySchema.optional().default("skip_missed"),
});

export const updateRoutineSchema = z
  .object({
    title: z.string().trim().min(2).max(240).optional(),
    description: z.string().max(10000).optional(),
    projectId: z.string().trim().min(1).optional(),
    assigneeAgentId: z.string().trim().min(1).optional(),
    priority: routinePrioritySchema.optional(),
    status: routineStatusSchema.optional(),
    concurrencyPolicy: routineConcurrencyPolicySchema.optional(),
    catchUpPolicy: routineCatchUpPolicySchema.optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.projectId !== undefined ||
      value.assigneeAgentId !== undefined ||
      value.priority !== undefined ||
      value.status !== undefined ||
      value.concurrencyPolicy !== undefined ||
      value.catchUpPolicy !== undefined,
    {
      message: "At least one routine field must be provided",
      path: [],
    }
  );

export type RoutineStatusInput = z.infer<typeof routineStatusSchema>;
export type RoutinePriorityInput = z.infer<typeof routinePrioritySchema>;

export type TaskStatusInput = z.infer<typeof taskStatusSchema>;
export type TaskPriorityInput = z.infer<typeof taskPrioritySchema>;
export type TaskTypeInput = z.infer<typeof taskTypeSchema>;
export type ProjectStatusInput = z.infer<typeof projectStatusSchema>;
export type CompanyStatusInput = z.infer<typeof companyStatusSchema>;
export type SprintStatusInput = z.infer<typeof sprintStatusSchema>;
export type CommentTypeInput = z.infer<typeof commentTypeSchema>;
export type AgentStatusInput = z.infer<typeof agentStatusSchema>;
