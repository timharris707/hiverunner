import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      available: false,
      error: {
        code: "decart_browser_key_disabled",
        message:
          "Decart live avatar is disabled because the browser SDK path would expose DECART_API_KEY. Use the basic avatar fallback until a server-side adapter is available.",
      },
    },
    { status: 503 },
  );
}
