import type Database from "better-sqlite3";

import { createApproval } from "@/lib/orchestration/service/approval";
import {
  materializeApprovedHireAgent,
  stagePendingHireAgent,
} from "@/lib/orchestration/service/company-agent-provisioning";
import { shouldAutoApproveNewHiresForCompanyId } from "@/lib/orchestration/hiring-governance-settings";
import {
  summarizeTemplateCrewRecommendation,
  type TemplateCrewRecommendationLane,
} from "@/lib/orchestration/template-crew-recommendation";
import type {
  OrchestrationTemplateDraftPlan,
  OrchestrationTemplateDraftPlanCapabilitySlot,
} from "@/lib/orchestration/types";

function selectedLaneSet(lanes?: readonly TemplateCrewRecommendationLane[] | null): Set<TemplateCrewRecommendationLane> {
  return new Set(lanes && lanes.length > 0 ? lanes : ["required"]);
}

function hirePayload(input: {
  slot: OrchestrationTemplateDraftPlanCapabilitySlot;
  proposal: NonNullable<OrchestrationTemplateDraftPlanCapabilitySlot["proposedAgent"]>;
  draftPlan: OrchestrationTemplateDraftPlan;
}): Record<string, unknown> {
  return {
    name: input.proposal.name,
    agentName: input.proposal.name,
    role: input.proposal.role,
    capabilities: input.proposal.capabilities,
    reason: input.proposal.reason,
    source: "template_crew_recommendation",
    templateId: input.draftPlan.template.id,
    templateVersionId: input.draftPlan.template.templateVersionId,
    intakeAnswerId: input.draftPlan.intakeAnswer.id,
    draftId: input.draftPlan.draft.id,
    companyGoalId: input.draftPlan.draft.companyGoalId,
    capabilitySlotId: input.slot.id,
    capabilitySlotLane: input.slot.lane,
    capabilitySlotLabel: input.slot.label,
  };
}

function materializeSlot(input: {
  db: Database.Database;
  companyId: string;
  requestedByAgentId?: string | null;
  autoApproveNewHires: boolean;
  draftPlan: OrchestrationTemplateDraftPlan;
  slot: OrchestrationTemplateDraftPlanCapabilitySlot;
}): OrchestrationTemplateDraftPlanCapabilitySlot {
  const proposal = input.slot.proposedAgent;
  if (input.slot.coverageStatus !== "proposed_new_agent" || !proposal) return input.slot;

  const payload = hirePayload({
    slot: input.slot,
    proposal,
    draftPlan: input.draftPlan,
  });

  if (input.autoApproveNewHires) {
    const materialized = materializeApprovedHireAgent({
      approvalCompanyId: input.companyId,
      requestedByAgentId: input.requestedByAgentId ?? null,
      payload,
      db: input.db,
    });
    return {
      ...input.slot,
      coverageStatus: "auto_approved_new_agent",
      matchedAgent: {
        id: materialized.agentId,
        name: proposal.name,
        role: proposal.role,
        status: "idle",
        rosterState: "active",
      },
      proposedAgent: {
        ...proposal,
        materialized: true,
        agentId: materialized.agentId,
        status: "idle",
        approvalRequired: false,
      },
    };
  }

  const staged = stagePendingHireAgent({
    approvalCompanyId: input.companyId,
    requestedByAgentId: input.requestedByAgentId ?? null,
    payload,
    db: input.db,
  });
  const { approval } = createApproval({
    companyIdOrSlug: input.companyId,
    type: "hire_agent",
    requestedByAgentId: input.requestedByAgentId ?? undefined,
    payload: {
      ...payload,
      agentId: staged.agentId,
    },
    db: input.db,
  });

  return {
    ...input.slot,
    coverageStatus: "pending_approval",
    proposedAgent: {
      ...proposal,
      materialized: true,
      agentId: staged.agentId,
      approvalId: approval.id,
      status: "paused",
      approvalRequired: true,
    },
  };
}

export function materializeTemplateCrewRecommendationGaps(input: {
  db: Database.Database;
  companyId: string;
  requestedByAgentId?: string | null;
  draftPlan: OrchestrationTemplateDraftPlan;
  lanes?: readonly TemplateCrewRecommendationLane[] | null;
}): OrchestrationTemplateDraftPlan {
  const lanes = selectedLaneSet(input.lanes);
  const autoApproveNewHires = shouldAutoApproveNewHiresForCompanyId(input.db, input.companyId);
  const materializeLane = (slots: OrchestrationTemplateDraftPlanCapabilitySlot[]) => slots.map((slot) => {
    if (!lanes.has(slot.lane)) return slot;
    return materializeSlot({
      db: input.db,
      companyId: input.companyId,
      requestedByAgentId: input.requestedByAgentId,
      autoApproveNewHires,
      draftPlan: input.draftPlan,
      slot,
    });
  });

  const required = materializeLane(input.draftPlan.crewRecommendation.required);
  const useful = materializeLane(input.draftPlan.crewRecommendation.useful);
  const later = materializeLane(input.draftPlan.crewRecommendation.later);
  const counts = summarizeTemplateCrewRecommendation({
    ...input.draftPlan.crewRecommendation,
    required,
    useful,
    later,
  });

  return {
    ...input.draftPlan,
    crewRecommendation: {
      ...input.draftPlan.crewRecommendation,
      ...counts,
      autoApproveNewHires,
      required,
      useful,
      later,
    },
  };
}
