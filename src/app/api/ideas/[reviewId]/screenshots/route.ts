import { NextRequest, NextResponse } from "next/server";
import { readReviews, writeReviews } from "@/lib/ideas-store";
import { resolveOpenClawDir } from "@/lib/workspaces/root";
import {
  captureScreenshots,
  getScreenshots,
  saveScreenshotMeta,
  formatTimestamp,
} from "@/lib/youtube-screenshots";

function hasReviewId(review: Record<string, unknown>, reviewId: string) {
  return typeof review.id === "string" && review.id === reviewId;
}

/**
 * GET /api/ideas/[reviewId]/screenshots
 * Returns the list of captured screenshots for a review.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const { reviewId } = await params;

  const screenshots = await getScreenshots(reviewId);
  if (!screenshots) {
    return NextResponse.json({ screenshots: [], captured: false });
  }

  const mediaBase = `/api/media${
    resolveOpenClawDir()
  }/media/screenshots/${reviewId}`;

  return NextResponse.json({
    screenshots: screenshots.map((s) => ({
      ...s,
      url: `${mediaBase}/${s.filename}`,
      formattedTime: formatTimestamp(s.timestamp),
    })),
    captured: true,
  });
}

/**
 * POST /api/ideas/[reviewId]/screenshots
 * Triggers screenshot capture for a YouTube review.
 * Body: { interval?: number } (default: 30 seconds)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const { reviewId } = await params;

  const data = await readReviews();
  const review = data.reviews.find((r) => hasReviewId(r, reviewId));
  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  const reviewUrl = typeof review.url === "string" ? review.url : "";
  if (review.type !== "youtube" || !reviewUrl) {
    return NextResponse.json(
      { error: "Not a YouTube review" },
      { status: 400 }
    );
  }

  let interval = 30;
  try {
    const body = await req.json();
    if (body.interval && typeof body.interval === "number") {
      interval = Math.max(10, Math.min(120, body.interval));
    }
  } catch {
    // No body or invalid JSON — use defaults
  }

  try {
    const result = await captureScreenshots(reviewUrl, reviewId, interval);
    await saveScreenshotMeta(result);

    // Update the review record with screenshot count
    const idx = data.reviews.findIndex((r) => hasReviewId(r, reviewId));
    if (idx !== -1) {
      const mutableReview = data.reviews[idx];
      if (mutableReview) {
        mutableReview.screenshot_count = result.screenshots.length;
      }
      data.meta.last_updated = new Date().toISOString();
      await writeReviews(data);
    }

    const mediaBase = `/api/media${
      resolveOpenClawDir()
    }/media/screenshots/${reviewId}`;

    return NextResponse.json({
      success: true,
      count: result.screenshots.length,
      screenshots: result.screenshots.map((s) => ({
        ...s,
        url: `${mediaBase}/${s.filename}`,
        formattedTime: formatTimestamp(s.timestamp),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Screenshot capture failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
