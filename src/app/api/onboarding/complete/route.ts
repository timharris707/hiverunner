import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  isSoftwareSetupComplete,
  markSoftwareSetupComplete,
  readOnboardingState,
  type OnboardingCompletionReason,
} from "@/lib/onboarding/onboarding-state";

export const dynamic = "force-dynamic";

const VALID_REASONS: ReadonlySet<OnboardingCompletionReason> = new Set([
  "created-workspace",
  "opened-existing",
  "skipped",
  "completed",
]);

function serialize(state: ReturnType<typeof readOnboardingState>) {
  return {
    complete: isSoftwareSetupComplete(state),
    softwareSetupCompletedAt: state.softwareSetupCompletedAt,
    completedVia: state.completedVia,
  };
}

export async function GET() {
  return NextResponse.json(serialize(readOnboardingState()));
}

export async function POST(request: NextRequest) {
  let via: OnboardingCompletionReason | undefined;
  try {
    const body = (await request.json()) as { via?: unknown } | null;
    if (body && typeof body.via === "string" && VALID_REASONS.has(body.via as OnboardingCompletionReason)) {
      via = body.via as OnboardingCompletionReason;
    }
  } catch {
    // Body is optional; an empty/invalid body simply marks completion with the
    // default reason.
  }

  const state = markSoftwareSetupComplete({ via });
  return NextResponse.json(serialize(state));
}
