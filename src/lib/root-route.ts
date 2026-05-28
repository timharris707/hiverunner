import { getAuthMode } from "@/lib/auth/auth-mode";

export type RootRouteBehavior =
  | { kind: "redirect"; destination: "/login" }
  | { kind: "marketing" };

export function resolveRootRouteBehavior(env: NodeJS.ProcessEnv = process.env): RootRouteBehavior {
  if (getAuthMode(env) === "local-single-user") {
    return { kind: "redirect", destination: "/login" };
  }

  return { kind: "marketing" };
}
