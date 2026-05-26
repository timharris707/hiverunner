import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_HEAP_MB = "12288";
const heapMb = process.env.HIVERUNNER_BUILD_HEAP_MB || DEFAULT_HEAP_MB;

if (!/^[1-9][0-9]*$/.test(heapMb)) {
  console.error(`[build] HIVERUNNER_BUILD_HEAP_MB must be a positive integer, got ${JSON.stringify(heapMb)}`);
  process.exit(1);
}

const nextBin = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

if (!existsSync(nextBin)) {
  console.error("[build] Next.js build binary not found. Run npm install or npm ci first.");
  process.exit(1);
}

console.log(`[build] Using Node heap ${heapMb}MB for Next.js production compile`);

const result = spawnSync(
  process.execPath,
  [`--max-old-space-size=${heapMb}`, nextBin, "build", "--webpack", "--experimental-build-mode", "compile", ...process.argv.slice(2)],
  {
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || "1",
    },
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`[build] Failed to start Next.js build: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) {
  console.error(`[build] Next.js build terminated by signal ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
