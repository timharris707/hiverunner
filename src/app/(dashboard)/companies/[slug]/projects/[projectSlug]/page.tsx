"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { buildCompanyPath } from "@/lib/orchestration/route-paths";

const VALID_TABS = ["tasks", "overview", "workspaces", "configuration", "budget"];
const DEFAULT_TAB = "tasks";

export default function CompanyProjectPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = use(params);
  const router = useRouter();

  useEffect(() => {
    let tab = DEFAULT_TAB;
    try {
      const stored = localStorage.getItem(`project-tab:${projectSlug}`);
      if (stored && VALID_TABS.includes(stored)) {
        tab = stored;
      }
    } catch { /* best-effort */ }
    router.replace(
      buildCompanyPath(slug, `/projects/${encodeURIComponent(projectSlug)}/${tab}`)
    );
  }, [slug, projectSlug, router]);

  return null;
}
