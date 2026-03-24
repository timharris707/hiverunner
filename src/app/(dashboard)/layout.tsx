"use client";

import { useState, useEffect } from "react";
import { Dock, TopBar, StatusBar } from "@/components/TenacitOS";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <div className="tenacios-shell" style={{ minHeight: "100vh" }}>
      <KeyboardShortcuts />
      <Dock />
      <TopBar />
      
      <main
        style={{
          marginLeft: isMobile ? 0 : "168px", // dock is side on desktop, bottom on mobile
          marginTop: "48px", // Height of top bar
          marginBottom: isMobile ? "56px" : "32px", // mobile bottom nav vs status bar
          minHeight: "calc(100vh - 48px - 32px)",
          padding: isMobile ? "16px" : "24px",
        }}
      >
        {children}
      </main>

      {!isMobile && <StatusBar />}
    </div>
  );
}
