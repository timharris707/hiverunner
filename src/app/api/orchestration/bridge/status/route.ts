import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { getBridgeStatus } from "@/lib/orchestration/bridge";
import { getOrchestrationExecutionProvider, isPaperclipBridgeEnabled } from "@/lib/orchestration/execution-provider";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!isPaperclipBridgeEnabled()) {
      return NextResponse.json({
        checkedAt: new Date().toISOString(),
        connection: {
          ok: false,
          error: {
            code: "bridge_disabled",
            message: "Paperclip bridge is disabled for current orchestration runtime",
            retriable: false,
          },
        },
        sync: {
          lastSyncedAt: null,
          paperclipTaskCount: 0,
          mappedTaskCount: 0,
        },
        mapping: {
          errorCount: 0,
          errors: [],
        },
        executionProvider: getOrchestrationExecutionProvider(),
      });
    }
    const status = await getBridgeStatus();
    return NextResponse.json(status);
  } catch (error) {
    return handleRouteError(error, "bridge-status:get");
  }
}
