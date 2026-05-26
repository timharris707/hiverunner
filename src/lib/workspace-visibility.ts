const HIDDEN_OPERATOR_WORKSPACE_PATTERNS: ReadonlyArray<RegExp> = [
  /^workspace-oc-stress-/i,
  /^workspace-stress-agent-/i,
  /^workspace-(tmp|temp|test|generated)-/i,
];

export function isOperatorVisibleWorkspaceId(workspaceId: string): boolean {
  if (workspaceId === "workspace") {
    return true;
  }

  for (const pattern of HIDDEN_OPERATOR_WORKSPACE_PATTERNS) {
    if (pattern.test(workspaceId)) {
      return false;
    }
  }

  return true;
}

export function shouldIncludeWorkspaceInOperatorRails(input: {
  workspaceId: string;
  hasIdentityFile: boolean;
}): boolean {
  if (!isOperatorVisibleWorkspaceId(input.workspaceId)) {
    return false;
  }

  if (input.workspaceId.startsWith("workspace-")) {
    return input.hasIdentityFile;
  }

  return true;
}

