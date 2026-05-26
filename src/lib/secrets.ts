import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { resolveOpenClawWorkspaceRoot } from "@/lib/workspaces/root";

export type SecretSource = "environment" | "keychain" | "managed-secret-store";

export type SecretScope = {
  companyId?: string;
  projectId?: string;
  runtimeId?: string;
  agentId?: string;
};

export type SecretWriteInput = {
  name: string;
  value: string;
  scope?: SecretScope;
};

export interface SecretStoreAdapter {
  id: "local-dev" | "managed";
  get(secretName: string, scope?: SecretScope): string | null;
  source(secretName: string, scope?: SecretScope): SecretSource | null;
  set(input: SecretWriteInput): void;
  clearCache(secretName?: string): void;
}

const cache = new Map<string, string | null>();

function candidateKeychainHelperPaths(): string[] {
  const cwd = process.cwd();
  const workspace = process.env.OPENCLAW_WORKSPACE;

  const candidates = [
    workspace ? path.resolve(workspace, "scripts/keychain.sh") : null,
    path.resolve(resolveOpenClawWorkspaceRoot(), "scripts/keychain.sh"),
    path.resolve(cwd, "../../scripts/keychain.sh"),
    path.resolve(cwd, "../scripts/keychain.sh"),
    path.resolve(cwd, "scripts/keychain.sh"),
  ].filter(Boolean) as string[];

  return [...new Set(candidates)];
}

function findKeychainHelperPath(): string | null {
  return candidateKeychainHelperPaths().find((helperPath) => fs.existsSync(helperPath)) ?? null;
}

function readFromWorkspaceKeychain(secretName: string): string | null {
  for (const helperPath of candidateKeychainHelperPaths()) {
    if (!fs.existsSync(helperPath)) continue;
    try {
      const value = execFileSync("bash", [helperPath, "get", secretName], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (value) return value;
    } catch {
      // try next candidate
    }
  }

  return null;
}

const localSecretStore: SecretStoreAdapter = {
  id: "local-dev",
  get(secretName: string): string | null {
    if (cache.has(secretName)) {
      return cache.get(secretName) ?? null;
    }

    const envValue = process.env[secretName]?.trim();
    if (envValue) {
      cache.set(secretName, envValue);
      return envValue;
    }

    const keychainValue = readFromWorkspaceKeychain(secretName);
    cache.set(secretName, keychainValue);
    return keychainValue;
  },
  source(secretName: string): SecretSource | null {
    const envValue = process.env[secretName]?.trim();
    if (envValue) return "environment";
    return readFromWorkspaceKeychain(secretName) ? "keychain" : null;
  },
  set(input: SecretWriteInput): void {
    const trimmedName = input.name.trim();
    const trimmedValue = input.value.trim();
    if (!trimmedName) {
      throw new Error("Secret name is required");
    }
    if (!trimmedValue) {
      throw new Error("Secret value is required");
    }

    const helperPath = findKeychainHelperPath();
    if (!helperPath) {
      throw new Error("Local keychain helper was not found");
    }

    execFileSync("bash", [helperPath, "set", trimmedName, trimmedValue], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
    });
    cache.set(trimmedName, trimmedValue);
  },
  clearCache(secretName?: string): void {
    if (secretName) {
      cache.delete(secretName);
      return;
    }
    cache.clear();
  },
};

let activeSecretStore: SecretStoreAdapter = localSecretStore;

export function getSecretStore(): SecretStoreAdapter {
  return activeSecretStore;
}

export function setSecretStoreForTests(store: SecretStoreAdapter): void {
  activeSecretStore = store;
}

export function resetSecretStoreForTests(): void {
  activeSecretStore = localSecretStore;
}

export function getSecret(secretName: string, scope?: SecretScope): string | null {
  return activeSecretStore.get(secretName, scope);
}

export function hasSecret(secretName: string, scope?: SecretScope): boolean {
  return Boolean(getSecret(secretName, scope));
}

export function getSecretSource(secretName: string, scope?: SecretScope): SecretSource | null {
  return activeSecretStore.source(secretName, scope);
}

export function setSecret(secretName: string, value: string, scope?: SecretScope): void {
  activeSecretStore.set({ name: secretName, value, scope });
}

export function clearSecretCache(secretName?: string): void {
  activeSecretStore.clearCache(secretName);
}
