import { NextResponse } from "next/server";

import { COMPANY_WIZARD_MODEL_FALLBACK } from "@/lib/orchestration/company-wizard";
import {
  leadDefaultFromProbeOutcome,
  resolveLeadModelDefault,
} from "@/lib/orchestration/lead-model-default";

export const dynamic = "force-dynamic";

export async function GET() {
  // The servability probe runs a real one-token generation against the
  // subscription CLI (cached); if it throws unexpectedly, degrade to the
  // provider fallback rather than failing the wizard's model list.
  const leadDefault = await resolveLeadModelDefault().catch(() => leadDefaultFromProbeOutcome("cli_missing"));
  return NextResponse.json({
    models: COMPANY_WIZARD_MODEL_FALLBACK,
    leadDefault,
    source: "hiverunner",
    count: COMPANY_WIZARD_MODEL_FALLBACK.length,
  });
}
