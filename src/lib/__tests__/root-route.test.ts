import assert from "node:assert/strict";

import { resolveRootRouteBehavior } from "@/lib/root-route";

type TestCase = {
  name: string;
  env: NodeJS.ProcessEnv;
  expected: ReturnType<typeof resolveRootRouteBehavior>;
};

const cases: TestCase[] = [
  {
    name: "default local install redirects root to login",
    env: {},
    expected: { kind: "redirect", destination: "/login" },
  },
  {
    name: "explicit local-single-user redirects root to login",
    env: { MC_AUTH_MODE: "local-single-user" },
    expected: { kind: "redirect", destination: "/login" },
  },
  {
    name: "invalid auth mode stays local-first and redirects root to login",
    env: { MC_AUTH_MODE: "unexpected" },
    expected: { kind: "redirect", destination: "/login" },
  },
  {
    name: "hosted Supabase mode keeps root marketing page",
    env: { MC_AUTH_MODE: "supabase" },
    expected: { kind: "marketing" },
  },
];

for (const testCase of cases) {
  assert.deepEqual(
    resolveRootRouteBehavior(testCase.env),
    testCase.expected,
    testCase.name,
  );
}

console.log(`PASS root-route (${cases.length} cases)`);
