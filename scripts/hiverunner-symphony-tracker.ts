#!/usr/bin/env tsx
import { closeOrchestrationDb } from "@/lib/orchestration/db";
import { handleHiveRunnerSymphonyTrackerRequest } from "@/lib/orchestration/symphony/tracker-shim";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      body += chunk;
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(body));
  });
}

async function main(): Promise<void> {
  const input = await readStdin();
  const request = input.trim() ? JSON.parse(input) : { operation: "health" };
  const response = handleHiveRunnerSymphonyTrackerRequest(request);
  process.stdout.write(`${JSON.stringify(response)}\n`);
  if (!response.ok) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error && error.message ? error.message : String(error);
    process.stdout.write(JSON.stringify({
      ok: false,
      error: {
        code: "tracker_shim_fatal",
        message,
      },
    }) + "\n");
    process.exitCode = 1;
  })
  .finally(() => {
    closeOrchestrationDb();
  });
