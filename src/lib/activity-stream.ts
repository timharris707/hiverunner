/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * In-memory activity stream for live build events.
 * Agents POST events here; the SSE endpoint streams them to the frontend.
 */

export interface ActivityEvent {
  id: string;
  taskId: string;
  action: "READ" | "WRITE" | "RUN" | "THINK" | "SEARCH" | "REVIEW" | "DONE";
  description: string;
  status: "running" | "completed" | "failed";
  timestamp: string;
  agent?: string;
}

// Keyed by taskId → ordered list of events
const streams = new Map<string, ActivityEvent[]>();

// SSE listeners keyed by taskId → Set of writable controllers
const listeners = new Map<string, Set<ReadableStreamDefaultController>>();

// Max events per task (ring buffer)
const MAX_EVENTS = 200;

// Auto-expire tasks with no new events after 30 minutes
const EXPIRY_MS = 30 * 60 * 1000;
const lastActivity = new Map<string, number>();

export function pushEvent(event: ActivityEvent): void {
  const { taskId } = event;
  if (!streams.has(taskId)) streams.set(taskId, []);
  const list = streams.get(taskId)!;
  list.push(event);
  if (list.length > MAX_EVENTS) list.shift();
  lastActivity.set(taskId, Date.now());

  // Notify all SSE listeners for this task
  const subs = listeners.get(taskId);
  if (subs) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    const encoder = new TextEncoder();
    for (const controller of subs) {
      try {
        controller.enqueue(encoder.encode(data));
      } catch {
        subs.delete(controller);
      }
    }
  }
}

export function getEvents(taskId: string): ActivityEvent[] {
  return streams.get(taskId) || [];
}

export function getLatestEvents(taskId: string, limit = 20): ActivityEvent[] {
  const list = streams.get(taskId) || [];
  return list.slice(-limit);
}

export function subscribe(
  taskId: string,
  controller: ReadableStreamDefaultController
): () => void {
  if (!listeners.has(taskId)) listeners.set(taskId, new Set());
  listeners.get(taskId)!.add(controller);
  return () => {
    listeners.get(taskId)?.delete(controller);
    if (listeners.get(taskId)?.size === 0) listeners.delete(taskId);
  };
}

export function getActiveTaskIds(): string[] {
  const now = Date.now();
  const active: string[] = [];
  for (const [taskId, ts] of lastActivity) {
    if (now - ts < EXPIRY_MS) {
      active.push(taskId);
    } else {
      // Cleanup expired
      streams.delete(taskId);
      lastActivity.delete(taskId);
      listeners.delete(taskId);
    }
  }
  return active;
}
