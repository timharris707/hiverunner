import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Set up HiveRunner",
  description: "One-time local-first software setup for HiveRunner.",
};

/**
 * Deliberately minimal. The first-run software setup wizard lives OUTSIDE the
 * `(dashboard)` route group so it never mounts the Dock, agent activity panel,
 * realtime/live-stream/notification providers, or any snapshot polling. The
 * only ambient context is the ThemeProvider from the root layout.
 */
export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-[100dvh] w-full"
      style={{ backgroundColor: "var(--bg)", color: "var(--text-primary)" }}
    >
      {children}
    </div>
  );
}
