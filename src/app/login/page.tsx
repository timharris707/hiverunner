"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Terminal, Lock, AlertCircle, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);
    const redirectTo = `${window.location.origin}/auth/callback?next=${searchParams.get("from") || "/"}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
      }

      const from = searchParams.get("from") || "/";
      router.push(from);
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: "var(--bg, #0a0a0f)" }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8"
        style={{
          backgroundColor: "var(--card, #12121a)",
          border: "1px solid var(--border, #1e1e2e)",
        }}
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{ backgroundColor: "#4ade8020", border: "1px solid #4ade8040" }}
          >
            <Terminal className="w-8 h-8" style={{ color: "#4ade80" }} />
          </div>
          <h1
            className="text-2xl font-bold"
            style={{
              fontFamily: "var(--font-heading, system-ui)",
              color: "var(--text-primary, #e4e4e7)",
              letterSpacing: "-0.5px",
            }}
          >
            Never Idle
          </h1>
          <p
            className="text-sm mt-1"
            style={{ color: "var(--text-muted, #71717a)" }}
          >
            Mission Control — Harris Autonomous
          </p>
        </div>

        {/* Error */}
        {error && (
          <div
            className="flex items-center gap-2 p-3 rounded-lg mb-4 text-sm"
            style={{ backgroundColor: "#ef444420", color: "#f87171", border: "1px solid #ef444430" }}
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Google OAuth */}
        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50 mb-4"
          style={{
            backgroundColor: "#ffffff",
            color: "#1f2937",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
          </svg>
          {loading ? "Signing in..." : "Sign in with Google"}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px" style={{ backgroundColor: "var(--border, #1e1e2e)" }} />
          <span className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted, #71717a)" }}>
            or
          </span>
          <div className="flex-1 h-px" style={{ backgroundColor: "var(--border, #1e1e2e)" }} />
        </div>

        {/* Email/Password */}
        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div>
            <label
              className="block text-xs font-medium mb-1.5 uppercase tracking-wider"
              style={{ color: "var(--text-muted, #71717a)" }}
            >
              Email
            </label>
            <div className="relative">
              <Mail
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                style={{ color: "var(--text-muted, #71717a)" }}
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none transition-all"
                style={{
                  backgroundColor: "var(--card-elevated, #1a1a25)",
                  border: "1px solid var(--border, #1e1e2e)",
                  color: "var(--text-primary, #e4e4e7)",
                }}
              />
            </div>
          </div>

          <div>
            <label
              className="block text-xs font-medium mb-1.5 uppercase tracking-wider"
              style={{ color: "var(--text-muted, #71717a)" }}
            >
              Password
            </label>
            <div className="relative">
              <Lock
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                style={{ color: "var(--text-muted, #71717a)" }}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none transition-all"
                style={{
                  backgroundColor: "var(--card-elevated, #1a1a25)",
                  border: "1px solid var(--border, #1e1e2e)",
                  color: "var(--text-primary, #e4e4e7)",
                }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50"
            style={{
              backgroundColor: "#4ade8020",
              color: "#4ade80",
              border: "1px solid #4ade8040",
              cursor: loading ? "wait" : "pointer",
            }}
          >
            {loading ? "Signing in..." : mode === "signin" ? "Sign in with Email" : "Create Account"}
          </button>
        </form>

        {/* Footer */}
        <p
          className="text-center text-xs mt-6"
          style={{ color: "var(--text-muted, #71717a)" }}
        >
          Invite-only access · Contact admin for an account
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#0a0a0f" }}>
          <div className="animate-pulse text-zinc-500">Loading...</div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
