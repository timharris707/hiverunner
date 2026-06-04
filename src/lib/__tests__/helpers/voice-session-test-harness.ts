type TestFunction = () => Promise<void> | void;

export function createVoiceSessionTestRunner() {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: TestFunction) {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        passed += 1;
        console.log(`  ✓ ${name}`);
      })
      .catch((error: unknown) => {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  ✗ ${name}`);
        console.error(`    ${message}`);
      });
  }

  function finish() {
    const total = passed + failed;
    console.log(`\nResult: ${passed}/${total} passed`);
    if (failed > 0) process.exitCode = 1;
  }

  return { finish, test };
}

export function makeVoiceSessionRequest(body?: unknown) {
  return new Request("http://localhost/api/voice/session", {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function restoreEnvVar(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
