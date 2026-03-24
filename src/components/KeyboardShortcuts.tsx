"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const TOP_5_ROUTES = ["/", "/tasks", "/agents", "/trading", "/workflows"];

export function KeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (!cmdOrCtrl) return;

      // Cmd+T → New Task (navigate to tasks)
      if (e.key === "t" && !e.shiftKey && !e.altKey) {
        // Only if not in an input/textarea
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        router.push("/tasks");
        return;
      }

      // Cmd+1 through Cmd+5 → Navigate
      const num = parseInt(e.key);
      if (!isNaN(num) && num >= 1 && num <= 5) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        router.push(TOP_5_ROUTES[num - 1]);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  return null;
}
