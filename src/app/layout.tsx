import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harris Mission Control",
  description: "Harris Autonomous — Command center for the AI org",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1a1a2e",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" style={{ backgroundColor: "#2d2c2c", color: "#eae8e4" }}>
      <body 
        className="font-sans"
        style={{ 
          backgroundColor: "var(--background, #2d2c2c)", 
          color: "var(--foreground, #eae8e4)",
          fontFamily: 'var(--font-body, "Avenir Next", "Segoe UI", system-ui, sans-serif)',
          minHeight: "100vh"
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
        {children}
      </body>
    </html>
  );
}
