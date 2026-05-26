export type ContentType = "tweet" | "linkedin" | "youtube-idea" | "blog-intro";
export type ContentPlatform = "x" | "linkedin" | "youtube" | "blog";
export type DraftStatus = "draft" | "approved" | "rejected" | "published";

export interface ContentDraft {
  id: string;
  type: ContentType;
  platform: ContentPlatform;
  topic: string;
  /** Main body text (tweet, linkedin post, blog intro, or youtube description) */
  content: string;
  /** Optional hashtags extracted from content */
  hashtags?: string[];
  /** For youtube-idea: video title */
  title?: string;
  /** For youtube-idea: suggested tags */
  videoTags?: string[];
  /** For youtube-idea: hook / thumbnail idea */
  hook?: string;
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
  /** Reviewer notes when rejecting */
  notes?: string;
  approvedAt?: string;
  publishedAt?: string;
}
