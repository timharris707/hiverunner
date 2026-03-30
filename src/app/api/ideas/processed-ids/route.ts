import { NextResponse } from "next/server";
import { getIdeasProcessedState } from "@/lib/ideas";

export async function GET() {
  return NextResponse.json(await getIdeasProcessedState());
}
