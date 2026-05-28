import { getAuthMode } from "@/lib/auth/auth-mode";

export type RootRouteBehavior =
  | { kind: "redirect"; destination: string }
  | { kind: "marketing" };

export type LocalRootState = {
  hasCompletedOnboarding?: boolean;
  defaultCompanyCode?: string | null;
};

const LOCAL_ONBOARDING_ENTRY = "/companies/new";
const LOCAL_APP_ENTRY_FALLBACK = "/login";

export function rootTasksDestination(companyCode: string): string {
  return `/${encodeURIComponent(companyCode)}/tasks?view=board&group=status`;
}

export function selectDefaultCompanyCode(
  companyCodes: Array<string | null | undefined>,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const codes = companyCodes.map((code) => code?.trim()).filter((code): code is string => Boolean(code));
  const byUppercase = new Map(codes.map((code) => [code.toUpperCase(), code]));
  const explicit = env.MC_DEFAULT_COMPANY_CODE?.trim();

  if (explicit) {
    const configured = byUppercase.get(explicit.toUpperCase());
    if (configured) return configured;
  }

  for (const preferred of ["HIVE", "INS"]) {
    const match = byUppercase.get(preferred);
    if (match) return match;
  }

  return codes[0] ?? null;
}

export function resolveRootRouteBehavior(
  env: NodeJS.ProcessEnv = process.env,
  localState: LocalRootState = {},
): RootRouteBehavior {
  if (getAuthMode(env) === "local-single-user") {
    if (!localState.hasCompletedOnboarding) {
      return { kind: "redirect", destination: LOCAL_ONBOARDING_ENTRY };
    }

    if (localState.defaultCompanyCode) {
      return { kind: "redirect", destination: rootTasksDestination(localState.defaultCompanyCode) };
    }

    return { kind: "redirect", destination: LOCAL_APP_ENTRY_FALLBACK };
  }

  return { kind: "marketing" };
}
