export type VoiceToolName =
  | "get_current_time"
  | "get_system_status"
  | "get_project_summary"
  | "get_weather"
  | "search_tasks"
  | "search_workspace_memory"
  | "search_voice_memory"
  | "get_current_context"
  | "add_task_comment"
  | "start_task_work"
  | "move_task_status"
  | "reassign_task"
  | "set_task_priority"
  | "remember";

interface LiveApiParameterSchema {
  type: "OBJECT";
  properties?: Record<string, unknown>;
  required?: string[];
}

interface OpenAiRealtimeParameterSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface VoiceToolDefinition {
  name: VoiceToolName;
  description: string;
  kind: "read" | "action";
  parameters?: LiveApiParameterSchema;
}

export const VOICE_TOOL_DEFINITIONS: VoiceToolDefinition[] = [
  {
    name: "get_current_time",
    description: "Get the current local date, time, and timezone information.",
    kind: "read",
  },
  {
    name: "get_system_status",
    description: "Get current HiveRunner runtime health such as uptime and memory.",
    kind: "read",
  },
  {
    name: "get_project_summary",
    description: "Get a cached summary of HiveRunner projects and current lanes.",
    kind: "read",
  },
  {
    name: "get_weather",
    description: "Get the current weather for a requested location.",
    kind: "read",
    parameters: {
      type: "OBJECT",
      properties: {
        location: { type: "STRING", description: "Location such as Santa Rosa, CA." },
      },
    },
  },
  {
    name: "search_tasks",
    description: "Search HiveRunner tasks by query and optional status.",
    kind: "read",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Task search text." },
        status: { type: "STRING", description: "Optional status filter such as done or blocked." },
      },
    },
  },
  {
    name: "search_workspace_memory",
    description: "Search fresh workspace memory and recent operating notes.",
    kind: "read",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Search query." },
        limit: { type: "NUMBER", description: "Maximum number of results to return." },
      },
      required: ["query"],
    },
  },
  {
    name: "search_voice_memory",
    description: "Search prior voice-session memory and saved transcripts.",
    kind: "read",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Search query." },
        limit: { type: "NUMBER", description: "Maximum number of results to return." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_current_context",
    description: "Load a fresh startup-style HiveRunner context snapshot.",
    kind: "read",
  },
  {
    name: "add_task_comment",
    description: "Post a real comment on the currently bound task.",
    kind: "action",
    parameters: {
      type: "OBJECT",
      properties: {
        body: { type: "STRING", description: "Operator-facing comment text to post on the bound task." },
      },
      required: ["body"],
    },
  },
  {
    name: "start_task_work",
    description: "Start real execution on the currently bound task: ensure the bound agent owns it when appropriate, move it to In Progress, and queue the agent's runtime wake/run.",
    kind: "action",
  },
  {
    name: "move_task_status",
    description: "Move the currently bound task to a new status such as To-Do, blocked, review, or done.",
    kind: "action",
    parameters: {
      type: "OBJECT",
      properties: {
        status: { type: "STRING", description: "Requested task status." },
        blockedReason: { type: "STRING", description: "Optional blocked reason when moving to blocked." },
      },
      required: ["status"],
    },
  },
  {
    name: "reassign_task",
    description: "Reassign the currently bound task to a different agent. Accepts the agent's name or id; resolves to a company agent. Pass null/empty to unassign.",
    kind: "action",
    parameters: {
      type: "OBJECT",
      properties: {
        assignee: { type: "STRING", description: "Agent name or id to assign the task to. Leave empty to unassign." },
      },
      required: ["assignee"],
    },
  },
  {
    name: "set_task_priority",
    description: "Set the priority on the currently bound task. Accepts P0/P1/P2/P3 or urgent/high/medium/low.",
    kind: "action",
    parameters: {
      type: "OBJECT",
      properties: {
        priority: { type: "STRING", description: "Target priority. P0 or 'urgent' = highest, P3 or 'low' = lowest." },
      },
      required: ["priority"],
    },
  },
  {
    name: "remember",
    description: "Save a durable fact or preference about the operator to your long-term memory. Use when the operator asks you to remember something — personal facts, work preferences, how they want things handled going forward. Memory persists across tasks, projects, and sessions for this agent.",
    kind: "action",
    parameters: {
      type: "OBJECT",
      properties: {
        subject: { type: "STRING", description: "Short topic bucket for the memory, e.g. 'movies', 'code review style', 'task naming'. Lowercase, 1-3 words." },
        detail: { type: "STRING", description: "The fact or preference to remember, written as a clean sentence. Example: 'The operator prefers concise PR descriptions with a Test Plan section.'" },
      },
      required: ["subject", "detail"],
    },
  },
];

export const VOICE_TOOL_NAMES = VOICE_TOOL_DEFINITIONS.map((tool) => tool.name);

export const VOICE_TOOL_DESCRIPTIONS: Record<VoiceToolName, string> = Object.fromEntries(
  VOICE_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.description]),
) as Record<VoiceToolName, string>;

export function isVoiceToolName(name: string): name is VoiceToolName {
  return VOICE_TOOL_NAMES.includes(name as VoiceToolName);
}

export function getLiveApiTools() {
  return [
    {
      functionDeclarations: VOICE_TOOL_DEFINITIONS.map((tool) => {
        if (tool.parameters) {
          return {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          };
        }
        return {
          name: tool.name,
          description: tool.description,
        };
      }),
    },
  ];
}

function normalizeOpenAiSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeOpenAiSchemaValue(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "type" && typeof entry === "string") {
      next[key] = entry.toLowerCase();
      continue;
    }
    next[key] = normalizeOpenAiSchemaValue(entry);
  }
  return next;
}

function toOpenAiParameters(parameters?: LiveApiParameterSchema): OpenAiRealtimeParameterSchema {
  if (!parameters) {
    return {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    };
  }

  return {
    ...(normalizeOpenAiSchemaValue(parameters) as OpenAiRealtimeParameterSchema),
    type: "object",
    additionalProperties: false,
  };
}

export function getOpenAiRealtimeTools() {
  const hiveRunnerTools = VOICE_TOOL_DEFINITIONS.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: toOpenAiParameters(tool.parameters),
  }));

  return [
    ...hiveRunnerTools,
    {
      type: "function" as const,
      name: "wait_for_user",
      description: "Call this when the latest audio is silence, background noise, a side conversation, or speech not addressed to you. It ends the turn without a spoken reply.",
      parameters: {
        type: "object" as const,
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  ];
}
