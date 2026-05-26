import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const scripts = Object.keys(packageJson.scripts ?? {}).filter((name) =>
  name.startsWith("test:orchestration:"),
);
const testFilter = (process.env.ORCHESTRATION_TEST_FILTER ?? "").trim();
const allowedScripts = testFilter
  ? new Set(
      testFilter
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    )
  : null;

const selectedScripts = allowedScripts
  ? scripts.filter((name) =>
      [...allowedScripts].some((filterName) => name === filterName || name.includes(filterName)),
    )
  : scripts;

if (selectedScripts.length === 0) {
  console.error("No test:orchestration:* scripts found in package.json.");
  process.exit(1);
}

const failures = [];

for (const script of selectedScripts) {
  console.log(`\n==> ${script}`);
  const exitCode = await runScript(script);

  if (exitCode === 0) {
    console.log(`PASS ${script}`);
  } else {
    failures.push({ script, exitCode });
    console.error(`FAIL ${script} (exit ${exitCode})`);
  }
}

if (failures.length > 0) {
  console.error("\nOrchestration test failures:");
  for (const failure of failures) {
    console.error(`- ${failure.script} (exit ${failure.exitCode})`);
  }
  process.exit(1);
}

const filterSuffix = allowedScripts ? ` selected by ORCHESTRATION_TEST_FILTER from ${scripts.length} total` : "";
console.log(
  `\nAll ${selectedScripts.length}${filterSuffix} orchestration test script${
    selectedScripts.length === 1 ? "" : "s"
  } completed.`,
);

function runScript(script) {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", "--silent", script], {
      cwd: new URL("..", import.meta.url),
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    child.on("error", (error) => {
      console.error(`Failed to start ${script}: ${error.message}`);
      resolve(1);
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        console.error(`${script} terminated by signal ${signal}`);
        resolve(1);
        return;
      }

      resolve(code ?? 1);
    });
  });
}
