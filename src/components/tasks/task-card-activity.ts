import { getOperationalStatusTag } from "@/lib/orchestration/comment-visibility";

export type TaskCardComment = {
  text: string;
  timestamp: string;
  author?: string | null;
  type?: string | null;
  source?: string | null;
};

type TaskCardActivityLabelInput = {
  status?: string;
  displayAgentName?: string | null;
  latestCommentAuthor?: string | null;
  latestCommentText?: string | null;
  updatedRelativeLabel?: string | null;
};

export function isReviewActivityText(text?: string | null): boolean {
  const normalized = (text ?? "")
    .trim()
    .replace(/^\*\*/, "")
    .trim()
    .toLowerCase();
  return (
    normalized.startsWith("review:") ||
    normalized.startsWith("review decision:") ||
    normalized.startsWith("qa review") ||
    normalized.includes(" review passed")
  );
}

export function taskCardActivityLabel(input: TaskCardActivityLabelInput): string | null {
  const displayAgentName = input.displayAgentName?.trim();
  const updatedRelativeLabel = input.updatedRelativeLabel?.trim();
  if (!displayAgentName || !updatedRelativeLabel) return null;

  const latestCommentAuthor = input.latestCommentAuthor?.trim();
  if (input.status === "done" && isReviewActivityText(input.latestCommentText)) {
    const reviewerSuffix =
      latestCommentAuthor && latestCommentAuthor.toLowerCase() !== displayAgentName.toLowerCase()
        ? ` · reviewed by ${latestCommentAuthor}`
        : "";
    return `${displayAgentName} completed this task${reviewerSuffix} · ${updatedRelativeLabel}`;
  }

  return `${displayAgentName} updated this task · ${updatedRelativeLabel}`;
}

export function selectPrimaryTaskUpdateComment(comments?: TaskCardComment[] | null): TaskCardComment | undefined {
  return (comments ?? [])
    .filter((comment) => comment.text.trim())
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .find((comment) => !isOperationalPrimaryUpdateComment(comment));
}

function isOperationalPrimaryUpdateComment(comment: TaskCardComment): boolean {
  const tag = getOperationalStatusTag(comment);
  if (tag && tag !== "OPERATIONAL") return true;

  const source = comment.source?.trim().toLowerCase();
  const type = comment.type?.trim().toLowerCase();
  return source === "engine" && type !== "comment" && type !== "review" && type !== "blocker";
}
