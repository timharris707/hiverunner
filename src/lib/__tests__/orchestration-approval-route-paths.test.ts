import assert from "node:assert";

import { buildApprovalDetailPath } from "@/lib/orchestration/route-paths";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error: unknown) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  FAIL ${name}`);
    console.error(`    ${message}`);
  }
}

console.log("\nOrchestration Approval Route Path Tests\n");

test("approval detail links use the approval UUID when a task key is also present", () => {
  const path = buildApprovalDetailPath({
    companyCode: "INS",
    companySlug: "insight",
    approvalId: "approval-uuid-123",
    linkedTaskKey: "INS-1",
  });

  assert.strictEqual(path, "/INS/approvals/approval-uuid-123");
});

test("legacy company slug links also use the approval UUID", () => {
  const path = buildApprovalDetailPath({
    companySlug: "insight",
    approvalId: "approval-uuid-456",
    linkedTaskKey: "INS-1",
  });

  assert.strictEqual(path, "/companies/insight/approvals/approval-uuid-456");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
