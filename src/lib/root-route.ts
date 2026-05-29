import { getAuthMode } from "@/lib/auth/auth-mode";

export type RootRouteBehavior =
  | { kind: "redirect"; destination: string }
  | { kind: "marketing" };

export type LocalRootState = {
  /** A real workspace/company exists (derived from durable orchestration state). */
  hasWorkspace?: boolean;
  /** The one-time software setup wizard (`/setup`) has been completed. */
  hasCompletedSoftwareSetup?: boolean;
  defaultCompanyCode?: string | null;
};

// First-run software setup is a distinct, lightweight wizard — separate from
// creating a workspace. A fresh local install lands here.
const LOCAL_SOFTWARE_SETUP_ENTRY = "/setup";
// After setup is complete but no workspace exists yet, send the operator to the
// explicit company/workspace wizard so they can create one when ready.
const LOCAL_CREATE_WORKSPACE_ENTRY = "/companies/new";

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
    // Treat an existing workspace as proof that software setup has happened, so
    // upgraded installs are never bounced back through the first-run wizard.
    const setupComplete = Boolean(localState.hasCompletedSoftwareSetup) || Boolean(localState.hasWorkspace);

    if (!setupComplete) {
      return { kind: "redirect", destination: LOCAL_SOFTWARE_SETUP_ENTRY };
    }

    if (localState.defaultCompanyCode) {
      return { kind: "redirect", destination: rootTasksDestination(localState.defaultCompanyCode) };
    }

    // Setup is done but no workspace exists yet (e.g. the operator skipped
    // workspace creation). Point at the explicit company wizard rather than
    // looping back to software setup.
    return { kind: "redirect", destination: LOCAL_CREATE_WORKSPACE_ENTRY };
  }

  return { kind: "marketing" };
}
