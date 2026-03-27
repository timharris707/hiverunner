import { NextResponse } from "next/server";
import { readReviews } from "../route";

export async function GET() {
  const data = await readReviews();
  const processedIds: string[] = (data.reviews ?? [])
    .filter((r: { takeaways?: unknown[] }) => Array.isArray(r.takeaways) && r.takeaways.length > 0)
    .map((r: { id: string }) => r.id);
  return NextResponse.json({ processedIds });
}
