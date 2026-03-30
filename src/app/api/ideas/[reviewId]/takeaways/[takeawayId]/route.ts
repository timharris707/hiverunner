import { NextRequest, NextResponse } from "next/server";
import { readReviews, writeReviews } from "@/lib/ideas-store";

interface Takeaway {
  id: string;
  status: string;
  notes: string;
  [key: string]: unknown;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ reviewId: string; takeawayId: string }> }
) {
  const { reviewId, takeawayId } = await params;
  const body = await req.json();
  const data = await readReviews();

  const review = data.reviews.find((r: { id: string }) => r.id === reviewId);
  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  const tw = review.takeaways.find((t: Takeaway) => t.id === takeawayId);
  if (!tw) {
    return NextResponse.json({ error: "Takeaway not found" }, { status: 404 });
  }

  // Update allowed fields
  const allowed = ["status", "notes", "priority", "assigned_to"];
  for (const key of allowed) {
    if (key in body) {
      tw[key] = body[key];
    }
  }

  data.meta.last_updated = new Date().toISOString();
  await writeReviews(data);
  return NextResponse.json(tw);
}
