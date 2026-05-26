import { z } from "zod";

export const taskStatusSchema = z.enum([
  "backlog",
  "to-do",
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
  "epic",
  "spike",
  "docs",
  "infra",
  "refactor",
  "review",
  "qa",
  "release",
]);

export const taskExecutionEngineSchema = z.enum(["hiverunner", "symphony", "manual"]);
export const taskModelLaneSchema = z.enum(["default", "fast", "mini", "deep"]);
export const taskRuntimeProviderSchema = z.string().trim().min(1).max(80);
export const taskModelRoutingSchema = z.string().trim().min(1).max(80);

export const projectStatusSchema = z.enum(["active", "paused", "archived"]);
export const companyStatusSchema = z.enum(["active", "paused", "archived"]);
export const sprintStatusSchema = z.enum(["planned", "active", "blocked", "paused", "done"]);
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
  includeArchived: queryBooleanSchema.optional().default(false),
  summary: queryBooleanSchema.optional().default(false),
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

export const listCompanyExecutionHivesQuerySchema = z.object({
  includeArchived: queryBooleanSchema.optional().default(false),
});

export const activateCompanyExecutionHiveSchema = z.object({
  actor: z.string().trim().min(1).max(120).optional(),
});

export const configureCompanyExecutionHiveSchema = z.object({
  actor: z.string().trim().min(1).max(120).optional(),
  orchestrationMode: taskExecutionEngineSchema,
  runtimeProvider: z.enum(["codex", "anthropic", "gemini", "hermes", "openclaw"]),
  runtimeLabel: z.string().trim().min(1).max(120),
  modelRouting: z.enum(["runtime-managed", "hive-managed", "openrouter", "anthropic", "openai", "google"]),
  modelRoutingLabel: z.string().trim().min(1).max(120),
});

const executionHiveRouteTargetSchema = z.object({
  runtimeId: z.string().trim().min(1).max(120).optional(),
  runtimeLabel: z.string().trim().min(1).max(120).optional(),
  modelSourceId: z.string().trim().min(1).max(120).optional(),
  modelSourceLabel: z.string().trim().min(1).max(120).optional(),
  modelId: z.string().trim().min(1).max(160).optional(),
  modelLabel: z.string().trim().min(1).max(160).optional(),
  mode: z.enum(["runtime_managed", "hive_managed", "direct_source", "broker", "local"]),
});

export const updateCompanyExecutionHiveLaneSchema = z.object({
  actor: z.string().trim().min(1).max(120).optional(),
  primary: executionHiveRouteTargetSchema,
  fallbacks: z.array(executionHiveRouteTargetSchema).max(3).default([]),
});

export const runCompanyExecutionHiveProbeSchema = z.object({
  actor: z.string().trim().min(1).max(120).optional(),
  laneId: z.enum(["default", "fast", "mini", "deep", "vision", "local"]),
  kind: z.enum(["lane", "conformance"]),
});

export const availableModelProviderSchema = z.enum([
  "anthropic",
  "openai",
  "google",
  "hermes",
  "openclaw",
  "openrouter",
]);

export const availableModelCapabilitySchema = z.enum([
  "text",
  "vision",
  "tools",
  "structured-output",
]);

export const listAvailableModelsQuerySchema = z.object({
  provider: availableModelProviderSchema.optional(),
  capability: availableModelCapabilitySchema.optional(),
  includeInactive: queryBooleanSchema.optional().default(false),
});

export const createAvailableModelSchema = z.object({
  id: z.string().trim().min(1).max(160),
  displayName: z.string().trim().min(1).max(240),
  runtimeProvider: availableModelProviderSchema,
  defaultRuntimeLabel: z.string().trim().min(1).max(120),
  modelSourceId: z.string().trim().min(1).max(120),
  capabilities: z.array(availableModelCapabilitySchema).optional().default([]),
  contextWindow: z.number().int().positive().nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

export const updateAvailableModelSchema = z.object({
  displayName: z.string().trim().min(1).max(240).optional(),
  defaultRuntimeLabel: z.string().trim().min(1).max(120).optional(),
  modelSourceId: z.string().trim().min(1).max(120).optional(),
  capabilities: z.array(availableModelCapabilitySchema).optional(),
  contextWindow: z.number().int().positive().nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

const modelSourceCredentialValueSchema = z.string().trim().min(1).max(10000);

export const saveCompanyModelSourceCredentialSchema = z
  .object({
    sourceId: z.enum(["openai", "anthropic", "google", "openrouter", "ollama", "vllm"]),
    credentialValue: modelSourceCredentialValueSchema.optional(),
    apiKey: modelSourceCredentialValueSchema.optional(),
  })
  .transform((value) => ({
    sourceId: value.sourceId,
    credentialValue: value.credentialValue ?? value.apiKey ?? "",
  }))
  .refine((value) => value.credentialValue.length > 0, {
    message: "Credential value is required",
    path: ["credentialValue"],
  });

export const listCompanyAgentsQuerySchema = z.object({
  includeNonProduction: queryBooleanSchema.optional().default(false),
  includeArchived: queryBooleanSchema.optional().default(false),
});

export const updateDevExecutionTestModeSchema = z.object({
  enabled: z.boolean(),
  durationMinutes: z.number().int().min(1).max(720).optional(),
  actor: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().max(500).optional(),
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
  limit: z.coerce.number().int().min(1).max(500).optional(),
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
  sourceWorkspaceRoot: z.string().trim().max(2000).nullable().optional(),
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
    name: z.string().trim().min(2).max(120).optional(),
    slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    emoji: z.string().trim().max(8).optional(),
    color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    status: projectStatusSchema.optional(),
    defaultExecutionEngine: taskExecutionEngineSchema.nullable().optional(),
    sourceWorkspaceRoot: z.string().trim().max(2000).nullable().optional(),
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
      value.name !== undefined ||
      value.slug !== undefined ||
      value.emoji !== undefined ||
      value.color !== undefined ||
      value.status !== undefined ||
      value.defaultExecutionEngine !== undefined ||
      value.sourceWorkspaceRoot !== undefined ||
      value.staleAlertThresholdsHours !== undefined,
    {
      message: "At least one field must be provided",
      path: [],
    }
  );

export const createCompanySchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  description: z.string().max(5000).optional().default(""),
  status: companyStatusSchema.optional().default("active"),
  owner: z
    .object({
      displayName: z.string().trim().min(1).max(120),
      email: z.string().trim().email().max(240),
    })
    .optional(),
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
    defaultExecutionEngine: taskExecutionEngineSchema.nullable().optional(),
    owner: z
      .object({
        displayName: z.string().trim().min(1).max(120),
        email: z.string().trim().email().max(240),
      })
      .optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.slug !== undefined ||
      value.description !== undefined ||
      value.status !== undefined ||
      value.defaultExecutionEngine !== undefined ||
      value.owner !== undefined,
    {
      message: "At least one company field must be provided",
      path: [],
    }
  );

export const updateCompanyHiringSettingsSchema = z
  .object({
    autoApproveNewHires: z.boolean().optional(),
  })
  .refine((value) => value.autoApproveNewHires !== undefined, {
    message: "At least one hiring setting must be provided",
    path: [],
  });

export const updateCompanyRuntimeGovernanceSettingsSchema = z
  .object({
    requireProtectedRuntimeApprovals: z.boolean().optional(),
  })
  .refine((value) => value.requireProtectedRuntimeApprovals !== undefined, {
    message: "At least one runtime governance setting must be provided",
    path: [],
  });

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
  company: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(2).max(240),
  description: z.string().max(10000).optional().default(""),
  priority: taskPrioritySchema.optional().default("P2"),
  type: taskTypeSchema.optional().default("feature"),
  status: taskStatusSchema.optional().default("backlog"),
  assignee: z.string().trim().min(1).optional(),
  eligibleAssignees: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  dueDate: z.string().trim().min(1).max(32).optional(),
  sprintId: z.string().trim().min(1).optional(),
  parentTaskId: z.string().trim().min(1).optional(),
  labels: z.array(z.string().trim().min(1).max(60)).max(32).optional().default([]),
  blockedReason: z.string().max(2000).optional(),
  executionEngine: taskExecutionEngineSchema.nullable().optional(),
  executionRuntimeProvider: taskRuntimeProviderSchema.nullable().optional(),
  executionRuntimeLabel: z.string().trim().min(1).max(120).nullable().optional(),
  executionModelRouting: taskModelRoutingSchema.nullable().optional(),
  executionModelRoutingLabel: z.string().trim().min(1).max(120).nullable().optional(),
  modelLane: taskModelLaneSchema.nullable().optional(),
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
    projectId: z.string().trim().min(1).nullable().optional(),
    type: taskTypeSchema.optional(),
    eligibleAssignees: z.array(z.string().trim().min(1).max(120)).max(12).nullable().optional(),
    sprintId: z.string().trim().min(1).nullable().optional(),
    parentTaskId: z.string().trim().min(1).nullable().optional(),
    labels: z.array(z.string().trim().min(1).max(60)).max(32).optional(),
    blockedReason: z.string().max(2000).nullable().optional(),
    executionEngine: taskExecutionEngineSchema.nullable().optional(),
    executionRuntimeProvider: taskRuntimeProviderSchema.nullable().optional(),
    executionRuntimeLabel: z.string().trim().min(1).max(120).nullable().optional(),
    executionModelRouting: taskModelRoutingSchema.nullable().optional(),
    executionModelRoutingLabel: z.string().trim().min(1).max(120).nullable().optional(),
    modelLane: taskModelLaneSchema.nullable().optional(),
    reviewNotes: z.string().max(5000).nullable().optional(),
    actorUserId: z.string().trim().min(1).max(100).optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.priority !== undefined ||
      value.projectId !== undefined ||
      value.type !== undefined ||
      value.sprintId !== undefined ||
      value.parentTaskId !== undefined ||
      value.labels !== undefined ||
      value.blockedReason !== undefined ||
      value.executionEngine !== undefined ||
      value.executionRuntimeProvider !== undefined ||
      value.executionRuntimeLabel !== undefined ||
      value.executionModelRouting !== undefined ||
      value.executionModelRoutingLabel !== undefined ||
      value.modelLane !== undefined ||
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
  targetStatus: z.enum(["to-do", "in-progress"]).optional().default("to-do"),
});

export const createSprintSchema = z.object({
  name: z.string().trim().min(2).max(120),
  goal: z.string().max(4000).optional().default(""),
  goalKind: z.enum(["company", "sprint"]).optional(),
  status: sprintStatusSchema.optional().default("planned"),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).nullable().optional(),
  parentId: z.string().trim().min(1).optional(),
  owner: z.string().trim().max(200).nullable().optional(),
  leadAgentId: z.string().trim().min(1).nullable().optional(),
  stopCondition: z.string().max(4000).optional(),
  progressSummary: z.string().max(6000).optional(),
  defaultExecutionEngine: z.enum(["hiverunner", "symphony", "manual"]).nullable().optional(),
  defaultModelLane: z.enum(["default", "fast", "mini", "deep"]).nullable().optional(),
});

export const updateSprintSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    goal: z.string().max(4000).optional(),
    goalKind: z.enum(["company", "sprint"]).nullable().optional(),
    status: sprintStatusSchema.optional(),
    startDate: z.string().datetime({ offset: true }).optional(),
    endDate: z.string().datetime({ offset: true }).nullable().optional(),
    parentId: z.string().trim().min(1).nullable().optional(),
    owner: z.string().trim().max(200).nullable().optional(),
    leadAgentId: z.string().trim().min(1).nullable().optional(),
    stopCondition: z.string().max(4000).optional(),
    progressSummary: z.string().max(6000).optional(),
    defaultExecutionEngine: z.enum(["hiverunner", "symphony", "manual"]).nullable().optional(),
    defaultModelLane: z.enum(["default", "fast", "mini", "deep"]).nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.goal !== undefined ||
      value.goalKind !== undefined ||
      value.status !== undefined ||
      value.startDate !== undefined ||
      value.endDate !== undefined ||
      value.parentId !== undefined ||
      value.owner !== undefined ||
      value.leadAgentId !== undefined ||
      value.stopCondition !== undefined ||
      value.progressSummary !== undefined ||
      value.defaultExecutionEngine !== undefined ||
      value.defaultModelLane !== undefined,
    {
      message: "At least one sprint field must be provided",
      path: [],
    }
  );

export const createCompanyGoalSchema = createSprintSchema
  .extend({
    projectId: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.goalKind === "sprint" && !value.parentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sprint must be tied to a company goal",
        path: ["parentId"],
      });
    }
  });

export const updateCompanyGoalSchema = updateSprintSchema.extend({
  sprintId: z.string().trim().min(1),
});

export const deleteCompanyGoalSchema = z.object({
  sprintId: z.string().trim().min(1),
});

export const archiveCompanyGoalSchema = z.object({
  sprintId: z.string().trim().min(1),
});

export const goalContractItemKindSchema = z.enum(["success_criterion", "validation_check", "out_of_scope"]);
export const goalContractEvidenceStatusSchema = z.enum(["proposed", "passed", "failed", "retracted"]);

export const createGoalContractItemSchema = z.object({
  sprintId: z.string().trim().min(1),
  kind: goalContractItemKindSchema,
  text: z.string().trim().min(1).max(4000),
  position: z.number().int().min(0).optional(),
  actorUserId: z.string().trim().min(1).max(100).optional(),
  actorAgentId: z.string().trim().min(1).optional(),
});

export const updateGoalContractItemSchema = z.object({
  itemId: z.string().trim().min(1),
  text: z.string().trim().min(1).max(4000).optional(),
  position: z.number().int().min(0).optional(),
  archived: z.boolean().optional(),
  actorUserId: z.string().trim().min(1).max(100).optional(),
  actorAgentId: z.string().trim().min(1).optional(),
});

export const recordGoalContractEvidenceSchema = z.object({
  itemId: z.string().trim().min(1),
  status: goalContractEvidenceStatusSchema,
  resultText: z.string().trim().max(6000).optional(),
  commandExitCode: z.number().int().nullable().optional(),
  artifactUri: z.string().trim().max(2000).nullable().optional(),
  actorUserId: z.string().trim().min(1).max(100).optional(),
  actorAgentId: z.string().trim().min(1).optional(),
}).superRefine((value, ctx) => {
  if ((value.status === "passed" || value.status === "retracted") && !value.actorUserId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.status} evidence requires an operator actor`,
      path: ["actorUserId"],
    });
  }
  if ((value.status === "proposed" || value.status === "failed") && !value.actorAgentId && !value.actorUserId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Evidence requires an agent or operator actor",
      path: ["actorAgentId"],
    });
  }
});

const sprintPlanDraftTaskSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(6000).optional(),
  assignee: z.string().trim().max(120).nullable().optional(),
  eligibleAssignees: z.array(z.string().trim().min(1).max(120)).max(12).optional().default([]),
  priority: taskPrioritySchema.optional().default("P2"),
  type: taskTypeSchema.optional().default("feature"),
  executionEngine: taskExecutionEngineSchema.nullable().optional(),
  modelLane: taskModelLaneSchema.nullable().optional(),
  dependsOn: z.array(z.string().trim().min(1).max(120)).optional().default([]),
  validation: z.string().trim().max(2000).optional(),
});

const sprintPlanDraftSprintSchema = z.object({
  name: z.string().trim().min(2).max(160),
  objective: z.string().trim().min(1).max(4000),
  owner: z.string().trim().max(120).nullable().optional(),
  startDate: z.string().trim().min(1).max(32).optional(),
  endDate: z.string().trim().min(1).max(32).nullable().optional(),
  defaultExecutionEngine: taskExecutionEngineSchema.nullable().optional(),
  defaultModelLane: taskModelLaneSchema.nullable().optional(),
  successCriteria: z.array(z.string().trim().min(1).max(2000)).optional().default([]),
  validationChecks: z.array(z.string().trim().min(1).max(2000)).optional().default([]),
  outOfScope: z.array(z.string().trim().min(1).max(2000)).optional().default([]),
});

const sprintPlanDraftSprintWithSequenceSchema = sprintPlanDraftSprintSchema.extend({
  sequenceNumber: z.coerce.number().int().min(1).max(100).optional(),
  tasks: z.array(sprintPlanDraftTaskSchema).min(1).max(50),
});

export const proposeSprintPlanSchema = z.object({
  companyGoalId: z.string().trim().min(1),
  planMode: z.boolean().optional(),
  sprint: sprintPlanDraftSprintSchema.optional(),
  tasks: z.array(sprintPlanDraftTaskSchema).min(1).max(50).optional(),
  sprints: z.array(sprintPlanDraftSprintWithSequenceSchema).min(1).max(25).optional(),
}).superRefine((value, ctx) => {
  if (value.sprints?.length) return;
  if (!value.sprint) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A sprint or sprints array is required",
      path: ["sprint"],
    });
  }
  if (!value.tasks?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Single-sprint proposals require tasks",
      path: ["tasks"],
    });
  }
});

export const createSprintPlanningTaskSchema = z.object({
  leadAgentId: z.string().trim().min(1).nullable().optional(),
});

export const reviewSprintPlanDraftSchema = z.object({
  action: z.enum(["approve", "approve_all", "reject", "update"]),
  reason: z.string().trim().max(2000).optional(),
  sprint: sprintPlanDraftSprintSchema.optional(),
  tasks: z.array(sprintPlanDraftTaskSchema).min(1).max(50).optional(),
}).superRefine((value, ctx) => {
  if (value.action === "reject" && !value.reason?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Rejecting a sprint plan requires a reason",
      path: ["reason"],
    });
  }
  if (value.action === "update" && value.sprint === undefined && value.tasks === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Updating a sprint plan draft requires sprint or tasks",
      path: [],
    });
  }
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
  emoji: z.string().trim().max(80).optional().default(""),
  role: z.string().trim().min(2).max(160),
  personality: z.string().max(4000).optional().default(""),
  avatarUrl: z.string().url().optional(),
  avatarStyleId: z.string().trim().min(1).max(120).optional(),
  avatarGender: z.string().trim().min(1).max(40).optional(),
  avatarAge: z.number().int().min(18).max(120).optional(),
  avatarHairColor: z.string().trim().min(1).max(80).optional(),
  avatarHairLength: z.string().trim().min(1).max(80).optional(),
  avatarEyeColor: z.string().trim().min(1).max(80).optional(),
  avatarVibe: z.string().trim().min(1).max(240).optional(),
  voiceId: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  openclawAgentId: z.string().trim().min(1).max(120).optional(),
  reportingTo: z.string().trim().min(1).optional(),
  skills: z.array(z.string().trim().min(1).max(80)).max(50).optional().default([]),
  status: agentStatusSchema.optional().default("idle"),
});

export const fireCompanyAgentSchema = z
  .object({
    replacementAgentId: z.string().trim().min(1).optional(),
    replacementFallback: z.string().trim().min(1).max(120).optional(),
  })
  .optional()
  .default({});

export const cleanupDepartedAgentSchema = z.object({
  companyId: z.string().trim().min(1),
  departedName: z.string().trim().min(1).max(120),
  replacementAgentId: z.string().trim().min(1).optional(),
  replacementFallback: z.string().trim().min(1).max(120).optional(),
});

export const agentHeartbeatSchema = z.object({
  status: agentStatusSchema.optional(),
  currentTaskId: z.string().trim().min(1).nullable().optional(),
  runtimeMinutesDelta: z.number().int().min(0).max(1_440).optional().default(0),
  observedAt: z.string().datetime({ offset: true }).optional(),
  source: z.enum(["cron", "openclaw", "manual"]).optional().default("cron"),
  progressComment: z.string().trim().min(1).max(10_000).optional(),
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
export type TaskModelLaneInput = z.infer<typeof taskModelLaneSchema>;
export type TaskTypeInput = z.infer<typeof taskTypeSchema>;
export type ProjectStatusInput = z.infer<typeof projectStatusSchema>;
export type CompanyStatusInput = z.infer<typeof companyStatusSchema>;
export type SprintStatusInput = z.infer<typeof sprintStatusSchema>;
export type CommentTypeInput = z.infer<typeof commentTypeSchema>;
export type AgentStatusInput = z.infer<typeof agentStatusSchema>;
