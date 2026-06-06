"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";

import { COMPANY_CODE_TO_SLUG } from "@/lib/orchestration/edge-route-maps";

const NON_COMPANY_ROOTS = new Set([
  "api",
  "auth",
  "_next",
  "login",
  "projects",
  "ideas",
  "marketing",
  "voice",
  "terminal",
  "sessions",
  "logs",
  "search",
  "settings",
  "skills",
  "workflows",
  "system",
  "office",
  "monitoring",
  "reliability",
  "reports",
  "memory",
  "files",
  "git",
  "cron",
  "factory",
  "org",
  "tasks",
  "agents",
]);

export type OverseerCompanyRoute = {
  companyParam: string;
  storageCompanyKey: string;
  routeKind: "company-prefix" | "root-company";
  isFullOverseerRoute: boolean;
  pathname: string;
};

function normalizedStorageKey(companyParam: string): string {
  const trimmed = companyParam.trim();
  const mappedSlug = COMPANY_CODE_TO_SLUG[trimmed.toUpperCase()];
  return (mappedSlug ?? trimmed).toLowerCase();
}

function resolveOverseerCompanyRoute(pathname: string): OverseerCompanyRoute | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  if (segments[0] === "companies") {
    const companyParam = segments[1] ?? "";
    if (!companyParam || companyParam === "new") return null;

    return {
      companyParam,
      storageCompanyKey: normalizedStorageKey(companyParam),
      routeKind: "company-prefix",
      isFullOverseerRoute: segments[2] === "overseer",
      pathname,
    };
  }

  const root = segments[0];
  if (NON_COMPANY_ROOTS.has(root.toLowerCase())) return null;

  return {
    companyParam: root,
    storageCompanyKey: normalizedStorageKey(root),
    routeKind: "root-company",
    isFullOverseerRoute: segments[1] === "overseer",
    pathname,
  };
}

export function useOverseerCompanyRoute(): OverseerCompanyRoute | null {
  const pathname = usePathname();
  return useMemo(() => resolveOverseerCompanyRoute(pathname), [pathname]);
}
