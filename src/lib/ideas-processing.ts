interface TakeawayLike {
  status?: unknown;
  notes?: unknown;
  github_issue?: unknown;
}

export interface ReviewLike {
  [key: string]: unknown;
  status?: unknown;
  summary?: unknown;
  assessment?: unknown;
  takeaways?: unknown;
}

export function takeawayHasTask(takeaway: TakeawayLike) {
  const status = String(takeaway.status || "").toLowerCase();
  const notes = String(takeaway.notes || "");
  return (
    Boolean(takeaway.github_issue) ||
    /task created:/i.test(notes) ||
    ["approved", "building", "shipped"].includes(status)
  );
}

export function reviewIsFullyProcessed(review: ReviewLike) {
  const takeaways = Array.isArray(review.takeaways) ? review.takeaways as TakeawayLike[] : [];
  if (!review.summary || !review.assessment || takeaways.length === 0) {
    return false;
  }

  return takeaways.every((takeaway) => {
    const status = String(takeaway.status || "").toLowerCase();
    return status === "rejected" || takeawayHasTask(takeaway);
  });
}

export function getUnprocessedReviewIds<T extends ReviewLike>(reviews: T[]) {
  return reviews
    .filter((review) => String(review.status || "active").toLowerCase() === "active")
    .filter((review) => !reviewIsFullyProcessed(review));
}
