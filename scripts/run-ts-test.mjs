#!/usr/bin/env node
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const [, , testFile, ...extraArgs] = process.argv;

if (!testFile) {
  console.error("Usage: node ./scripts/run-ts-test.mjs <test-file> [test args]");
  process.exit(1);
}

const cwd = process.cwd();
const resolvedTestFile = path.resolve(cwd, testFile);
await import("./register-ts-test-hooks.mjs");

const runnerRequire = createRequire(pathToFileURL(resolvedTestFile).href);
process.argv = [process.execPath, resolvedTestFile, ...extraArgs];

try {
  runnerRequire(resolvedTestFile);
} catch (error) {
  console.error(`Failed to run ${testFile}: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
}
