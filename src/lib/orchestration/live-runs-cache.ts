/**
 * Coalesces concurrent `/api/orchestration/engine/live-runs?company=…` fetches.
 *
 * The Dock, dashboard, and task board each mount their own `useLiveRuns`, so on
 * boot they fired separate identical requests for the same company. This shares
 * ONE in-flight request per company, plus a brief result cache, so the boot
 * burst collapses to a single network call. It does not change polling cadence:
 * the cache TTL is far shorter than the poll interval, so steady-state polls
 * still hit the server.
 */
type LiveRunsJson = Record<string, unknown>;

const COALESCE_TTL_MS = 750;

const inflight = new Map<string, Promise<LiveRunsJson>>();
const lastResult = new Map<string, { at: number; data: LiveRunsJson }>();

export async function fetchLiveRunsCoalesced(companySlug: string): Promise<LiveRunsJson> {
  const fresh = lastResult.get(companySlug);
  if (fresh && Date.now() - fresh.at < COALESCE_TTL_MS) {
    return fresh.data;
  }

  const existing = inflight.get(companySlug);
  if (existing) return existing;

  const request = (async () => {
    const res = await fetch(`/api/orchestration/engine/live-runs?company=${encodeURIComponent(companySlug)}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`live-runs request failed: ${res.status}`);
    const data = (await res.json()) as LiveRunsJson;
    lastResult.set(companySlug, { at: Date.now(), data });
    return data;
  })();

  inflight.set(companySlug, request);
  try {
    return await request;
  } finally {
    inflight.delete(companySlug);
  }
}

/** Test-only: clear coalescer state between cases. */
export function __resetLiveRunsCacheForTests(): void {
  inflight.clear();
  lastResult.clear();
}
