import { NextResponse } from "next/server";
import { readReviews } from "../route";

function takeawayHasTask(takeaway: Record<string, unknown>) {
  const status = String(takeaway.status || "").toLowerCase();
  const notes = String(takeaway.notes || "");
  return (
    Boolean(takeaway.github_issue) ||
    /task created:/i.test(notes) ||
    ["approved", "building", "shipped"].includes(status)
  );
}

function reviewIsFullyProcessed(review: Record<string, unknown>) {
  const takeaways = Array.isArray(review.takeaways) ? review.takeaways as Record<string, unknown>[] : [];
  if (!review.summary || !review.assessment || takeaways.length === 0) {
    return false;
  }

  return takeaways.every((takeaway) => {
    const status = String(takeaway.status || "").toLowerCase();
    return status === "rejected" || takeawayHasTask(takeaway);
  });
}

export async function GET() {
  const data = await readReviews();
  const processedIds: string[] = (data.reviews ?? [])
    .filter((review: Record<string, unknown>) => reviewIsFullyProcessed(review))
    .map((review: { id: string }) => review.id);
  return NextResponse.json({ processedIds });
}
