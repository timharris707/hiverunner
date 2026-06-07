import type Database from "better-sqlite3";

import type {
  BuiltInStarterSprintTemplate,
  StarterSprintCapabilitySlot,
} from "@/lib/orchestration/starter-sprint-templates";
import { shouldAutoApproveNewHiresForCompanyId } from "@/lib/orchestration/hiring-governance-settings";
import type {
  AgentRosterState,
  ApprovalStatus,
  OrchestrationAgent,
  OrchestrationTemplateDraftPlan,
  OrchestrationTemplateDraftPlanCapabilitySlot,
} from "@/lib/orchestration/types";

export type TemplateCrewRecommendationLane = "required" | "useful" | "later";

type CrewAgentRow = {
  id: string;
  name: string;
  role: string;
  status: OrchestrationAgent["status"];
  archived_at: string | null;
  personality: string | null;
  skills_json: string | null;
  hire_approval_id: string | null;
  hire_approval_status: ApprovalStatus | null;
};

type PendingHireApprovalRow = {
  id: string;
  status: ApprovalStatus;
  agent_id: string | null;
  agent_status: OrchestrationAgent["status"] | null;
};

const MATCH_STOPWORDS = new Set([
  "agent",
  "coordinator",
  "engineer",
  "lead",
  "reviewer",
  "specialist",
]);

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function rosterStateFor(status: OrchestrationAgent["status"], archivedAt?: string | null): Exclude<AgentRosterState, "all"> {
  if (archivedAt) return "archived";
  if (status === "paused") return "paused";
  if (status === "offline" || status === "error") return "bench";
  return "active";
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function significantWords(value: string): string[] {
  return words(value).filter((word) => !MATCH_STOPWORDS.has(word));
}

function normalizedPhrase(value: string): string {
  return words(value).join(" ");
}

function agentSearchText(agent: CrewAgentRow): string {
  const skills = parseJsonArray(agent.skills_json).join(" ");
  return `${agent.name} ${agent.role} ${agent.personality ?? ""} ${skills}`;
}

function scoreAgentForSlot(agent: CrewAgentRow, slot: StarterSprintCapabilitySlot): number {
  const agentText = normalizedPhrase(agentSearchText(agent));
  const suggestedRole = normalizedPhrase(slot.suggestedRole);
  if (suggestedRole && agentText.includes(suggestedRole)) return 100;

  const roleWords = significantWords(slot.suggestedRole);
  if (roleWords.length > 0 && roleWords.every((word) => agentText.includes(word))) return 90;

  const slotWords = significantWords(`${slot.id} ${slot.label}`);
  if (slotWords.length === 0) return 0;
  const overlap = slotWords.filter((word) => agentText.includes(word)).length;
  if (overlap >= Math.max(2, slotWords.length)) return 70 + overlap;

  return 0;
}

function loadCrewAgents(db: Database.Database, companyId: string): CrewAgentRow[] {
  return db.prepare(
    `SELECT
       a.id,
       a.name,
       a.role,
       a.status,
       a.archived_at,
       a.personality,
       a.skills_json,
       hap.id AS hire_approval_id,
       hap.status AS hire_approval_status
     FROM agents a
     LEFT JOIN approvals hap
       ON hap.company_id = a.company_id
      AND hap.type = 'hire_agent'
      AND hap.status IN ('pending', 'revision_requested')
      AND json_extract(hap.payload_json, '$.agentId') = a.id
     WHERE a.company_id = ?
       AND a.archived_at IS NULL`,
  ).all(companyId) as CrewAgentRow[];
}

function agentReference(agent: CrewAgentRow): NonNullable<OrchestrationTemplateDraftPlanCapabilitySlot["matchedAgent"]> {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    rosterState: rosterStateFor(agent.status, agent.archived_at),
    ...(agent.hire_approval_id ? { hireApprovalId: agent.hire_approval_id } : {}),
    ...(agent.hire_approval_status ? { hireApprovalStatus: agent.hire_approval_status } : {}),
  };
}

function proposalForTemplateCrewSlot(input: {
  template: BuiltInStarterSprintTemplate;
  lane: TemplateCrewRecommendationLane;
  slot: StarterSprintCapabilitySlot;
}): NonNullable<OrchestrationTemplateDraftPlanCapabilitySlot["proposedAgent"]> {
  return {
    name: input.slot.suggestedRole,
    role: input.slot.suggestedRole,
    capabilities: `${input.slot.label}: ${input.slot.description}`,
    reason: `${input.template.name} recommends the ${input.lane} capability slot "${input.slot.label}".`,
    materialized: false,
  };
}

function findPendingHireForProposal(
  db: Database.Database,
  companyId: string,
  proposal: NonNullable<OrchestrationTemplateDraftPlanCapabilitySlot["proposedAgent"]>,
): PendingHireApprovalRow | null {
  const row = db.prepare(
    `SELECT
       hap.id,
       hap.status,
       json_extract(hap.payload_json, '$.agentId') AS agent_id,
       a.status AS agent_status
     FROM approvals hap
     LEFT JOIN agents a
       ON a.company_id = hap.company_id
      AND a.id = json_extract(hap.payload_json, '$.agentId')
     WHERE hap.company_id = ?
       AND hap.type = 'hire_agent'
       AND hap.status IN ('pending', 'revision_requested')
       AND LOWER(TRIM(json_extract(hap.payload_json, '$.name'))) = ?
       AND LOWER(TRIM(json_extract(hap.payload_json, '$.role'))) = ?
     LIMIT 1`,
  ).get(companyId, proposal.name.trim().toLowerCase(), proposal.role.trim().toLowerCase()) as PendingHireApprovalRow | undefined;
  return row ?? null;
}

function bestAgentForSlot(
  agents: CrewAgentRow[],
  slot: StarterSprintCapabilitySlot,
  rosterState: "active" | "bench",
): CrewAgentRow | null {
  const scored = agents
    .filter((agent) => rosterStateFor(agent.status, agent.archived_at) === rosterState)
    .map((agent) => ({ agent, score: scoreAgentForSlot(agent, slot) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name));
  return scored[0]?.agent ?? null;
}

function buildSlotRecommendation(input: {
  db: Database.Database;
  companyId: string;
  template: BuiltInStarterSprintTemplate;
  lane: TemplateCrewRecommendationLane;
  slot: StarterSprintCapabilitySlot;
  agents: CrewAgentRow[];
}): OrchestrationTemplateDraftPlanCapabilitySlot {
  const activeAgent = bestAgentForSlot(input.agents, input.slot, "active");
  if (activeAgent) {
    return {
      ...input.slot,
      lane: input.lane,
      coverageStatus: "covered_by_active",
      matchedAgent: agentReference(activeAgent),
    };
  }

  const benchAgent = bestAgentForSlot(input.agents, input.slot, "bench");
  if (benchAgent) {
    return {
      ...input.slot,
      lane: input.lane,
      coverageStatus: "covered_by_bench",
      matchedAgent: agentReference(benchAgent),
    };
  }

  const proposal = proposalForTemplateCrewSlot({
    template: input.template,
    lane: input.lane,
    slot: input.slot,
  });
  const pending = findPendingHireForProposal(input.db, input.companyId, proposal);
  if (pending) {
    return {
      ...input.slot,
      lane: input.lane,
      coverageStatus: "pending_approval",
      proposedAgent: {
        ...proposal,
        materialized: true,
        approvalRequired: true,
        approvalId: pending.id,
        ...(pending.agent_id ? { agentId: pending.agent_id } : {}),
        ...(pending.agent_status ? { status: pending.agent_status } : {}),
      },
    };
  }

  return {
    ...input.slot,
    lane: input.lane,
    coverageStatus: "proposed_new_agent",
    proposedAgent: proposal,
  };
}

function recommendationCounts(
  slots: OrchestrationTemplateDraftPlanCapabilitySlot[],
): Pick<OrchestrationTemplateDraftPlan["crewRecommendation"], "materializedNewAgentCount" | "approvalRequiredNewAgentCount"> {
  return {
    materializedNewAgentCount: slots.filter((slot) => slot.coverageStatus === "auto_approved_new_agent").length,
    approvalRequiredNewAgentCount: slots.filter((slot) => slot.coverageStatus === "pending_approval").length,
  };
}

export function buildTemplateCrewRecommendation(input: {
  db: Database.Database;
  companyId: string;
  template: BuiltInStarterSprintTemplate;
}): OrchestrationTemplateDraftPlan["crewRecommendation"] {
  const agents = loadCrewAgents(input.db, input.companyId);
  const recommendation = input.template.draftOutputs.activeCrewRecommendation;
  const buildLane = (lane: TemplateCrewRecommendationLane, slotIds: readonly string[]) => {
    const slots = input.template.capabilitySlots[lane];
    return slotIds
      .map((slotId) => slots.find((slot) => slot.id === slotId))
      .filter((slot): slot is StarterSprintCapabilitySlot => Boolean(slot))
      .map((slot) => buildSlotRecommendation({
        db: input.db,
        companyId: input.companyId,
        template: input.template,
        lane,
        slot,
        agents,
      }));
  };

  const required = buildLane("required", recommendation.requiredCapabilitySlotIds);
  const useful = buildLane("useful", recommendation.usefulCapabilitySlotIds);
  const later = buildLane("later", recommendation.laterCapabilitySlotIds);
  const counts = recommendationCounts([...required, ...useful, ...later]);

  return {
    summary: recommendation.summary,
    autoApproveNewHires: shouldAutoApproveNewHiresForCompanyId(input.db, input.companyId),
    ...counts,
    required,
    useful,
    later,
  };
}

export function summarizeTemplateCrewRecommendation(
  recommendation: OrchestrationTemplateDraftPlan["crewRecommendation"],
): Pick<OrchestrationTemplateDraftPlan["crewRecommendation"], "materializedNewAgentCount" | "approvalRequiredNewAgentCount"> {
  return recommendationCounts([
    ...recommendation.required,
    ...recommendation.useful,
    ...recommendation.later,
  ]);
}
