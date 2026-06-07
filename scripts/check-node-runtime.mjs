#!/usr/bin/env node
const requiredMajor = "22";
const currentMajor = process.versions.node.split(".")[0];

if (currentMajor === requiredMajor) {
  process.exit(0);
}

console.error("");
console.error("HiveRunner requires Node.js 22.x for install and local runtime commands.");
console.error("");
console.error(`Current Node: ${process.version}`);
console.error(`Current binary: ${process.execPath}`);
console.error("");
console.error("Why this matters:");
console.error("- HiveRunner uses native SQLite bindings.");
console.error("- Installing or running with a different Node major compiles/loads the wrong ABI.");
console.error("- That causes the recurring better-sqlite3 NODE_MODULE_VERSION error.");
console.error("");
console.error("Fix:");
console.error("- Switch to Node 22 before installing or running HiveRunner.");
console.error("- With fnm: fnm use 22");
console.error("- Or set HIVERUNNER_NODE_BIN=/absolute/path/to/node22 for managed scripts.");
console.error("");
process.exit(1);
