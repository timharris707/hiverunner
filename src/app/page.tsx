import { redirect } from "next/navigation";

import PublicHomepage from "@/components/marketing/PublicHomepage";
import { getAuthMode } from "@/lib/auth/auth-mode";
import { isSoftwareSetupComplete, readOnboardingState } from "@/lib/onboarding/onboarding-state";
import { listCompanies } from "@/lib/orchestration/company-service";
import { resolveLocalRootStateFromWorkspaces, resolveRootRouteBehavior } from "@/lib/root-route";

export const dynamic = "force-dynamic";

export default function HomePage() {
  if (getAuthMode() === "local-single-user") {
    const behavior = resolveRootRouteBehavior(process.env, resolveLocalRootState());
    if (behavior.kind === "redirect") {
      redirect(behavior.destination);
    }
  }

  return <PublicHomepage />;
}

function resolveLocalRootState() {
  let hasCompletedSoftwareSetup = false;
  try {
    hasCompletedSoftwareSetup = isSoftwareSetupComplete(readOnboardingState());
  } catch {
    hasCompletedSoftwareSetup = false;
  }

  try {
    const { companies } = listCompanies({ includeNonProduction: true });
    return resolveLocalRootStateFromWorkspaces({
      hasCompletedSoftwareSetup,
      workspaces: companies.map((company) => ({
        code: company.code || company.slug,
        slug: company.slug,
        stats: company.stats,
      })),
    });
  } catch {
    return resolveLocalRootStateFromWorkspaces({
      hasCompletedSoftwareSetup,
      workspaces: [],
    });
  }
}
