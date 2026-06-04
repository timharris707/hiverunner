type EnvSnapshot = Record<string, string | undefined>;

export function setTestNodeEnv(value: string) {
  Object.defineProperty(process.env, "NODE_ENV", {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

export function snapshotEnv(names: readonly string[]): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  for (const name of names) {
    snapshot[name] = process.env[name];
  }
  return snapshot;
}

export function restoreEnvVar(name: string, value: string | undefined) {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
    return;
  }

  if (name === "NODE_ENV") {
    setTestNodeEnv(value);
    return;
  }

  process.env[name] = value;
}

export function restoreEnvSnapshot(snapshot: EnvSnapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    restoreEnvVar(name, value);
  }
}
