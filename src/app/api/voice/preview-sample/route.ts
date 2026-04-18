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
import { NextRequest, NextResponse } from "next/server";

import { GEMINI_LIVE_MODEL, parseServerMessage } from "@/lib/gemini-live";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { VOICE_CATALOG } from "@/components/orchestration/voice-catalog";

export const dynamic = "force-dynamic";

const PREVIEW_TIMEOUT_MS = 20_000;
const GEMINI_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

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

async function generateSample(
  apiKey: string,
  voiceName: string,
  sampleLine: string
): Promise<{ pcm: Buffer; sampleRate: number }> {
  const ws = new WebSocket(`${GEMINI_WS_URL}?key=${apiKey}`);
  const chunks: Buffer[] = [];
  let sampleRate = 24000;
  let settled = false;

  return new Promise<{ pcm: Buffer; sampleRate: number }>((resolve, reject) => {
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
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
                prebuiltVoiceConfig: { voiceName },
              },
            },
            temperature: 0.2,
          },
          systemInstruction: {
            parts: [
              {
                text: "You read back whatever the user tells you to say. No preamble, no commentary, nothing extra. Just say the line exactly once and stop.",
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
          // `realtimeInput.text` is the only form that reliably triggers a
          // turn in a server-initiated Live session. `clientContent.turns`
          // was tried first and silently produced no audio.
          ws.send(
            JSON.stringify({
              realtimeInput: {
                text: `Say exactly this, no preamble: "${sampleLine}"`,
              },
            })
          );
        } else if (event.type === "audio") {
          try {
            chunks.push(Buffer.from(event.data, "base64"));
            sampleRate = parseRateFromMimeType(event.mimeType, sampleRate);
          } catch {
            /* skip malformed chunk */
          }
        } else if (event.type === "turn_complete" || event.type === "generation_complete") {
          clearTimeout(timeout);
          if (chunks.length === 0) {
            finish(() => reject(new Error("Gemini returned no audio")));
          } else {
            finish(() => resolve({ pcm: Buffer.concat(chunks), sampleRate }));
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
          finish(() => resolve({ pcm: Buffer.concat(chunks), sampleRate }));
        } else {
          finish(() => reject(new Error("Gemini closed without audio")));
        }
      }
    });
  });
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

    const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return errorResponse(
        503,
        "voice_api_not_configured",
        "GOOGLE_AI_API_KEY or GEMINI_API_KEY not configured"
      );
    }

    const { pcm, sampleRate } = await generateSample(apiKey, preset.id, preset.sampleLine);
    const wav = wavFromPcm16(pcm, sampleRate);

    return new NextResponse(new Uint8Array(wav), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(wav.length),
        // Samples are deterministic per voice/sampleLine pair — let the browser cache hard.
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (error) {
    return handleRouteError(error, "voice-preview-sample:get");
  }
}
