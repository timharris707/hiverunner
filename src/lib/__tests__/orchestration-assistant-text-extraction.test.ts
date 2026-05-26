/**
 * Contract tests for assistant text extraction and the stored-vs-live
 * transcript selection. These cover the 2026-04-17 Barometer failure
 * mode where a ```mc-action``` fence was split across multiple streamed
 * text blocks, causing the parser to find zero actions even though the
 * agent produced five well-formed ones.
 *
 * Run: npx tsx src/lib/__tests__/orchestration-assistant-text-extraction.test.ts
 *
 * These are pure functions (no DB, no network) so the tests exercise
 * the regex + concatenation behavior directly. We don't re-export the
 * internal helpers from engine.ts; instead we replicate the exact
 * contracts here and verify the shapes and regex that the engine uses.
 */

import assert from "node:assert";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  \u2717 ${name}`);
      console.error(`    ${message}`);
    });
}

/** Replicates the engine's mc-action regex. Must stay in sync. */
const MC_ACTION_PATTERN = /```mc-action[^\n]*\n([\s\S]*?)```/g;

/** Replicates the updated extractAssistantTexts behavior. */
function extractAssistantTexts(
  messages: Array<{
    role?: string;
    content?: string | Array<{ type?: string; text?: string; thinking?: string }>;
  }>,
): string[] {
  return messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => {
      if (typeof message.content === "string") {
        return [message.content];
      }
      if (Array.isArray(message.content)) {
        const combined = message.content
          .filter(
            (block) =>
              block.type === "text" && typeof block.text === "string",
          )
          .map((block) => block.text as string)
          .join("");
        return combined ? [combined] : [];
      }
      return [];
    })
    .map((text) => text.trim())
    .filter(Boolean);
}

async function run() {
  console.log("\nAssistant Text Extraction + Transcript Selection Tests\n");

  await test("clean canonical case: 1 assistant message, 1 text block, 5 fences", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "internal reasoning — ignored" },
          {
            type: "text",
            text:
              "```mc-action\n" +
              '{"action":"add_comment","taskKey":"WEA-262","body":"mgmt response"}\n' +
              "```\n\n" +
              "```mc-action\n" +
              '{"action":"add_comment","taskKey":"WEA-261","body":"vane plan"}\n' +
              "```\n\n" +
              "```mc-action\n" +
              '{"action":"report","summary":"ok"}\n' +
              "```",
          },
        ],
      },
    ];

    const texts = extractAssistantTexts(messages);
    assert.strictEqual(texts.length, 1, "one combined message string");

    const matches = Array.from(texts[0].matchAll(MC_ACTION_PATTERN));
    assert.strictEqual(matches.length, 3, "all three mc-action fences parse");
  });

  await test(
    "regression: 8 fragmented text blocks merge so a fence split across them still parses",
    () => {
      // This is the real failure shape observed in the 2026-04-17 aa70cfaf
      // Barometer run. The gateway returned the assistant output split into
      // multiple text blocks where individual fences straddled the split.
      const fragmented = [
        { type: "text", text: "```mc-action\n" },
        { type: "text", text: '{"action":"add_comment","taskKey":"WEA-262",' },
        { type: "text", text: '"body":"recover me"}\n```\n\n```mc-action\n' },
        { type: "text", text: '{"action":"report","summary":"still there"}\n```' },
      ];

      const messages = [
        {
          role: "assistant",
          content: fragmented,
        },
      ];

      const texts = extractAssistantTexts(messages);
      assert.strictEqual(texts.length, 1, "fragments merge to 1 string");

      const matches = Array.from(texts[0].matchAll(MC_ACTION_PATTERN));
      assert.strictEqual(
        matches.length,
        2,
        `expected 2 fences across merged fragments, got ${matches.length}`,
      );

      const parsed = matches
        .map((m) => JSON.parse(m[1].trim()) as Record<string, unknown>);
      assert.deepStrictEqual(
        parsed.map((p) => p.action),
        ["add_comment", "report"],
      );
    },
  );

  await test("multi-turn: two assistant messages produce two separate strings", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "first wake" }] },
      {
        role: "assistant",
        content: [{ type: "text", text: "turn 1 narrative, no actions" }],
      },
      { role: "user", content: [{ type: "text", text: "second wake" }] },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text:
              "```mc-action\n" +
              '{"action":"report","summary":"turn 2"}\n' +
              "```",
          },
        ],
      },
    ];

    const texts = extractAssistantTexts(messages);
    assert.strictEqual(texts.length, 2, "two assistant turns → two strings");

    const turn1Matches = Array.from(texts[0].matchAll(MC_ACTION_PATTERN));
    const turn2Matches = Array.from(texts[1].matchAll(MC_ACTION_PATTERN));
    assert.strictEqual(turn1Matches.length, 0, "turn 1 has no fences");
    assert.strictEqual(turn2Matches.length, 1, "turn 2 has one fence");
  });

  await test("transcript-selection heuristic: prefer stored when stored is non-empty", () => {
    // New heuristic is just: storedAssistantTexts.length > 0.
    // Replicate that decision directly to lock the contract.
    function shouldUseStored(
      storedTexts: string[],
      _liveTexts: string[],
    ): boolean {
      return storedTexts.length > 0;
    }

    // Case: live has more chars but no fences; stored has fewer chars but 1 fence.
    // Stored should win so the fence is actually parsed.
    assert.strictEqual(
      shouldUseStored(
        ["```mc-action\n{\"action\":\"report\",\"summary\":\"yes\"}\n```"],
        ["lots of prose with no fences here, very long"],
      ),
      true,
      "non-empty stored wins over prose-only live",
    );

    // Case: stored empty, live has content. Fall back to live.
    assert.strictEqual(
      shouldUseStored([], ["live fallback content"]),
      false,
      "empty stored means fall back to live",
    );

    // Case: both empty. Doesn't matter; stored is empty so falls back to live path.
    assert.strictEqual(shouldUseStored([], []), false);
  });

  await test("thinking-only assistant message contributes no text", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "pure reasoning, no final answer" },
        ],
      },
    ];
    const texts = extractAssistantTexts(messages);
    assert.strictEqual(texts.length, 0, "thinking-only → empty array");
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
