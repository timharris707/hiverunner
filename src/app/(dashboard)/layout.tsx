"use client";

import { useState, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Dock, TopBar } from "@/components/HiveRunnerShell";
import { AgentActivityPanel } from "@/components/agents/AgentActivityPanel";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { HiveRunnerRealtimeProvider, RealtimeStatusBanner } from "@/components/live/RealtimeProvider";
import { LiveStreamProvider } from "@/components/live/LiveStreamProvider";
import { NotificationProvider } from "@/components/notifications/NotificationToast";
import { DemoModeProvider } from "@/lib/demo-mode";
import { DOCK_WIDTH, DOCK_COLLAPSED_WIDTH } from "@/components/HiveRunnerShell/Dock";
import { useDockCollapsed } from "@/lib/dock-state";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isMobile, setIsMobile] = useState(false);
  const { collapsed: dockCollapsed } = useDockCollapsed();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const isInboxRoute = /(?:^|\/)inbox(?:\/|$)/.test(pathname);
  const isGoalDetailRoute = /(?:^|\/)goals\/[^/]+(?:\/|$)/.test(pathname);
  const isFullViewportRoute = isInboxRoute || isGoalDetailRoute;
  const mainHeight = `calc(100dvh - 48px - ${isMobile ? "56px" : "0px"})`;

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
  }, [pathname, search]);

  useEffect(() => {
    if (!isFullViewportRoute) return;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    window.scrollTo(0, 0);

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, [isFullViewportRoute]);

  return (
    <DemoModeProvider>
      <HiveRunnerRealtimeProvider>
        <LiveStreamProvider>
        <NotificationProvider>
        <div className="tenacios-shell" style={{ minHeight: "100dvh", height: isFullViewportRoute ? "100dvh" : undefined, overflow: isFullViewportRoute ? "hidden" : undefined }}>
          <KeyboardShortcuts />
          <Dock />
          <TopBar />
          <AgentActivityPanel />

          <main
            style={{
              marginLeft: isMobile ? 0 : `${dockCollapsed ? DOCK_COLLAPSED_WIDTH : DOCK_WIDTH}px`,
              marginTop: "48px", // Height of top bar
              marginBottom: isMobile ? "56px" : 0, // mobile bottom nav only
              minHeight: mainHeight,
              height: isFullViewportRoute ? mainHeight : undefined,
              maxHeight: isFullViewportRoute ? mainHeight : undefined,
              padding: isMobile ? "16px" : "12px 16px",
              boxSizing: "border-box",
              overflow: "hidden", // contain children that use negative margins
            }}
          >
            <RealtimeStatusBanner />
            {children}
          </main>
        </div>
      </NotificationProvider>
      </LiveStreamProvider>
      </HiveRunnerRealtimeProvider>
    </DemoModeProvider>
  );
}
