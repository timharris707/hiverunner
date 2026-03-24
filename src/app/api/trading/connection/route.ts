import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || "/Users/timharris/.openclaw/workspace";
const COINBASE_SECRETS = join(WORKSPACE, ".secrets", "coinbase.json");

export async function GET() {
  let coinbaseConfigured = false;
  let coinbaseKeyId: string | null = null;

  try {
    if (existsSync(COINBASE_SECRETS)) {
      const raw = readFileSync(COINBASE_SECRETS, "utf-8");
      const data = JSON.parse(raw);
      if (data.apiKey) {
        coinbaseConfigured = true;
        // Show last 12 chars of key ID only (safe)
        coinbaseKeyId = data.apiKey.slice(-12);
      }
    }
  } catch {
    // ignore
  }

  return NextResponse.json({
    coinbase: {
      configured: coinbaseConfigured,
      keyId: coinbaseKeyId,
      exchange: "coinbase",
    },
  });
}
