/**
 * /api/voice/preview-sample — Generate a short audio clip of a specific
 * Gemini Live prebuilt voice saying a greeting line.
 *
 * Used by the Avatar Wizard's voice step so operators can hear each voice
 * before picking one. Opens a brief server-side Gemini Live session, asks
 * the agent to say exactly the sample line, collects the streamed PCM
 * audio, wraps it in a WAV header, and returns it as a cacheable blob.
 *
 * Pattern: fire-and-forget one-shot session. Closes as soon as
 * turn_complete arrives or after a timeout.
 */

import WebSocket from "ws";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

import { GEMINI_LIVE_MODEL, parseServerMessage } from "@/lib/gemini-live";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getSecret } from "@/lib/secrets";
import { VOICE_CATALOG, type VoicePreset } from "@/components/orchestration/voice-catalog";

export const dynamic = "force-dynamic";

const PREVIEW_TIMEOUT_MS = 9_500;
const FIRST_AUDIO_TIMEOUT_MS = 2_500;
const MIN_PREVIEW_SECONDS = 2.4;
const MAX_PREVIEW_SECONDS = 7.5;
const PREVIEW_CACHE_VERSION = "voice-director-v13";
const GEMINI_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const sampleCache = new Map<string, Buffer>();
const sampleInflight = new Map<string, Promise<Buffer>>();
const DISK_CACHE_ROOT = path.join(
  process.env.MC_DATA_DIR ?? path.join(process.cwd(), "data"),
  "voice-preview-cache",
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
};

function wavFromPcm16(pcmBuffer: Buffer, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

function parseRateFromMimeType(mimeType: string | undefined, fallback: number): number {
  if (!mimeType) return fallback;
  const match = mimeType.match(/rate=(\d+)/i);
  if (!match) return fallback;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function previewLineForPreset(preset: VoicePreset): string {
  const styleCue = preset.style.toLowerCase().split(/\s+/)[0]?.replace(/[^a-z-]/g, "") || "clear";
  return `I'm ${preset.name}, ready with ${styleCue} updates for your workspace.`;
}

function previewInstructionForPreset(preset: VoicePreset): string {
  return [
    `Voice direction: ${preset.style}; ${preset.pace} pace; ${preset.accent} accent/color.`,
    "Say the full requested sentence exactly once, including every word, then stop.",
    "No preamble, no commentary, no extra words, and do not trail off.",
  ].join(" ");
}

function safeCacheVoiceId(voiceId: string): string {
  return voiceId.replace(/[^a-z0-9_-]/gi, "_");
}

function diskCachePath(version: string, preset: VoicePreset): string {
  return path.join(DISK_CACHE_ROOT, version, `${safeCacheVoiceId(preset.id)}.wav`);
}

async function readDiskSample(version: string, preset: VoicePreset): Promise<Buffer | null> {
  try {
    return await readFile(diskCachePath(version, preset));
  } catch {
    return null;
  }
}

async function writeDiskSample(version: string, preset: VoicePreset, audio: Buffer): Promise<void> {
  const target = diskCachePath(version, preset);
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, audio);
  await rename(tmp, target);
}

function rangeResponse(audio: Buffer, rangeHeader: string): NextResponse {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return new NextResponse(null, {
      status: 416,
      headers: {
        ...CORS_HEADERS,
        "Content-Range": `bytes */${audio.length}`,
      },
    });
  }

  const requestedStart = match[1] ? Number(match[1]) : 0;
  const requestedEnd = match[2] ? Number(match[2]) : audio.length - 1;
  const start = Number.isFinite(requestedStart) ? requestedStart : 0;
  const end = Number.isFinite(requestedEnd) ? Math.min(requestedEnd, audio.length - 1) : audio.length - 1;
  if (start < 0 || start >= audio.length || end < start) {
    return new NextResponse(null, {
      status: 416,
      headers: {
        ...CORS_HEADERS,
        "Content-Range": `bytes */${audio.length}`,
      },
    });
  }

  const chunk = audio.subarray(start, end + 1);
  return new NextResponse(new Uint8Array(chunk), {
    status: 206,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "audio/wav",
      "Content-Length": String(chunk.length),
      "Content-Range": `bytes ${start}-${end}/${audio.length}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}

async function generateSample(
  apiKey: string,
  preset: VoicePreset,
  sampleLine: string
): Promise<{ pcm: Buffer; sampleRate: number }> {
  const ws = new WebSocket(`${GEMINI_WS_URL}?key=${apiKey}`);
  const chunks: Buffer[] = [];
  let sampleRate = 24000;
  let collectedBytes = 0;
  let settled = false;

  return new Promise<{ pcm: Buffer; sampleRate: number }>((resolve, reject) => {
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(firstAudioTimeout);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      fn();
    };

    const timeout = setTimeout(() => {
      finish(() => reject(new Error("voice preview timed out")));
    }, PREVIEW_TIMEOUT_MS);

    const firstAudioTimeout = setTimeout(() => {
      finish(() => reject(new Error("Gemini did not start voice preview audio")));
    }, FIRST_AUDIO_TIMEOUT_MS);

    ws.on("open", () => {
      // Stripped-down setup: no tools, no input transcription. This is a
      // one-shot server-side session — we only need a single audio turn out.
      const setup = {
        setup: {
          model: `models/${GEMINI_LIVE_MODEL}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: preset.id },
              },
            },
            temperature: 0.2,
          },
          systemInstruction: {
            parts: [
              {
                text: previewInstructionForPreset(preset),
              },
            ],
          },
        },
      };
      ws.send(JSON.stringify(setup));
    });

    ws.on("message", (raw) => {
      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const events = parseServerMessage(payload);
      for (const event of events) {
        if (event.type === "setup_complete") {
          ws.send(
            JSON.stringify({
              clientContent: {
                turns: [
                  {
                    role: "user",
                    parts: [{ text: sampleLine }],
                  },
                ],
                turnComplete: true,
              },
            })
          );
        } else if (event.type === "audio") {
          try {
            const chunk = Buffer.from(event.data, "base64");
            sampleRate = parseRateFromMimeType(event.mimeType, sampleRate);
            chunks.push(chunk);
            collectedBytes += chunk.length;
            clearTimeout(firstAudioTimeout);
            const maxBytes = Math.floor(sampleRate * 2 * MAX_PREVIEW_SECONDS);
            if (collectedBytes >= maxBytes) {
              clearTimeout(timeout);
              const pcm = Buffer.concat(chunks).subarray(0, maxBytes);
              finish(() => resolve({ pcm, sampleRate }));
              return;
            }
          } catch {
            /* skip malformed chunk */
          }
        } else if (event.type === "turn_complete" || event.type === "generation_complete") {
          clearTimeout(timeout);
          if (chunks.length === 0) {
            finish(() => reject(new Error("Gemini returned no audio")));
          } else {
            const pcm = Buffer.concat(chunks);
            const minBytes = Math.floor(sampleRate * 2 * MIN_PREVIEW_SECONDS);
            if (pcm.length < minBytes) {
              finish(() => reject(new Error("Gemini returned a preview that was too short")));
            } else {
              finish(() => resolve({ pcm, sampleRate }));
            }
          }
        } else if (event.type === "error") {
          clearTimeout(timeout);
          finish(() => reject(new Error(event.message || "Gemini preview error")));
        }
      }
    });

    ws.on("error", (err: Error) => {
      clearTimeout(timeout);
      finish(() => reject(err));
    });

    ws.on("close", () => {
      if (!settled) {
        clearTimeout(timeout);
        if (chunks.length > 0) {
          const pcm = Buffer.concat(chunks);
          const minBytes = Math.floor(sampleRate * 2 * MIN_PREVIEW_SECONDS);
          if (pcm.length < minBytes) {
            finish(() => reject(new Error("Gemini closed before finishing preview audio")));
          } else {
            finish(() => resolve({ pcm, sampleRate }));
          }
        } else {
          finish(() => reject(new Error("Gemini closed without audio")));
        }
      }
    });
  });
}

async function cachedSample(apiKey: string, preset: VoicePreset): Promise<Buffer> {
  const cacheKey = `${PREVIEW_CACHE_VERSION}:${preset.id}`;
  const cached = sampleCache.get(cacheKey);
  if (cached) return cached;

  const diskCached = await readDiskSample(PREVIEW_CACHE_VERSION, preset);
  if (diskCached) {
    sampleCache.set(cacheKey, diskCached);
    return diskCached;
  }

  const pending = sampleInflight.get(cacheKey);
  if (pending) return pending;

  const promise = (async () => {
    const { pcm, sampleRate } = await generateSample(apiKey, preset, previewLineForPreset(preset));
    const audio = wavFromPcm16(pcm, sampleRate);
    sampleCache.set(cacheKey, audio);
    void writeDiskSample(PREVIEW_CACHE_VERSION, preset, audio).catch(() => {});
    return audio;
  })();

  sampleInflight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    sampleInflight.delete(cacheKey);
  }
}

export async function GET(req: NextRequest) {
  try {
    const voiceId = req.nextUrl.searchParams.get("voiceId");
    if (!voiceId) {
      return errorResponse(400, "voice_id_required", "voiceId query param is required");
    }

    const preset = VOICE_CATALOG.find((v) => v.id === voiceId);
    if (!preset) {
      return errorResponse(400, "unknown_voice", `Unknown voice: ${voiceId}`);
    }

    const apiKey = getSecret("GOOGLE_AI_API_KEY") || getSecret("GEMINI_API_KEY");
    if (!apiKey) {
      return errorResponse(
        503,
        "voice_api_not_configured",
        "GOOGLE_AI_API_KEY or GEMINI_API_KEY not configured"
      );
    }

    const audio = await cachedSample(apiKey, preset);
    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      return rangeResponse(audio, rangeHeader);
    }

    return new NextResponse(new Uint8Array(audio), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "audio/wav",
        "Content-Length": String(audio.length),
        "Accept-Ranges": "bytes",
        // Samples are deterministic per voice/sampleLine pair — let the browser cache hard.
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (error) {
    return handleRouteError(error, "voice-preview-sample:get");
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
