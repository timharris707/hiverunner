/**
 * useAvatarSession — React hook for Pipecat avatar mode (Daily WebRTC).
 *
 * Manages:
 *   - Backend availability check
 *   - Session start via /api/voice/avatar (proxied to Pipecat)
 *   - Daily call join/leave lifecycle
 *   - Remote participant video track surfacing
 *   - Session state machine (idle → checking → starting → joining → connected → error)
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AvatarSessionState =
  | "idle"
  | "checking"    // health check in flight
  | "available"   // backend is up, ready to start
  | "unavailable" // backend unreachable
  | "starting"    // POST /start in flight
  | "joining"     // joining the Daily room
  | "connected"   // in-room, avatar streaming
  | "error"       // something went wrong
  | "leaving";    // hanging up

export interface AvatarSession {
  state: AvatarSessionState;
  error: string | null;
  /** The Daily room URL we joined */
  roomUrl: string | null;
  /** Ref that will be assigned the avatar video element for rendering */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Check if the avatar backend is reachable */
  checkAvailability: () => Promise<boolean>;
  /** Start a Pipecat session and join the Daily room */
  start: () => Promise<void>;
  /** Hang up and clean up */
  hangup: () => void;
}

// Dynamic import for Daily to avoid SSR issues
let DailyIframe: typeof import("@daily-co/daily-js").default | null = null;

async function getDailyIframe() {
  if (DailyIframe) return DailyIframe;
  const mod = await import("@daily-co/daily-js");
  DailyIframe = mod.default;
  return DailyIframe;
}

export function useAvatarSession(): AvatarSession {
  const [state, setState] = useState<AvatarSessionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callRef = useRef<any>(null);  // Daily call object
  const audioElRef = useRef<HTMLAudioElement | null>(null); // hidden audio element for remote audio
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const checkAvailability = useCallback(async (): Promise<boolean> => {
    setState("checking");
    setError(null);
    try {
      const res = await fetch("/api/voice/avatar");
      const data = await res.json();
      if (mountedRef.current) {
        if (data.available) {
          setState("available");
          return true;
        } else {
          setState("unavailable");
          setError(data.error || "Avatar backend not available");
          return false;
        }
      }
      return false;
    } catch {
      if (mountedRef.current) {
        setState("unavailable");
        setError("Could not reach avatar backend");
      }
      return false;
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setState("starting");

    try {
      // 1. Start a Pipecat session
      const res = await fetch("/api/voice/avatar", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(data.error || `Start failed (${res.status})`);
      }
      const { room_url, user_token } = await res.json();
      if (!room_url || !user_token) {
        throw new Error("Backend returned incomplete session data");
      }
      if (mountedRef.current) setRoomUrl(room_url);

      // 2. Join the Daily room
      if (mountedRef.current) setState("joining");

      const Daily = await getDailyIframe();
      const call = Daily.createCallObject({
        videoSource: false,  // we don't send video
        audioSource: true,   // we DO send our mic
        subscribeToTracksAutomatically: true,
      });
      callRef.current = call;

      // Handle remote tracks (avatar video + audio)
      call.on("track-started", (evt: { track?: MediaStreamTrack; participant?: { local?: boolean } }) => {
        if (evt.participant?.local) return;

        if (evt.track?.kind === "video" && videoRef.current) {
          const stream = new MediaStream([evt.track]);
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }

        if (evt.track?.kind === "audio") {
          // Play remote audio through a hidden <audio> element
          if (!audioElRef.current) {
            audioElRef.current = document.createElement("audio");
            audioElRef.current.autoplay = true;
          }
          const audioStream = new MediaStream([evt.track]);
          audioElRef.current.srcObject = audioStream;
          void audioElRef.current.play().catch(() => {});
        }
      });

      call.on("track-stopped", (evt: { track?: MediaStreamTrack; participant?: { local?: boolean } }) => {
        if (evt.participant?.local) return;

        if (evt.track?.kind === "video" && videoRef.current) {
          videoRef.current.srcObject = null;
        }
        if (evt.track?.kind === "audio" && audioElRef.current) {
          audioElRef.current.srcObject = null;
        }
      });

      call.on("left-meeting", () => {
        if (mountedRef.current) {
          setState("idle");
          setRoomUrl(null);
        }
      });

      call.on("error", (evt: { errorMsg?: string }) => {
        if (mountedRef.current) {
          setState("error");
          setError(evt.errorMsg || "Daily call error");
        }
      });

      await call.join({ url: room_url, token: user_token });

      if (mountedRef.current) setState("connected");
    } catch (err) {
      if (mountedRef.current) {
        setState("error");
        setError(err instanceof Error ? err.message : "Failed to start avatar session");
      }
    }
  }, []);

  const hangup = useCallback(() => {
    setState("leaving");
    setError(null);

    const call = callRef.current;
    if (call) {
      try {
        call.leave();
        call.destroy();
      } catch {
        // already left/destroyed
      }
      callRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }

    setRoomUrl(null);
    setState("idle");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const call = callRef.current;
      if (call) {
        try {
          call.leave();
          call.destroy();
        } catch {
          // fine
        }
        callRef.current = null;
      }
    };
  }, []);

  return {
    state,
    error,
    roomUrl,
    videoRef,
    checkAvailability,
    start,
    hangup,
  };
}
