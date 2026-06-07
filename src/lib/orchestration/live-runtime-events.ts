import type { MCLiveEvent } from "./live-events";

type LiveRuntimeEventSubscriber = (event: MCLiveEvent) => void;

interface LiveRuntimeEventSubscriptionOptions {
  companyId?: string | null;
  runId?: string | null;
  replay?: boolean;
}

interface LiveRuntimeEventsStatus {
  subscriberCount: number;
  bufferedRunCount: number;
  bufferedEventCount: number;
  ringBufferSize: number;
}

interface LiveRuntimeEventSubscription {
  fn: LiveRuntimeEventSubscriber;
  companyId: string | null;
  runId: string | null;
}

export const LIVE_RUNTIME_RING_BUFFER_SIZE = 64;

let nextRuntimeSeq = 1;
const subscribers = new Set<LiveRuntimeEventSubscription>();
const eventsByRunId = new Map<string, MCLiveEvent[]>();

function matchesSubscription(
  event: MCLiveEvent,
  options: Pick<LiveRuntimeEventSubscription, "companyId" | "runId">,
): boolean {
  if (options.companyId && event.companyId !== options.companyId) return false;
  if (options.runId && event.runId !== options.runId) return false;
  return true;
}

function notify(subscription: LiveRuntimeEventSubscription, event: MCLiveEvent): void {
  if (!matchesSubscription(event, subscription)) return;
  try {
    subscription.fn(event);
  } catch {
    // Subscriber errors must not break live runtime publishing.
  }
}

function appendToRingBuffer(event: MCLiveEvent): void {
  const buffer = eventsByRunId.get(event.runId) ?? [];
  buffer.push(event);
  if (buffer.length > LIVE_RUNTIME_RING_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - LIVE_RUNTIME_RING_BUFFER_SIZE);
  }
  eventsByRunId.set(event.runId, buffer);
}

export function publishLiveRuntimeEvent(event: MCLiveEvent): MCLiveEvent {
  const published = event.seq === undefined ? { ...event, seq: nextRuntimeSeq++ } : event;
  appendToRingBuffer(published);

  for (const subscription of subscribers) {
    notify(subscription, published);
  }

  return published;
}

export function getBufferedLiveRuntimeEvents(
  options: Omit<LiveRuntimeEventSubscriptionOptions, "replay"> = {},
): MCLiveEvent[] {
  const filter = {
    companyId: options.companyId ?? null,
    runId: options.runId ?? null,
  };
  const events: MCLiveEvent[] = [];

  for (const buffer of eventsByRunId.values()) {
    for (const event of buffer) {
      if (matchesSubscription(event, filter)) {
        events.push(event);
      }
    }
  }

  return events.sort((a, b) => (a.ts - b.ts) || ((a.seq ?? 0) - (b.seq ?? 0)));
}

export function subscribeLiveRuntimeEvents(
  fn: LiveRuntimeEventSubscriber,
  options: LiveRuntimeEventSubscriptionOptions = {},
): () => void {
  const subscription: LiveRuntimeEventSubscription = {
    fn,
    companyId: options.companyId ?? null,
    runId: options.runId ?? null,
  };
  subscribers.add(subscription);

  if (options.replay) {
    for (const event of getBufferedLiveRuntimeEvents(options)) {
      notify(subscription, event);
    }
  }

  return () => {
    subscribers.delete(subscription);
  };
}

export function getLiveRuntimeEventsStatus(): LiveRuntimeEventsStatus {
  let bufferedEventCount = 0;
  for (const buffer of eventsByRunId.values()) {
    bufferedEventCount += buffer.length;
  }

  return {
    subscriberCount: subscribers.size,
    bufferedRunCount: eventsByRunId.size,
    bufferedEventCount,
    ringBufferSize: LIVE_RUNTIME_RING_BUFFER_SIZE,
  };
}

export function __resetLiveRuntimeEventsForTests(): void {
  subscribers.clear();
  eventsByRunId.clear();
  nextRuntimeSeq = 1;
}
