import { redirect } from "next/navigation";

import PublicHomepage from "@/components/marketing/PublicHomepage";
import { getAuthMode } from "@/lib/auth/auth-mode";
import { isSoftwareSetupComplete, readOnboardingState } from "@/lib/onboarding/onboarding-state";
import { listCompanies } from "@/lib/orchestration/company-service";
import {
  resolveRootRouteBehavior,
  selectDefaultCompanyCode,
  type LocalRootState,
} from "@/lib/root-route";

export const dynamic = "force-dynamic";

function resolveLocalRootState(): LocalRootState {
  if (getAuthMode() !== "local-single-user") {
    return {};
  }

  // Software setup completion is durable, server-side state and is independent
  // of whether any workspace exists.
  let hasCompletedSoftwareSetup = false;
  try {
    hasCompletedSoftwareSetup = isSoftwareSetupComplete(readOnboardingState());
  } catch (error) {
    console.error("[root-route] failed to read onboarding state", error);
  }

  try {
    const { companies } = listCompanies({ includeNonProduction: true });
    const completedCompanies = companies.filter((company) => {
      const code = (company.code || company.slug).toUpperCase();
      return code !== "HIVE" || company.stats.agents > 0;
    });
    const companyCodes = completedCompanies.map((company) => company.code || company.slug);
    return {
      hasCompletedSoftwareSetup,
      hasWorkspace: completedCompanies.length > 0,
      defaultCompanyCode: selectDefaultCompanyCode(companyCodes),
    };
  } catch (error) {
    console.error("[root-route] failed to resolve local workspace state", error);
    return { hasCompletedSoftwareSetup, hasWorkspace: false };
  }
}

export default function HomePage() {
  const rootBehavior = resolveRootRouteBehavior(process.env, resolveLocalRootState());

  if (rootBehavior.kind === "redirect") {
    redirect(rootBehavior.destination);
  }

  return <PublicHomepage />;
}
