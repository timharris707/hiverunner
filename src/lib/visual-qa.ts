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
 * Build the visual QA checklist that Gater must complete for every UI task.
 * If Gater cannot complete this checklist (e.g. no dev server), the task MUST be BLOCKED.
 */
export function buildVisualQAChecklist(): string {
  return [
    "### 📋 Visual QA Checklist (MANDATORY for UI tasks)",
    "",
    "You MUST complete ALL of the following visual verification steps for this UI task.",
    "If you cannot capture or view screenshots (e.g. dev server not running, Playwright unavailable),",
    "you MUST issue `VERDICT: BLOCKED` — do NOT approve without visual verification.",
    "",
    "#### Screenshot Capture",
    "- [ ] Capture Chromium screenshot: `npx playwright screenshot --browser=chromium http://localhost:3010 /tmp/gater-chromium.png`",
    "- [ ] Capture WebKit (Safari) screenshot: `npx playwright screenshot --browser=webkit http://localhost:3010 /tmp/gater-webkit.png`",
    "- [ ] Read both screenshots and confirm they rendered (not blank/error pages)",
    "",
    "#### API Data vs UI Display Comparison",
    "- [ ] Identify the API endpoint(s) that feed this page (check the component source for fetch/API calls)",
    "- [ ] Curl or read the API response data (e.g. `curl -s http://localhost:3010/api/tasks | head -100`)",
    "- [ ] Compare: does the UI display match the API data? Correct counts, correct labels, correct values?",
    "- [ ] Check for phantom elements — items rendered in UI that do NOT exist in API data",
    "- [ ] Check for missing elements — items in API data that are NOT rendered in UI",
    "",
    "#### Visual Correctness",
    "- [ ] Cards/items appear in the correct columns/sections (not misplaced)",
    "- [ ] Counts and badges match the actual number of items displayed",
    "- [ ] Labels, tooltips, and status indicators render correctly",
    "- [ ] No overlapping elements, broken layouts, or clipped text",
    "- [ ] Dark mode renders properly (text readable, correct backgrounds)",
    "- [ ] Cross-browser: no layout differences between Chromium and WebKit screenshots",
    "",
    "**If ANY checklist item fails → VERDICT: NEEDS_FIX with specific items that failed.**",
    "**If you CANNOT capture screenshots → VERDICT: BLOCKED with reason.**",
    "",
  ].join("\n");
}

/**
 * Check whether Gater's QA output contains evidence of visual verification.
 * Returns true if the output indicates screenshots were captured and reviewed.
 */
export function hasVisualVerificationEvidence(output: string): boolean {
  const lowerOutput = output.toLowerCase();

  // Look for evidence of screenshot capture or viewing
  const captureEvidence = [
    "screenshot",
    "chromium",
    "webkit",
    "/tmp/gater-chromium",
    "/tmp/gater-webkit",
    "playwright screenshot",
    "captured screenshot",
    "visual verification",
    "visual qa checklist",
  ];

  const hasCaptureEvidence = captureEvidence.some((term) => lowerOutput.includes(term));

  // Look for evidence of API-to-UI comparison
  const comparisonEvidence = [
    "api data",
    "api response",
    "matches the",
    "phantom element",
    "missing element",
    "correct count",
    "counts match",
    "columns show",
    "cards appear",
    "rendered correctly",
    "ui display",
    "display match",
  ];

  const hasComparisonEvidence = comparisonEvidence.some((term) => lowerOutput.includes(term));

  return hasCaptureEvidence && hasComparisonEvidence;
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
