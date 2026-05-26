import { readReviews } from "@/lib/ideas-store";
import { getUnprocessedReviewIds, reviewIsFullyProcessed, type ReviewLike } from "@/lib/ideas-processing";

export async function getIdeasProcessedState() {
  const data = await readReviews();
  const reviews = (data.reviews ?? []) as Array<ReviewLike & { id: string }>;
  const processedIds = reviews.filter((review) => reviewIsFullyProcessed(review)).map((review) => review.id);
  const unprocessedIds = getUnprocessedReviewIds(reviews).map((review) => review.id);

  return {
    processedIds,
    unprocessedIds,
    unprocessedCount: unprocessedIds.length,
  };
}
