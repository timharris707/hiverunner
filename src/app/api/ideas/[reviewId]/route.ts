import { NextRequest, NextResponse } from "next/server";
import { readReviews, writeReviews } from "@/lib/ideas-store";

function hasReviewId(value: Record<string, unknown>): value is Record<string, unknown> & { id: string } {
  return typeof value.id === "string";
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const { reviewId } = await params;
  const body = await req.json();
  const data = await readReviews();

  const idx = data.reviews.findIndex((r) => hasReviewId(r) && r.id === reviewId);
  if (idx === -1) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  // Update allowed fields
  const allowed = ["status", "rating", "summary", "assessment"];
  for (const key of allowed) {
    if (key in body) {
      data.reviews[idx][key] = body[key];
    }
  }

  data.meta.last_updated = new Date().toISOString();
  await writeReviews(data);
  return NextResponse.json(data.reviews[idx]);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const { reviewId } = await params;
  const data = await readReviews();

  const idx = data.reviews.findIndex((r) => hasReviewId(r) && r.id === reviewId);
  if (idx === -1) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  data.reviews.splice(idx, 1);
  data.meta.last_updated = new Date().toISOString();
  data.meta.total_reviews = data.reviews.length;
  await writeReviews(data);
  return NextResponse.json({ success: true });
}
