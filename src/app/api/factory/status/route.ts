import { NextResponse } from "next/server.js";
import { getFactoryStatusSnapshot } from "@/lib/build-queue";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getFactoryStatusSnapshot());
}
