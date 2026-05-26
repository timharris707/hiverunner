import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { OPENCLAW_MEDIA } from "./paths";

const execFileAsync = promisify(execFile);

const SCREENSHOTS_DIR = path.join(OPENCLAW_MEDIA, "screenshots");

/** Extract the 11-char video ID from a YouTube URL */
export function extractVideoId(url: string): string | null {
  const m = url.match(
    /(?:youtu\.be\/|youtube\.com\/watch\?v=|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

export interface ScreenshotResult {
  reviewId: string;
  videoId: string;
  screenshots: { filename: string; timestamp: number }[];
  outputDir: string;
}

/**
 * Capture screenshots from a YouTube video at regular intervals.
 *
 * Uses yt-dlp to download the video and ffmpeg to extract frames.
 * Screenshots are saved to ~/.openclaw/media/screenshots/<reviewId>/
 *
 * @param url       YouTube URL
 * @param reviewId  Review ID for organizing files
 * @param interval  Seconds between screenshots (default: 30)
 */
export async function captureScreenshots(
  url: string,
  reviewId: string,
  interval: number = 30
): Promise<ScreenshotResult> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Invalid YouTube URL");

  const outputDir = path.join(SCREENSHOTS_DIR, reviewId);
  await fs.mkdir(outputDir, { recursive: true });

  const tmpVideo = path.join(outputDir, `_tmp_video.mp4`);

  try {
    // Step 1: Download video with yt-dlp (720p max to keep it fast)
    await execFileAsync(
      "yt-dlp",
      [
        "-f",
        "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best",
        "--merge-output-format",
        "mp4",
        "-o",
        tmpVideo,
        "--no-playlist",
        "--no-warnings",
        url,
      ],
      { timeout: 600_000 } // 10 min max for download
    );

    // Step 2: Get video duration via ffprobe
    const { stdout: durationOut } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      tmpVideo,
    ]);
    const duration = parseFloat(durationOut.trim());

    // Step 3: Extract frames at the given interval
    await execFileAsync(
      "ffmpeg",
      [
        "-i",
        tmpVideo,
        "-vf",
        `fps=1/${interval},scale=1280:-1`,
        "-q:v",
        "2",
        "-y",
        path.join(outputDir, "frame_%04d.jpg"),
      ],
      { timeout: 300_000 } // 5 min max for extraction
    );

    // Step 4: Build the result list
    const files = await fs.readdir(outputDir);
    const frameFiles = files
      .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
      .sort();

    const screenshots = frameFiles.map((filename, idx) => ({
      filename,
      timestamp: idx * interval,
    }));

    return {
      reviewId,
      videoId,
      screenshots,
      outputDir,
    };
  } finally {
    // Clean up the temp video file
    await fs.unlink(tmpVideo).catch(() => {});
  }
}

/** Get existing screenshots for a review (if already captured) */
export async function getScreenshots(
  reviewId: string
): Promise<{ filename: string; timestamp: number }[] | null> {
  const dir = path.join(SCREENSHOTS_DIR, reviewId);
  try {
    const files = await fs.readdir(dir);
    const frameFiles = files
      .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
      .sort();

    if (frameFiles.length === 0) return null;

    // Try to read metadata if it exists
    const metaPath = path.join(dir, "meta.json");
    try {
      const raw = await fs.readFile(metaPath, "utf-8");
      const meta = JSON.parse(raw);
      return meta.screenshots;
    } catch {
      // No metadata, infer timestamps at 30s intervals
      return frameFiles.map((filename, idx) => ({
        filename,
        timestamp: idx * 30,
      }));
    }
  } catch {
    return null;
  }
}

/** Save screenshot metadata alongside the images */
export async function saveScreenshotMeta(
  result: ScreenshotResult
): Promise<void> {
  const metaPath = path.join(result.outputDir, "meta.json");
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        reviewId: result.reviewId,
        videoId: result.videoId,
        screenshots: result.screenshots,
        capturedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

/** Format seconds as mm:ss */
export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
