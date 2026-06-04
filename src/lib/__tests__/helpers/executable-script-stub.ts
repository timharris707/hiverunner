import { chmodSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type ExecutableScriptStubOptions = {
  prefix: string;
  script: string;
  extension?: string;
};

export function createExecutableScriptStub(options: ExecutableScriptStubOptions): string {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const extension = options.extension ?? "sh";
  const filePath = path.join(os.tmpdir(), `${options.prefix}-${suffix}.${extension}`);

  writeFileSync(filePath, options.script, "utf8");
  chmodSync(filePath, 0o755);

  return filePath;
}
