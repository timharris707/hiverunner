import { NextResponse } from "next/server";

import { getAppBuildMetadata } from "@/lib/app-build-metadata";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getAppBuildMetadata());
}
