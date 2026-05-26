import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiverunner-secrets-"));
process.env.MC_DATA_DIR = tempDir;
process.env.HIVERUNNER_DISABLE_KEYCHAIN_HELPER = "1";

async function run() {
  const {
    clearSecretCache,
    getSecret,
    getSecretSource,
    setSecret,
  } = await import("@/lib/secrets");

  try {
    setSecret("OPENAI_API_KEY", "sk-test-local-file");
    clearSecretCache("OPENAI_API_KEY");

    assert.equal(getSecret("OPENAI_API_KEY"), "sk-test-local-file");
    assert.equal(getSecretSource("OPENAI_API_KEY"), "local-file");

    const secretsFile = path.join(tempDir, "secrets", "local-secrets.json");
    assert.equal(fs.existsSync(secretsFile), true);
    assert.doesNotMatch(fs.readFileSync(secretsFile, "utf8"), /GEMINI_API_KEY/);

    console.log("Local file secret store test passed");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
