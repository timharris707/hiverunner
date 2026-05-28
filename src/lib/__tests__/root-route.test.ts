import assert from "node:assert/strict";

import { resolveRootRouteBehavior, selectDefaultCompanyCode } from "@/lib/root-route";

type TestCase = {
  name: string;
  env: NodeJS.ProcessEnv;
  state?: Parameters<typeof resolveRootRouteBehavior>[1];
  expected: ReturnType<typeof resolveRootRouteBehavior>;
};

const cases: TestCase[] = [
  {
    name: "default local install redirects root to onboarding when no durable workspace exists",
    env: {},
    expected: { kind: "redirect", destination: "/companies/new" },
  },
  {
    name: "explicit local-single-user redirects root to onboarding when no durable workspace exists",
    env: { MC_AUTH_MODE: "local-single-user" },
    expected: { kind: "redirect", destination: "/companies/new" },
  },
  {
    name: "invalid auth mode stays local-first and redirects root to onboarding",
    env: { MC_AUTH_MODE: "unexpected" },
    expected: { kind: "redirect", destination: "/companies/new" },
  },
  {
    name: "completed local install redirects root to selected company task board",
    env: {},
    state: { hasCompletedOnboarding: true, defaultCompanyCode: "HIVE" },
    expected: { kind: "redirect", destination: "/HIVE/tasks?view=board&group=status" },
  },
  {
    name: "completed local install falls back to login if company code cannot be resolved",
    env: {},
    state: { hasCompletedOnboarding: true, defaultCompanyCode: null },
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
    resolveRootRouteBehavior(testCase.env, testCase.state),
    testCase.expected,
    testCase.name,
  );
}

assert.equal(selectDefaultCompanyCode(["NEV", "INS"]), "INS");
assert.equal(selectDefaultCompanyCode(["HIVE", "INS"]), "HIVE");
assert.equal(selectDefaultCompanyCode(["NEV", "ABC"], { MC_DEFAULT_COMPANY_CODE: "ABC" }), "ABC");

console.log(`PASS root-route (${cases.length + 3} cases)`);
