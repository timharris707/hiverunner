import assert from "assert";

import {
  extractExternalLinks,
  sanitizeAgentCommentLinks,
  shouldVerifyAgentCommentLinks,
  type LinkVerificationResult,
} from "@/lib/orchestration/comment-link-verification";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function fakeVerifier(results: Record<string, Partial<LinkVerificationResult>>) {
  return (url: string): LinkVerificationResult => ({
    url,
    ok: true,
    ...results[url],
  });
}

test("extractExternalLinks finds markdown, html, and bare public links", () => {
  const links = extractExternalLinks([
    "[Article](https://example.com/story)",
    '<img src="https://cdn.example.com/image.png">',
    "Bare: https://news.example.com/a.",
    "Internal: http://127.0.0.1:3010/NEV/tasks",
  ].join("\n"));

  assert.deepStrictEqual(links.sort(), [
    "https://cdn.example.com/image.png",
    "https://example.com/story",
    "https://news.example.com/a",
  ].sort());
});

test("sanitizeAgentCommentLinks leaves verified comments unchanged", () => {
  const body = "See [source](https://example.com/story).";
  const result = sanitizeAgentCommentLinks(body, {
    verify: fakeVerifier({ "https://example.com/story": { ok: true, status: 200 } }),
  });

  assert.strictEqual(result.body, body);
  assert.strictEqual(result.invalidLinks.length, 0);
});

test("sanitizeAgentCommentLinks withholds comments with broken links", () => {
  const body = "This link is broken: [bad](https://example.com/missing).";
  const result = sanitizeAgentCommentLinks(body, {
    verify: fakeVerifier({ "https://example.com/missing": { ok: false, status: 404, reason: "HTTP 404" } }),
  });

  assert.match(result.body, /\*\*Link verification failed\*\*/);
  assert.match(result.body, /withheld the sourced reply/);
  assert.match(result.body, /`https:\/\/example\.com\/missing` \(HTTP 404\)/);
  assert.doesNotMatch(result.body, /\[bad\]\(https:\/\/example\.com\/missing\)/);
  assert.strictEqual(result.invalidLinks.length, 1);
});

test("sanitizeAgentCommentLinks does not require comments without links", () => {
  const body = "No external sources in this update.";
  const result = sanitizeAgentCommentLinks(body, {
    verify: () => {
      throw new Error("should not verify");
    },
  });

  assert.strictEqual(result.body, body);
  assert.strictEqual(result.checkedLinks.length, 0);
});

test("shouldVerifyAgentCommentLinks covers platform runtime import sources", () => {
  assert.strictEqual(shouldVerifyAgentCommentLinks({ authorAgentId: "agent-1", source: "mission_control" }), true);
  assert.strictEqual(shouldVerifyAgentCommentLinks({ authorUserId: "openclaw:execution", source: "openclaw" }), true);
  assert.strictEqual(shouldVerifyAgentCommentLinks({ authorUserId: "codex:execution", source: "codex" }), true);
  assert.strictEqual(shouldVerifyAgentCommentLinks({ authorUserId: "api", source: "mission_control" }), false);
  assert.strictEqual(shouldVerifyAgentCommentLinks({ authorUserId: "mission-control:system", source: "openclaw" }), false);
  assert.strictEqual(shouldVerifyAgentCommentLinks({ authorUserId: "hiverunner:system", source: "openclaw" }), false);
});
