import { OrchestrationApiError } from "@/lib/orchestration/api";
import {
  listProjects as listProjectsRaw,
  createProject as createProjectRaw,
  getProject as getProjectRaw,
  lookupProjectByName as lookupProjectByNameRaw,
  updateProjectSettings as updateProjectSettingsRaw,
  archiveProject as archiveProjectRaw,
  cleanupDeletedProjectOpenClawAgents as cleanupDeletedProjectOpenClawAgentsRaw,
  getProjectBoard as getProjectBoardRaw,
  getProjectBoardUpdatedAt as getProjectBoardUpdatedAtRaw,
  hardDeleteProject as hardDeleteProjectRaw,
} from "./project";
import {
  listProjectAgents as listProjectAgentsRaw,
  listCompanyAgents as listCompanyAgentsRaw,
  getCompanyAgentProfile as getCompanyAgentProfileRaw,
  getAgentProfile as getAgentProfileRaw,
  syncCompanyAgentsFromOpenClaw as syncCompanyAgentsFromOpenClawRaw,
  lookupAgentByName as lookupAgentByNameRaw,
  createProjectAgent as createProjectAgentRaw,
  regenerateProjectAgentAvatar as regenerateProjectAgentAvatarRaw,
  heartbeatProjectAgent as heartbeatProjectAgentRaw,
  fireCompanyAgent as fireCompanyAgentRaw,
  cleanupDepartedAgentReferences as cleanupDepartedAgentReferencesRaw,
} from "./agent";
import {
  listTasks as listTasksRaw,
  getTask as getTaskRaw,
  createTask as createTaskRaw,
  updateTask as updateTaskRaw,
  archiveTask as archiveTaskRaw,
  moveTask as moveTaskRaw,
  assignTask as assignTaskRaw,
} from "./task";
import { getTaskDetail as getTaskDetailRaw } from "./task-detail";
import {
  listProjectSprints as listProjectSprintsRaw,
  createProjectSprint as createProjectSprintRaw,
  updateSprint as updateSprintRaw,
} from "./sprint";
import {
  listTaskComments as listTaskCommentsRaw,
  createTaskComment as createTaskCommentRaw,
} from "./comment";
import {
  listActivityFeed as listActivityFeedRaw,
  listStaleTaskAlerts as listStaleTaskAlertsRaw,
} from "./activity";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Unknown orchestration service error";
}

function withServiceContext<TArgs extends unknown[], TResult>(
  context: string,
  fn: (...args: TArgs) => TResult
): (...args: TArgs) => TResult {
  return (...args: TArgs): TResult => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof OrchestrationApiError) {
        throw error;
      }

      const message = toErrorMessage(error);
      console.error("[orchestration] service failure", {
        context,
        message,
        cause: error,
      });

      throw new OrchestrationApiError(
        500,
        "service_operation_failed",
        "Unexpected orchestration service failure",
        { context, cause: message }
      );
    }
  };
}

export const listProjects = withServiceContext("project.listProjects", listProjectsRaw);
export const createProject = withServiceContext("project.createProject", createProjectRaw);
export const getProject = withServiceContext("project.getProject", getProjectRaw);
export const lookupProjectByName = withServiceContext(
  "project.lookupProjectByName",
  lookupProjectByNameRaw
);
export const updateProjectSettings = withServiceContext(
  "project.updateProjectSettings",
  updateProjectSettingsRaw
);
export const archiveProject = withServiceContext("project.archiveProject", archiveProjectRaw);
export const hardDeleteProject = withServiceContext("project.hardDeleteProject", hardDeleteProjectRaw);
export const cleanupDeletedProjectOpenClawAgents = withServiceContext(
  "project.cleanupDeletedProjectOpenClawAgents",
  cleanupDeletedProjectOpenClawAgentsRaw
);
export const getProjectBoard = withServiceContext("project.getProjectBoard", getProjectBoardRaw);
export const getProjectBoardUpdatedAt = withServiceContext(
  "project.getProjectBoardUpdatedAt",
  getProjectBoardUpdatedAtRaw
);

export const listProjectAgents = withServiceContext("agent.listProjectAgents", listProjectAgentsRaw);
export const listCompanyAgents = withServiceContext("agent.listCompanyAgents", listCompanyAgentsRaw);
export const getCompanyAgentProfile = withServiceContext(
  "agent.getCompanyAgentProfile",
  getCompanyAgentProfileRaw
);
export const getAgentProfile = withServiceContext("agent.getAgentProfile", getAgentProfileRaw);
export const syncCompanyAgentsFromOpenClaw = withServiceContext(
  "agent.syncCompanyAgentsFromOpenClaw",
  syncCompanyAgentsFromOpenClawRaw
);
export const lookupAgentByName = withServiceContext("agent.lookupAgentByName", lookupAgentByNameRaw);
export const createProjectAgent = withServiceContext("agent.createProjectAgent", createProjectAgentRaw);
export const regenerateProjectAgentAvatar = withServiceContext(
  "agent.regenerateProjectAgentAvatar",
  regenerateProjectAgentAvatarRaw
);
export const heartbeatProjectAgent = withServiceContext(
  "agent.heartbeatProjectAgent",
  heartbeatProjectAgentRaw
);
export const fireCompanyAgent = withServiceContext(
  "agent.fireCompanyAgent",
  fireCompanyAgentRaw
);
export const cleanupDepartedAgentReferences = withServiceContext(
  "agent.cleanupDepartedAgentReferences",
  cleanupDepartedAgentReferencesRaw
);

export const listTasks = withServiceContext("task.listTasks", listTasksRaw);
export const getTask = withServiceContext("task.getTask", getTaskRaw);
export const getTaskDetail = withServiceContext("task.getTaskDetail", getTaskDetailRaw);
export const createTask = withServiceContext("task.createTask", createTaskRaw);
export const updateTask = withServiceContext("task.updateTask", updateTaskRaw);
export const archiveTask = withServiceContext("task.archiveTask", archiveTaskRaw);
export const moveTask = withServiceContext("task.moveTask", moveTaskRaw);
export const assignTask = withServiceContext("task.assignTask", assignTaskRaw);

export const listProjectSprints = withServiceContext("sprint.listProjectSprints", listProjectSprintsRaw);
export const createProjectSprint = withServiceContext("sprint.createProjectSprint", createProjectSprintRaw);
export const updateSprint = withServiceContext("sprint.updateSprint", updateSprintRaw);

export const listTaskComments = withServiceContext("comment.listTaskComments", listTaskCommentsRaw);
export const createTaskComment = withServiceContext("comment.createTaskComment", createTaskCommentRaw);

export const listActivityFeed = withServiceContext("activity.listActivityFeed", listActivityFeedRaw);
export const listStaleTaskAlerts = withServiceContext("activity.listStaleTaskAlerts", listStaleTaskAlertsRaw);
