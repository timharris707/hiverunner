"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

const TOP_5_ROUTES = ["/", "/companies/new", "/systems/companies", "/terminal", "/logs"];

// Custom event for opening new task modal when on /tasks page
export const OPEN_NEW_TASK_EVENT = "hiverunner:open-new-task";

export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (!cmdOrCtrl) return;

      // Skip if in input/textarea/contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) return;

      // Cmd+T → New Task (open modal if on /tasks, else navigate there)
      if (e.key === "t" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (pathname === "/tasks") {
          window.dispatchEvent(new CustomEvent(OPEN_NEW_TASK_EVENT));
        } else {
          router.push("/tasks");
        }
        return;
      }

      // Cmd+1 through Cmd+5 → Navigate to top 5 pages
      const num = parseInt(e.key);
      if (!isNaN(num) && num >= 1 && num <= 5) {
        e.preventDefault();
        router.push(TOP_5_ROUTES[num - 1]);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router, pathname]);

  return null;
}
