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
    name: "fresh local install redirects root to first-run software setup",
    env: {},
    expected: { kind: "redirect", destination: "/setup" },
  },
  {
    name: "explicit local-single-user with no setup/workspace redirects root to /setup",
    env: { MC_AUTH_MODE: "local-single-user" },
    expected: { kind: "redirect", destination: "/setup" },
  },
  {
    name: "invalid auth mode stays local-first and redirects root to /setup",
    env: { MC_AUTH_MODE: "unexpected" },
    expected: { kind: "redirect", destination: "/setup" },
  },
  {
    name: "an existing workspace is treated as setup-complete and routes to the task board",
    env: {},
    state: { hasWorkspace: true, defaultCompanyCode: "HIVE" },
    expected: { kind: "redirect", destination: "/HIVE/tasks?view=board&group=status" },
  },
  {
    name: "completed software setup without any workspace points at the explicit company wizard",
    env: {},
    state: { hasCompletedSoftwareSetup: true, defaultCompanyCode: null },
    expected: { kind: "redirect", destination: "/companies/new" },
  },
  {
    name: "completed software setup with a resolvable workspace routes to the task board",
    env: {},
    state: { hasCompletedSoftwareSetup: true, hasWorkspace: true, defaultCompanyCode: "INS" },
    expected: { kind: "redirect", destination: "/INS/tasks?view=board&group=status" },
  },
  {
    name: "software setup not completed and no workspace still goes to /setup even with a stray default code",
    env: {},
    state: { hasCompletedSoftwareSetup: false, hasWorkspace: false, defaultCompanyCode: "HIVE" },
    expected: { kind: "redirect", destination: "/setup" },
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
