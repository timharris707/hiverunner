"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Analytics has been merged into Reports (/reports) with tabs.
// This page redirects to maintain any old links.
export default function AnalyticsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/reports");
  }, [router]);
  return null;
}
