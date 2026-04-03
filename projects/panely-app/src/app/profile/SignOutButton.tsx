"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/auth/signin");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      style={{
        padding: "10px 20px",
        borderRadius: 8,
        border: "1px solid rgba(255,69,58,0.3)",
        background: "rgba(255,69,58,0.06)",
        color: "var(--negative)",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Sign out
    </button>
  );
}
