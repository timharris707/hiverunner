import type { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  materializeApprovedHireAgent,
} from "@/lib/orchestration/service/company-agent-provisioning";
import type { readSelectedStarterAgents } from "@/lib/orchestration/starter-team-templates";

type SelectedStarterAgent = ReturnType<typeof readSelectedStarterAgents>[number];
type StarterAgentProvisioner = typeof materializeApprovedHireAgent;

export type ProvisionedStarterAgent = {
  id: string;
  slug: string;
  name: string;
  role: string;
  projectId: string | null;
  runtimeProvider: "manual";
};

export type StarterTeamProvisioningWarning = {
  name: string;
  role: string;
  message: string;
};

export function provisionSelectedStarterAgentsForCreateFull(input: {
  selectedStarterAgents: SelectedStarterAgent[];
  companyId: string;
  requestedByAgentId: string;
  projectId: string;
  db: ReturnType<typeof getOrchestrationDb>;
  provisioner?: StarterAgentProvisioner;
}): { agents: ProvisionedStarterAgent[]; warnings: StarterTeamProvisioningWarning[] } {
  const provisioner = input.provisioner ?? materializeApprovedHireAgent;
  const agents: ProvisionedStarterAgent[] = [];
  const warnings: StarterTeamProvisioningWarning[] = [];

  for (const starterAgent of input.selectedStarterAgents) {
    try {
      const result = provisioner({
        approvalCompanyId: input.companyId,
        requestedByAgentId: input.requestedByAgentId,
        db: input.db,
        payload: {
          name: starterAgent.name,
          role: starterAgent.role,
          mission: starterAgent.mission,
          capabilities: starterAgent.capabilities,
          personality: starterAgent.personality ?? undefined,
          avatarUrl: starterAgent.avatarUrl ?? undefined,
          avatarStyleId: starterAgent.avatarStyleId ?? undefined,
          avatarGender: starterAgent.avatarGender ?? undefined,
          avatarAge: starterAgent.avatarAge ?? undefined,
          avatarHairColor: starterAgent.avatarHairColor ?? undefined,
          avatarHairLength: starterAgent.avatarHairLength ?? undefined,
          avatarEyeColor: starterAgent.avatarEyeColor ?? undefined,
          avatarVibe: starterAgent.avatarVibe ?? undefined,
          voiceId: starterAgent.voiceId ?? undefined,
          projectId: input.projectId,
          runtimeProvider: "manual",
          model: "",
          reason: "Starter team role selected during company setup.",
        },
      });
      agents.push({
        id: result.agentId,
        slug: result.agentSlug,
        name: starterAgent.name,
        role: starterAgent.role,
        projectId: result.projectId,
        runtimeProvider: "manual",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[create-full] starter-team provisioning skipped for "${starterAgent.name}": ${message}`);
      warnings.push({
        name: starterAgent.name,
        role: starterAgent.role,
        message,
      });
    }
  }

  return { agents, warnings };
}
