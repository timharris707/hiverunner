"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "dock-collapsed";
const EVENT_NAME = "dock-toggle";

function getInitial(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function useDockCollapsed() {
  const [collapsed, setCollapsed] = useState(getInitial);

  useEffect(() => {
    const handler = () => setCollapsed(getInitial());
    window.addEventListener(EVENT_NAME, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = !getInitial();
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(EVENT_NAME));
  }, []);

  return { collapsed, toggle };
}
