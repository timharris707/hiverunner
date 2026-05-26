"use client";

import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Lock, Mail } from "lucide-react";

import type { AuthMode } from "@/lib/auth/auth-mode";
import { createClient, isSupabaseBrowserConfigured } from "@/lib/supabase/client";

function HiveRunnerLoginMark() {
  return (
    <div
      className="inline-flex h-16 w-16 items-center justify-center rounded-lg mb-4"
      style={{
        backgroundColor: "var(--accent-soft, rgba(217,119,6,0.10))",
        border: "0.5px solid color-mix(in srgb, var(--accent, #d97706) 38%, var(--border, rgba(222,220,209,0.12)))",
      }}
    >
      <Image
        src="/logo-mark-standalone.svg"
        alt=""
        aria-hidden="true"
        width={44}
        height={44}
        className="h-11 w-11"
      />
    </div>
  );
}

type LocalCompanyListResponse = {
  companies?: Array<{ slug?: string; code?: string }>;
};

function safeLocalReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

async function resolveLocalOwnerReturnPath(value: string | null): Promise<string> {
  const requested = safeLocalReturnPath(value);
  const response = await fetch("/api/orchestration/companies", { cache: "no-store" });
  if (!response.ok) return requested;

  const payload = await response.json().catch(() => ({})) as LocalCompanyListResponse;
  const companies = Array.isArray(payload.companies) ? payload.companies : [];
  const first = companies.find((company) => company.slug || company.code);
  if (!first) return requested;

  const firstCode = (first.code || first.slug || "").trim();
  const fallback = firstCode ? `/${encodeURIComponent(firstCode)}/dashboard` : "/";
  const segments = requested.split("/").filter(Boolean);
  if (segments.length === 0) return fallback;

  const requestedCompany = decodeURIComponent(segments[0] ?? "");
  if (requestedCompany === "companies" && segments[1]) {
    const requestedSlug = decodeURIComponent(segments[1]);
    const slugAllowed = companies.some((company) => company.slug === requestedSlug);
    return slugAllowed ? requested : fallback;
  }

  const appRoots = new Set(["api", "auth", "_next", "login"]);
  if (appRoots.has(requestedCompany.toLowerCase())) return requested;

  const codeAllowed = companies.some((company) => company.code?.toUpperCase() === requestedCompany.toUpperCase());
  return codeAllowed ? requested : fallback;
}

function LoginShell({ children }: { children: ReactNode }) {
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
        {children}
      </div>
    </div>
  );
}

function LoginHeader({ subtitle }: { subtitle: string }) {
  return (
    <div className="text-center mb-8">
      <HiveRunnerLoginMark />
      <h1
        className="text-2xl font-bold"
        style={{
          fontFamily: "var(--font-heading, system-ui)",
          color: "var(--text-primary, #e4e4e7)",
          letterSpacing: 0,
        }}
      >
        HiveRunner
      </h1>
      <p
        className="text-sm mt-1"
        style={{ color: "var(--text-muted, #71717a)" }}
      >
        {subtitle}
      </p>
    </div>
  );
}

function LoginError({ error }: { error: string }) {
  if (!error) return null;

  return (
    <div
      className="flex items-center gap-2 p-3 rounded-lg mb-4 text-sm"
      style={{ backgroundColor: "#ef444420", color: "#f87171", border: "1px solid #ef444430" }}
    >
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      {error}
    </div>
  );
}

function LocalSingleUserLoginCard() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleContinue = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/local-dev/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data?.error ?? "Could not start local session");
      }
      const from = await resolveLocalOwnerReturnPath(searchParams.get("from"));
      router.push(from);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start local session");
    } finally {
      setLoading(false);
    }
  };

  return (
    <LoginShell>
      <LoginHeader subtitle="Local-first install - single owner" />
      <LoginError error={error} />
      <p
        className="text-sm mb-6"
        style={{ color: "var(--text-muted, #71717a)" }}
      >
        This install runs in local-single-user mode. No external auth provider is required.
        Continue as the local owner, or switch to Supabase auth when you are ready for a hosted multi-user deployment.
      </p>

      <button
        onClick={handleContinue}
        disabled={loading}
        className="w-full py-3 px-4 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50"
        style={{
          backgroundColor: "var(--accent, #d97706)",
          color: "var(--accent-foreground, #1a1716)",
          border: "0.5px solid var(--accent-hover, #e5860a)",
          cursor: loading ? "wait" : "pointer",
        }}
      >
        {loading ? "Starting session..." : "Continue as owner"}
      </button>
    </LoginShell>
  );
}

function SupabaseConfigurationCard() {
  return (
    <LoginShell>
      <LoginHeader subtitle="Hosted auth setup" />
      <div
        className="flex items-start gap-2 p-3 rounded-lg mb-4 text-sm"
        style={{ backgroundColor: "#ef444420", color: "#f87171", border: "1px solid #ef444430" }}
      >
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          HiveRunner is set to Supabase auth, but the browser Supabase credentials are missing.
          Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or use local-single-user mode for local installs.
        </span>
      </div>
    </LoginShell>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const showLocalDevAccess = process.env.NODE_ENV === "development";
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const continueToRequestedPage = () => {
    const from = searchParams.get("from") || "/";
    router.push(from);
    router.refresh();
  };

  const continueToLocalOwnerPage = async () => {
    const from = await resolveLocalOwnerReturnPath(searchParams.get("from"));
    router.push(from);
    router.refresh();
  };

  const handleLocalDevLogin = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/local-dev/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoProvision: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data?.error ?? "Could not start local development session");
      }
      await continueToLocalOwnerPage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start local development session");
    } finally {
      setLoading(false);
    }
  };

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

  const handleEmailLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;

      continueToRequestedPage();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <LoginShell>
      <LoginHeader subtitle="Hosted auth" />
      <LoginError error={error} />

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

      {showLocalDevAccess && (
        <button
          type="button"
          onClick={handleLocalDevLogin}
          disabled={loading}
          className="w-full py-3 px-4 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50"
          style={{
            backgroundColor: "var(--accent, #d97706)",
            color: "var(--accent-foreground, #1a1716)",
            border: "0.5px solid var(--accent-hover, #e5860a)",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Starting session..." : "Continue as owner"}
        </button>
      )}

      <div className="flex items-center gap-3 my-5">
        <div className="flex-1 h-px" style={{ backgroundColor: "var(--border, #1e1e2e)" }} />
        <span className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted, #71717a)" }}>
          or
        </span>
        <div className="flex-1 h-px" style={{ backgroundColor: "var(--border, #1e1e2e)" }} />
      </div>

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
              autoComplete="email"
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
              autoComplete="current-password"
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
            backgroundColor: "var(--accent, #d97706)",
            color: "var(--accent-foreground, #1a1716)",
            border: "0.5px solid var(--accent-hover, #e5860a)",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Signing in..." : "Sign in with Email"}
        </button>
      </form>

      <p
        className="text-center text-xs mt-6"
        style={{ color: "var(--text-muted, #71717a)" }}
      >
        Invite-only access - contact admin for an account
      </p>
    </LoginShell>
  );
}

export function LoginClient({ authMode }: { authMode: AuthMode }) {
  if (authMode === "local-single-user") {
    return <LocalSingleUserLoginCard />;
  }

  if (!isSupabaseBrowserConfigured()) {
    return <SupabaseConfigurationCard />;
  }

  return <LoginForm />;
}
