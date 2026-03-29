/* eslint-disable @typescript-eslint/no-explicit-any */
import { chromium, webkit, type Browser } from "playwright";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

const SCREENSHOTS_DIR = join(process.cwd(), "public", "screenshots");

/** Ensure the screenshots directory exists for the given task */
function ensureDir(taskId: string) {
  const dir = join(SCREENSHOTS_DIR, taskId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface CaptureResult {
  filePath: string;
  relativePath: string;
  timestamp: string;
  url: string;
  viewport: { width: number; height: number };
  phase?: "before" | "after";
}

/**
 * Capture a full-page screenshot of the given URL using Playwright (headless Chromium).
 * Saves to public/screenshots/{taskId}/{timestamp}.png
 */
export async function captureScreenshot(
  url: string,
  taskId: string,
): Promise<CaptureResult> {
  const dir = ensureDir(taskId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${timestamp}.png`;
  const filePath = join(dir, filename);
  const relativePath = `screenshots/${taskId}/${filename}`;

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      colorScheme: "dark",
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

    await page.screenshot({ path: filePath, fullPage: true });

    return {
      filePath,
      relativePath,
      timestamp: new Date().toISOString(),
      url,
      viewport: { width: 1920, height: 1080 },
    };
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Capture a full-page screenshot using WebKit (Safari engine).
 * Use this to verify Safari compatibility — catches bugs that Chromium misses.
 */
export async function captureScreenshotSafari(
  url: string,
  taskId: string,
): Promise<CaptureResult> {
  const dir = ensureDir(taskId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `safari-${timestamp}.png`;
  const filePath = join(dir, filename);
  const relativePath = `screenshots/${taskId}/${filename}`;

  let browser: Browser | null = null;
  try {
    browser = await webkit.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      colorScheme: "dark",
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

    await page.screenshot({ path: filePath, fullPage: true });

    return {
      filePath,
      relativePath,
      timestamp: new Date().toISOString(),
      url,
      viewport: { width: 1920, height: 1080 },
      phase: "after",
    };
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Capture screenshots in BOTH Chromium and WebKit (Safari) for cross-browser QA.
 * Returns array of captures from both browsers.
 */
export async function captureScreenshotAllBrowsers(
  url: string,
  taskId: string,
): Promise<CaptureResult[]> {
  const results: CaptureResult[] = [];

  try {
    const chromiumResult = await captureScreenshot(url, taskId);
    results.push({ ...chromiumResult, phase: "after" });
  } catch (err) {
    console.error("[visual-qa] Chromium capture failed:", err);
  }

  try {
    const safariResult = await captureScreenshotSafari(url, taskId);
    results.push(safariResult);
  } catch (err) {
    console.error("[visual-qa] WebKit/Safari capture failed:", err);
  }

  return results;
}

/**
 * Check whether a captured screenshot file exists and is non-empty (basic QA pass).
 * Returns true if the screenshot looks valid — no explicit error states detected.
 */
export function validateCapture(filePath: string): boolean {
  try {
    if (!existsSync(filePath)) return false;
    const { statSync } = require("fs");
    const stat = statSync(filePath);
    return stat.size > 1024; // a real page screenshot should be > 1KB
  } catch {
    return false;
  }
}

/**
 * Build the review prompt for the Visual QA agent.
 * The agent checks the screenshot + code diff for visual regressions and layout issues.
 */
export function visualQAReviewPrompt(
  task: any,
  projectName: string,
  buildOutput: string,
  captures: Array<{ relativePath?: string; filePath?: string; phase?: string; capturedAt?: string }>,
): string {
  const screenshotPaths = captures
    .filter((c) => c.relativePath || c.filePath)
    .map((c) => {
      const path = c.filePath || join(process.cwd(), "public", c.relativePath || "");
      return `- [${c.phase || "after"}] ${path} (captured ${c.capturedAt || "unknown"})`;
    })
    .join("\n");

  const beforeCaptures = captures.filter((c) => c.phase === "before");
  const afterCaptures = captures.filter((c) => c.phase === "after");
  const hasBeforeAfter = beforeCaptures.length > 0 && afterCaptures.length > 0;

  return [
    `## Visual QA Review: ${task.title}`,
    "",
    `**Project:** ${projectName}`,
    `**Task Type:** ${task.type || "feature"}`,
    `**Priority:** ${task.priority}`,
    `**Tags:** ${Array.isArray(task.tags) ? task.tags.join(", ") : "none"}`,
    "",
    "### Task Description",
    task.description || task.title,
    "",
    "### Screenshots Captured",
    screenshotPaths || "(no screenshots available)",
    "",
    "### Build Output (last 1500 chars)",
    "```",
    buildOutput || "(no output captured)",
    "```",
    "",
    "### Your Review Steps",
    "",
    "You are a Visual QA reviewer. Your job is to verify the UI changes look correct.",
    "",
    "1. **Read each screenshot file** listed above using `cat` or the Read tool — you can view images.",
    hasBeforeAfter
      ? "2. **Compare before/after** — check that the visual changes match the task description."
      : "2. **Inspect the after screenshot** — verify the UI matches what the task asked for.",
    "3. **Run `git diff HEAD~1`** — read through the UI-related changes (JSX, CSS, Tailwind classes, component structure).",
    "4. **Check for visual issues:**",
    "   - Layout regressions (overlapping elements, broken grids, misaligned text)",
    "   - Missing or broken UI elements (empty containers, broken images, placeholder text)",
    "   - Dark theme issues (unreadable text, missing dark variants, wrong background colors)",
    "   - Responsive concerns (hardcoded widths, overflow issues)",
    "   - Accessibility problems (missing alt text, low contrast, tiny click targets)",
    "5. **Run `npm run build 2>&1 | tail -80`** — the build MUST pass.",
    "",
    "### Verdict",
    "Output EXACTLY one of the following blocks at the very end of your response — nothing after it:",
    "",
    "If the UI looks correct, matches the task description, and has no visual regressions:",
    "VERDICT: APPROVED",
    "",
    "If there are visual issues, layout bugs, or the UI doesn't match what was asked:",
    "VERDICT: NEEDS_FIX",
    "NOTES:",
    "- [specific visual issue 1]",
    "- [specific visual issue 2]",
    "",
    "Only flag real visual defects. Do NOT flag style preferences or minor nits.",
    "DO fail the review if: UI doesn't match the task description, layout is broken, elements overlap,",
    "dark theme is unreadable, or the build fails.",
  ].join("\n");
}
