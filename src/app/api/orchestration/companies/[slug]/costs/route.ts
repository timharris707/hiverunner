import { NextRequest, NextResponse } from "next/server";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import {
  createCompanyFinanceEvent,
  listCompanyCostLedger,
  type CostTimeframe,
  type CreateFinanceEventInput,
} from "@/lib/orchestration/cost-ledger";

export const dynamic = "force-dynamic";

function parseTimeframe(value: string | null): CostTimeframe {
  if (value === "7d" || value === "30d" || value === "90d" || value === "ytd" || value === "all") return value;
  return "mtd";
}

const FINANCE_EVENT_TYPES = new Set(["usage", "subscription", "credit", "adjustment", "manual"]);

function parseFinanceEventInput(body: Record<string, unknown>): CreateFinanceEventInput {
  const eventType = typeof body.eventType === "string" ? body.eventType.trim().toLowerCase() : "";
  if (!FINANCE_EVENT_TYPES.has(eventType)) {
    throw new OrchestrationApiError(400, "invalid_finance_event_type", "Invalid finance event type");
  }

  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new OrchestrationApiError(400, "invalid_finance_amount", "Finance event amount must be non-zero");
  }

  const biller = typeof body.biller === "string" ? body.biller.trim() : "";
  if (!biller) {
    throw new OrchestrationApiError(400, "missing_biller", "Finance event biller is required");
  }

  return {
    provider: typeof body.provider === "string" ? body.provider : undefined,
    biller,
    eventType: eventType as CreateFinanceEventInput["eventType"],
    amount,
    currency: typeof body.currency === "string" ? body.currency : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    periodStart: typeof body.periodStart === "string" ? body.periodStart : null,
    periodEnd: typeof body.periodEnd === "string" ? body.periodEnd : null,
    occurredAt: typeof body.occurredAt === "string" ? body.occurredAt : undefined,
    metadata:
      typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
        ? body.metadata as Record<string, unknown>
        : {},
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const timeframe = parseTimeframe(req.nextUrl.searchParams.get("timeframe"));
    return NextResponse.json(listCompanyCostLedger(slug, timeframe));
  } catch (error) {
    if (error instanceof OrchestrationApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[company-costs:get] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await req.json() as Record<string, unknown>;
    const event = createCompanyFinanceEvent(slug, parseFinanceEventInput(body));
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    if (error instanceof OrchestrationApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[company-costs:post] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
