import { redirect } from "next/navigation";

import PublicHomepage from "@/components/marketing/PublicHomepage";
import { getAuthMode } from "@/lib/auth/auth-mode";
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

  try {
    const { companies } = listCompanies({ includeNonProduction: true });
    const completedCompanies = companies.filter((company) => {
      const code = (company.code || company.slug).toUpperCase();
      return code !== "HIVE" || company.stats.agents > 0;
    });
    const companyCodes = completedCompanies.map((company) => company.code || company.slug);
    return {
      hasCompletedOnboarding: completedCompanies.length > 0,
      defaultCompanyCode: selectDefaultCompanyCode(companyCodes),
    };
  } catch (error) {
    console.error("[root-route] failed to resolve local onboarding state", error);
    return { hasCompletedOnboarding: false };
  }
}

export default function HomePage() {
  const rootBehavior = resolveRootRouteBehavior(process.env, resolveLocalRootState());

  if (rootBehavior.kind === "redirect") {
    redirect(rootBehavior.destination);
  }

  return <PublicHomepage />;
}
