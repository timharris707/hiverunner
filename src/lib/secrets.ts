import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const cache = new Map<string, string | null>();

function candidateKeychainHelperPaths(): string[] {
  const cwd = process.cwd();
  const workspace = process.env.OPENCLAW_WORKSPACE;

  const candidates = [
    workspace ? path.resolve(workspace, "scripts/keychain.sh") : null,
    path.resolve(cwd, "../../scripts/keychain.sh"),
    path.resolve(cwd, "../scripts/keychain.sh"),
    path.resolve(cwd, "scripts/keychain.sh"),
  ].filter(Boolean) as string[];

  return [...new Set(candidates)];
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

export function getSecret(secretName: string): string | null {
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
}

export function hasSecret(secretName: string): boolean {
  return Boolean(getSecret(secretName));
}

export function clearSecretCache(secretName?: string): void {
  if (secretName) {
    cache.delete(secretName);
    return;
  }
  cache.clear();
}
