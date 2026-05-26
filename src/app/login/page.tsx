import { Suspense } from "react";

import { getAuthMode } from "@/lib/auth/auth-mode";

import { LoginClient } from "./login-client";

function LoginFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#0a0a0f" }}>
      <div className="animate-pulse text-zinc-500">Loading...</div>
    </div>
  );
}

export default function LoginPage() {
  const authMode = getAuthMode();

  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginClient authMode={authMode} />
    </Suspense>
  );
}
