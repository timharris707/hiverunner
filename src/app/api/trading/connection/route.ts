import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || "/Users/timharris/.openclaw/workspace";
const COINBASE_SECRETS = join(WORKSPACE, ".secrets", "coinbase.json");
const WEATHER_TRADING_ENV = join(WORKSPACE, "projects", "weather-trading", ".env");

function parseEnvFile(filePath: string): Record<string, string> {
  try {
    if (!existsSync(filePath)) return {};
    const raw = readFileSync(filePath, "utf-8");
    const result: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

export async function GET() {
  // --- Coinbase ---
  let coinbaseConfigured = false;
  let coinbaseKeyId: string | null = null;

  try {
    if (existsSync(COINBASE_SECRETS)) {
      const raw = readFileSync(COINBASE_SECRETS, "utf-8");
      const data = JSON.parse(raw);
      if (data.apiKey) {
        coinbaseConfigured = true;
        coinbaseKeyId = data.apiKey.slice(-12);
      }
    }
  } catch {
    // ignore
  }

  // --- Kalshi + Polymarket (from weather-trading .env) ---
  const env = parseEnvFile(WEATHER_TRADING_ENV);

  const kalshiApiKey = env["KALSHI_API_KEY"] || "";
  const kalshiKeyPath = env["KALSHI_PRIVATE_KEY_PATH"] || "";
  const kalshiConfigured = kalshiApiKey.length > 0;

  const polymarketApiKey = env["POLYMARKET_API_KEY"] || "";
  const polymarketApiSecret = env["POLYMARKET_API_SECRET"] || "";
  const polymarketConfigured = polymarketApiKey.length > 0 && polymarketApiSecret.length > 0;

  return NextResponse.json({
    coinbase: {
      configured: coinbaseConfigured,
      keyId: coinbaseKeyId,
      exchange: "coinbase",
    },
    kalshi: {
      configured: kalshiConfigured,
      keyId: kalshiConfigured ? kalshiApiKey.slice(-8) : null,
      keyPath: kalshiKeyPath || null,
      exchange: "kalshi",
    },
    polymarket: {
      configured: polymarketConfigured,
      keyId: polymarketConfigured ? polymarketApiKey.slice(-8) : null,
      exchange: "polymarket",
    },
  });
}
