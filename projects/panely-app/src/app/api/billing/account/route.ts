import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  CREDIT_PACKS,
  FREE_SESSIONS_PER_MONTH,
  getOrCreateBillingAccount,
} from "@/lib/billing";

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const account = getOrCreateBillingAccount(user.id, user.email ?? undefined);
    return NextResponse.json({
      account,
      freeTier: { sessionsPerMonth: FREE_SESSIONS_PER_MONTH },
      packs: Object.values(CREDIT_PACKS),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

