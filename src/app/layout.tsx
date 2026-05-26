import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3010"),
  title: "HiveRunner",
  description:
    "Agent-orchestration command center. Run, watch, and steer a swarm of AI agents across companies, projects, and runtimes.",
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
    title: "HiveRunner",
    description:
      "Agent-orchestration command center. Run, watch, and steer a swarm of AI agents across companies, projects, and runtimes.",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "HiveRunner",
    description: "Agent-orchestration command center.",
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#212020" },
    { media: "(prefers-color-scheme: light)", color: "#f7f5f0" },
  ],
};

const themeBootstrap = `(() => {
  try {
    const stored = localStorage.getItem('hiverunner.theme');
    const theme = stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : 'auto';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'auto');
  }
})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="auto" suppressHydrationWarning>
      <head>
        <script
          id="theme-bootstrap"
          dangerouslySetInnerHTML={{ __html: themeBootstrap }}
        />
      </head>
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
        <Script id="register-service-worker" strategy="afterInteractive">
          {`
            if ("serviceWorker" in navigator) {
              const isLocalDev = ["localhost", "127.0.0.1"].includes(location.hostname);
              if (isLocalDev) {
                navigator.serviceWorker.getRegistrations().then((regs) => {
                  regs.forEach((reg) => reg.unregister());
                });
                if (window.caches) {
                  caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
                }
              } else {
                navigator.serviceWorker.register("/sw.js");
              }
            }
          `}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
