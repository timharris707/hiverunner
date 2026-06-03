import { getAuthMode } from "@/lib/auth/auth-mode";
import { isSoftwareSetupComplete, readOnboardingState } from "@/lib/onboarding/onboarding-state";
import { listCompanies } from "@/lib/orchestration/company-service";
import { countsAsCreatedLocalWorkspace, selectDefaultCompanyCode } from "@/lib/root-route";

import SetupWizard, { type SetupWorkspace } from "./SetupWizard";

export const dynamic = "force-dynamic";

type ResolvedSetupState = {
  workspaces: SetupWorkspace[];
  primary: SetupWorkspace | null;
  alreadyComplete: boolean;
};

function resolveSetupState(): ResolvedSetupState {
  let alreadyComplete = false;
  try {
    alreadyComplete = isSoftwareSetupComplete(readOnboardingState());
  } catch {
    alreadyComplete = false;
  }

  if (getAuthMode() !== "local-single-user") {
    return { workspaces: [], primary: null, alreadyComplete };
  }

  try {
    const { companies } = listCompanies({ includeNonProduction: true });
    const completed = companies.filter((company) => countsAsCreatedLocalWorkspace({
      code: company.code || company.slug,
      slug: company.slug,
      stats: company.stats,
    }));

    const workspaces: SetupWorkspace[] = completed.map((company) => ({
      code: company.code || company.slug,
      slug: company.slug,
      name: company.name || company.code || company.slug,
    }));

    const primaryCode = selectDefaultCompanyCode(workspaces.map((w) => w.code));
    const primary = workspaces.find((w) => w.code === primaryCode) ?? workspaces[0] ?? null;

    return { workspaces, primary, alreadyComplete };
  } catch {
    return { workspaces: [], primary: null, alreadyComplete };
  }
}

export default function SetupPage() {
  const { workspaces, primary, alreadyComplete } = resolveSetupState();

  return (
    <SetupWizard workspaces={workspaces} primary={primary} alreadyComplete={alreadyComplete} />
  );
}
