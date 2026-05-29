import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const defaultSkillsFile = path.join(process.cwd(), "src", "lib", "orchestration", "default-skills.ts");
const defaultSkillsSource = readFileSync(defaultSkillsFile, "utf8");

assert.match(defaultSkillsSource, /slug: "hiverunner-orchestration-overseer"/);
assert.match(defaultSkillsSource, /stale runners/i);
assert.match(defaultSkillsSource, /scope drift/i);
assert.match(defaultSkillsSource, /observer lanes/i);

const skillFile = path.join(process.cwd(), ".agents", "skills", "hiverunner-orchestration-overseer", "SKILL.md");
assert.ok(existsSync(skillFile), "Overseer skill file should exist at the canonical local skill path");

const skillFileBody = readFileSync(skillFile, "utf8");
assert.match(skillFileBody, /HiveRunner Orchestration Overseer/);
assert.match(skillFileBody, /stale runners/i);

for (const forbidden of ["Harris Autonomous", "Paperclip", "NeverIdle", "/Users/timharris"]) {
  assert.equal(defaultSkillsSource.includes(forbidden), false, `Default skill should not mention ${forbidden}`);
  assert.equal(skillFileBody.includes(forbidden), false, `Skill file should not mention ${forbidden}`);
}

console.log("PASS default-overseer-skill");
