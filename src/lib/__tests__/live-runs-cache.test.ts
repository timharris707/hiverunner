import assert from "node:assert/strict";

import { fetchLiveRunsCoalesced, __resetLiveRunsCacheForTests } from "@/lib/orchestration/live-runs-cache";

type FetchArgs = Parameters<typeof fetch>;

async function run() {
  let calls = 0;
  const urls: string[] = [];
  // Stub global fetch with a small delay so concurrent callers overlap.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: FetchArgs[0]) => {
    calls += 1;
    urls.push(String(url));
    await new Promise((r) => setTimeout(r, 25));
    return { ok: true, json: async () => ({ runs: [{ agentId: "a", status: "running" }] }) } as Response;
  }) as typeof fetch;

  try {
    __resetLiveRunsCacheForTests();

    // Two concurrent + one immediate sequential call for the SAME company share one fetch.
    const [a, b] = await Promise.all([fetchLiveRunsCoalesced("ricktest"), fetchLiveRunsCoalesced("ricktest")]);
    const c = await fetchLiveRunsCoalesced("ricktest"); // within TTL → cache hit
    assert.equal(calls, 1, `same-company boot burst collapses to one fetch (got ${calls})`);
    assert.deepEqual(a, b);
    assert.deepEqual(a, c);
    assert.ok(Array.isArray((a as { runs?: unknown[] }).runs));

    // A different company is a separate request.
    __resetLiveRunsCacheForTests();
    calls = 0;
    await Promise.all([fetchLiveRunsCoalesced("co1"), fetchLiveRunsCoalesced("co2")]);
    assert.equal(calls, 2, "distinct companies are not coalesced together");
    assert.ok(urls.some((u) => u.includes("company=co1")) && urls.some((u) => u.includes("company=co2")));

    // Errors propagate (caller swallows) and do not poison the cache.
    __resetLiveRunsCacheForTests();
    calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return { ok: false, status: 503, json: async () => ({}) } as Response;
    }) as typeof fetch;
    await assert.rejects(() => fetchLiveRunsCoalesced("err"), /503/);

    console.log("PASS live-runs-cache");
  } finally {
    globalThis.fetch = realFetch;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
