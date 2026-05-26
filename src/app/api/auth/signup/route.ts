import { NextResponse } from "next/server";

// Public self-service signup is disabled. Accounts are admin-provisioned.
// This handler intentionally exists (instead of relying on Next.js routing
// absence) so any client or test reaching /api/auth/signup gets a stable,
// explicit 403 — and so future code cannot accidentally re-enable signup
// without overwriting this file.

const PAYLOAD = {
  success: false,
  error: "Signup is disabled. Accounts are admin-provisioned.",
} as const;

export async function POST() {
  return NextResponse.json(PAYLOAD, { status: 403 });
}

export async function GET() {
  return NextResponse.json(PAYLOAD, { status: 403 });
}

export async function PUT() {
  return NextResponse.json(PAYLOAD, { status: 403 });
}

export async function PATCH() {
  return NextResponse.json(PAYLOAD, { status: 403 });
}

export async function DELETE() {
  return NextResponse.json(PAYLOAD, { status: 403 });
}
