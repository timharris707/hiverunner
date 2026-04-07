"use client";

import { useState, useEffect } from "react";
import { Dock, TopBar, StatusBar } from "@/components/TenacitOS";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";
import { MissionControlRealtimeProvider, RealtimeStatusBanner } from "@/components/live/RealtimeProvider";
import { LiveStreamProvider } from "@/components/live/LiveStreamProvider";
import { NotificationProvider } from "@/components/notifications/NotificationToast";
import { DemoModeProvider } from "@/lib/demo-mode";
import { DOCK_WIDTH, DOCK_COLLAPSED_WIDTH } from "@/components/TenacitOS/Dock";
import { useDockCollapsed } from "@/lib/dock-state";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isMobile, setIsMobile] = useState(false);
  const { collapsed: dockCollapsed } = useDockCollapsed();

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <DemoModeProvider>
      <MissionControlRealtimeProvider>
        <LiveStreamProvider>
        <NotificationProvider>
        <div className="tenacios-shell" style={{ minHeight: "100vh" }}>
          <KeyboardShortcuts />
          <Dock />
          <TopBar />

          <main
            style={{
              marginLeft: isMobile ? 0 : `${dockCollapsed ? DOCK_COLLAPSED_WIDTH : DOCK_WIDTH}px`,
              marginTop: "48px", // Height of top bar
              marginBottom: isMobile ? "56px" : "32px", // mobile bottom nav vs status bar
              minHeight: "calc(100vh - 48px - 32px)",
              padding: isMobile ? "16px" : "12px 16px",
              overflow: "hidden", // contain children that use negative margins
            }}
          >
            <RealtimeStatusBanner />
            <PageBreadcrumbs />
            {children}
          </main>

          {!isMobile && <StatusBar />}
        </div>
      </NotificationProvider>
      </LiveStreamProvider>
      </MissionControlRealtimeProvider>
    </DemoModeProvider>
  );
}
