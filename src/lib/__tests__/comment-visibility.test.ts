import assert from "node:assert/strict";

import { isOperationalStatusComment, isOperatorFacingComment } from "@/lib/orchestration/comment-visibility";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  [pass] ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  [fail] ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("\nComment Visibility Tests\n");

test("hides mission-control execution telemetry from operator comments", () => {
  assert.equal(
    isOperationalStatusComment({
      source: "mission_control",
      type: "status_update",
      text: [
        "Codex execution completed.",
        "",
        "Command: codex exec --json --full-auto --model gpt-5.4",
        "Workspace: /Users/timharris/.mission-control/dev/workspaces/company/agents/mira",
        "",
        "Stdout:",
        "```mc-action",
        "{\"action\":\"add_comment\",\"taskKey\":\"NEV-46\",\"body\":\"Route this to research.\"}",
        "```",
      ].join("\n"),
    }),
    true,
  );
});

test("hides reviewer routing status from operator comments", () => {
  assert.equal(
    isOperationalStatusComment({
      source: "codex",
      type: "status_update",
      text: "Sending back. The draft misses the requested date window: item 4 is dated April 27, 2026, but the task scope is April 28, 2026 through May 5, 2026. Replace it with a verified AI news item inside the window and resubmit the full five-item set.",
    }),
    true,
  );
});

test("hides agent-to-agent clarification markers from operator comments", () => {
  assert.equal(
    isOperationalStatusComment({
      source: "codex",
      type: "comment",
      text: "[AWAITING_CLARIFICATION] Shamba, the latest resubmission is still truncated in my review context, so I cannot verify all five items end-to-end.",
    }),
    true,
  );
});

test("hides link verification notices from operator comments", () => {
  assert.equal(
    isOperationalStatusComment({
      source: "anthropic",
      type: "comment",
      text: [
        "**Link verification failed**",
        "",
        "HiveRunner found broken or unverifiable external links in the agent draft, so it withheld the sourced reply instead of posting bad URLs.",
        "",
        "The agent needs to research again and provide links that open successfully.",
        "",
        "Unverified links:",
        "- `https://example.com/missing` (HTTP 404)",
      ].join("\n"),
    }),
    true,
  );
});

test("keeps polished long comments visible", () => {
  assert.equal(
    isOperatorFacingComment({
      source: "anthropic",
      type: "comment",
      text: "## Research Summary\n\nThis is a polished operator-facing response with enough detail to be useful. It is not runtime telemetry, command output, or an execution transcript.",
    }),
    true,
  );
});

test("keeps voice session receipts and voice-authored messages visible", () => {
  assert.equal(
    isOperatorFacingComment({
      source: "voice",
      type: "comment",
      text: "Voice session recorded\nTask: NEV-45",
    }),
    true,
  );
  assert.equal(
    isOperatorFacingComment({
      source: "voice",
      type: "comment",
      text: "Confirmed system is operational. Proceeding with the request.",
    }),
    true,
  );
});

test("keeps circuit breaker blockers visible to the operator", () => {
  assert.equal(
    isOperatorFacingComment({
      source: "engine",
      type: "blocker",
      text: "[AWAITING_HUMAN] Circuit breaker tripped: repeated no-op wakeups.",
    }),
    true,
  );
});

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}

console.log(`\n${passed} passed`);
