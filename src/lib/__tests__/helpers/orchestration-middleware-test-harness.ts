import assert from "node:assert/strict";
import { NextRequest } from "next/server";

type MiddlewareTestFunction = () => Promise<void> | void;

type MiddlewareTestRunnerOptions = {
  passLabel: string;
  failLabel: string;
};

export function createMiddlewareTestRunner(options: MiddlewareTestRunnerOptions) {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: MiddlewareTestFunction) {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        passed += 1;
        console.log(`  ${options.passLabel} ${name}`);
      })
      .catch((error: unknown) => {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  ${options.failLabel} ${name}`);
        console.error(`    ${message}`);
      });
  }

  function finish(): never {
    const total = passed + failed;
    console.log(`\nResult: ${passed}/${total} passed`);
    process.exit(failed > 0 ? 1 : 0);
  }

  return { finish, test };
}

export function createMiddlewareRequest(url: string, headers?: HeadersInit): NextRequest {
  return new NextRequest(url, headers === undefined ? undefined : { headers });
}

export async function rejectSupabaseSessionLookup(): Promise<never> {
  throw new Error("Supabase session lookup failed");
}

export async function assertUnauthorizedMiddlewareResponse(response: Response) {
  assert.equal(response.status, 401);

  const body = await response.json() as { error?: { code?: string; message?: string } };
  assert.equal(body.error?.code, "unauthorized");
}
