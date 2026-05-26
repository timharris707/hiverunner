import { NextRequest, NextResponse } from "next/server";

import {
  handleHiveRunnerSymphonyTrackerRequest,
  type HiveRunnerSymphonyTrackerResponse,
} from "@/lib/orchestration/symphony/tracker-shim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function configuredToken(): string | undefined {
  const token = process.env.HIVERUNNER_SYMPHONY_TRACKER_TOKEN?.trim();
  return token || undefined;
}

function requestToken(req: NextRequest): string | undefined {
  const bearer = req.headers.get("authorization")?.trim();
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    const token = bearer.slice("bearer ".length).trim();
    if (token) return token;
  }
  return req.headers.get("x-hiverunner-symphony-token")?.trim() || undefined;
}

function authFailure(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "tracker_auth_error",
        message: "Invalid or missing external runner tracker token.",
      },
    },
    { status: 401 },
  );
}

function requireTrackerAuth(req: NextRequest): NextResponse | undefined {
  const expected = configuredToken();
  if (!expected) return undefined;
  return requestToken(req) === expected ? undefined : authFailure();
}

function responseStatus(response: HiveRunnerSymphonyTrackerResponse): number {
  if (response.ok) return 200;
  if (response.error.message.includes("disabled")) return 403;
  return 400;
}

export async function GET() {
  const response = handleHiveRunnerSymphonyTrackerRequest({ operation: "health" });
  const result = response.ok && response.result && typeof response.result === "object"
    ? {
        ...response,
        result: {
          ...response.result,
          transport: "http",
          authRequired: Boolean(configuredToken()),
        },
      }
    : response;
  return NextResponse.json(result, { status: responseStatus(response) });
}

export async function POST(req: NextRequest) {
  const auth = requireTrackerAuth(req);
  if (auth) return auth;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "tracker_json_error",
          message: "Tracker request body must be valid JSON.",
        },
      },
      { status: 400 },
    );
  }

  const response = handleHiveRunnerSymphonyTrackerRequest(payload);
  return NextResponse.json(response, { status: responseStatus(response) });
}
