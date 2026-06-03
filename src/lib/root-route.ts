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

export type LocalRootWorkspaceSummary = {
  code?: string | null;
  slug?: string | null;
  stats?: {
    agents?: number | null;
  } | null;
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

function workspaceCode(workspace: LocalRootWorkspaceSummary): string | null {
  return workspace.code?.trim() || workspace.slug?.trim() || null;
}

export function countsAsCreatedLocalWorkspace(workspace: LocalRootWorkspaceSummary): boolean {
  const code = workspaceCode(workspace)?.toUpperCase();
  if (!code) return false;

  // The fresh local database bootstraps a neutral HIVE workspace so route maps
  // and local owner state exist. It is not the operator's created workspace
  // until at least one agent has been provisioned.
  if (code === "HIVE") {
    return Number(workspace.stats?.agents ?? 0) > 0;
  }

  return true;
}

export function resolveLocalRootStateFromWorkspaces(
  input: {
    hasCompletedSoftwareSetup?: boolean;
    workspaces: LocalRootWorkspaceSummary[];
  },
  env: NodeJS.ProcessEnv = process.env,
): LocalRootState {
  const createdWorkspaces = input.workspaces.filter(countsAsCreatedLocalWorkspace);
  return {
    hasCompletedSoftwareSetup: Boolean(input.hasCompletedSoftwareSetup),
    hasWorkspace: createdWorkspaces.length > 0,
    defaultCompanyCode: selectDefaultCompanyCode(createdWorkspaces.map(workspaceCode), env),
  };
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
