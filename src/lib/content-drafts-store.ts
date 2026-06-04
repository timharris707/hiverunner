import fs from "fs";
import path from "path";
import type { ContentDraft } from "@/types/content";

const DRAFTS_FILE = path.join(process.cwd(), "data", "content-drafts.json");

export function loadContentDrafts(): ContentDraft[] {
  try {
    if (!fs.existsSync(DRAFTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(DRAFTS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

export function saveContentDrafts(drafts: ContentDraft[]): void {
  fs.writeFileSync(DRAFTS_FILE, JSON.stringify(drafts, null, 2));
}
