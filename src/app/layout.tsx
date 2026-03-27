import type { Metadata, Viewport } from "next";
import { Inter, Sora, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({ 
  subsets: ["latin"],
  variable: "--font-inter",
});

const sora = Sora({ 
  subsets: ["latin"],
  variable: "--font-sora",
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

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
        className={`${inter.variable} ${sora.variable} ${jetbrainsMono.variable} font-sans`}
        style={{ 
          backgroundColor: 'var(--background)', 
          color: 'var(--foreground)',
          fontFamily: 'var(--font-body)'
        }}
      >
        <Script id="register-service-worker" strategy="afterInteractive">
          {`if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js")`}
        </Script>
        {children}
      </body>
    </html>
  );
}
