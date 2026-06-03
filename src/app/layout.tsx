import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3010"),
  title: "HiveRunner — Turn goals into AI-agent sprints",
  description:
    "Give your agents a goal; get back a finished sprint. HiveRunner turns a goal into a sprint plan, splits it into tasks, assigns your runners (Codex, Claude Code, Gemini), and keeps every result reviewable — on a lane you own.",
  alternates: {
    canonical: "/",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "HiveRunner — Turn goals into AI-agent sprints",
    description:
      "Give your agents a goal; get back a finished sprint. Plan, tasks, runners, execution, and review — automate the sprint, keep the review.",
    url: "/",
    siteName: "HiveRunner",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "HiveRunner — turn goals into AI-agent sprints",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "HiveRunner — Turn goals into AI-agent sprints",
    description: "Give your agents a goal; get back a finished sprint. Automate the sprint. Keep the review.",
    images: [
      {
        url: "/og-image.png",
        alt: "HiveRunner — turn goals into AI-agent sprints",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#212020" },
    { media: "(prefers-color-scheme: light)", color: "#f7f5f0" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="auto" suppressHydrationWarning>
      <body
        className="font-sans"
        style={{
          backgroundColor: "var(--bg)",
          color: "var(--text-primary)",
          fontFamily:
            'var(--font-body, "HR Sans", "Avenir Next", "Segoe UI", system-ui, sans-serif)',
          minHeight: "100vh",
        }}
      >
        <ServiceWorkerRegistration />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
