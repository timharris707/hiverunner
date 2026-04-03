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
    <html lang="en" className="dark">
      <body 
        className="font-sans"
        style={{ 
          backgroundColor: 'var(--background)', 
          color: 'var(--foreground)',
          fontFamily: 'var(--font-body)'
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
