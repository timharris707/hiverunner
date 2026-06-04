type TestFunction = () => Promise<void> | void;

type TestRunnerOptions = {
  passLabel?: string;
  failLabel?: string;
  errorStackLines?: number;
};

type FinishOptions = {
  summaryIndent?: string;
};

export function createTestRunner(options: TestRunnerOptions = {}) {
  const passLabel = options.passLabel ?? "PASS";
  const failLabel = options.failLabel ?? "FAIL";
  const errorStackLines = options.errorStackLines ?? 0;
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: TestFunction): Promise<void> {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        passed += 1;
        console.log(`  ${passLabel} ${name}`);
      })
      .catch((error: unknown) => {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  ${failLabel} ${name}`);
        console.error(`    ${message}`);
        if (errorStackLines > 0 && error instanceof Error && error.stack) {
          console.error(error.stack.split("\n").slice(1, 1 + errorStackLines).join("\n"));
        }
      });
  }

  function finish(finishOptions: FinishOptions = {}): never {
    const summaryIndent = finishOptions.summaryIndent ?? "";
    console.log(`\n${summaryIndent}${passed} passed, ${failed} failed\n`);
    process.exit(failed === 0 ? 0 : 1);
  }

  return { finish, test };
}
