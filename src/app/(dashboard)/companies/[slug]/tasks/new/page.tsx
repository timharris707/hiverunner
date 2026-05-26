"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { CreateTaskModal } from "@/components/orchestration/CreateTaskModal";
import { listCompanies } from "@/lib/orchestration/client";
import { buildCanonicalTasksPath } from "@/lib/orchestration/route-paths";
import type { OrchestrationCompany } from "@/lib/orchestration/types";
import CompanyTasksPage from "@/app/(dashboard)/companies/[slug]/tasks/page";

export default function CompanyNewTaskPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = params?.slug ?? "";
  const defaultProjectId = searchParams.get("projectId") ?? undefined;
  const [company, setCompany] = useState<OrchestrationCompany | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadCompany = async () => {
      const companies = await listCompanies();
      if (cancelled) return;
      const key = slug.toLowerCase();
      setCompany(companies.find((row) => row.slug.toLowerCase() === key || row.code.toLowerCase() === key) ?? null);
    };

    if (slug) void loadCompany();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const companyCode = company?.code || slug.slice(0, 3).toUpperCase();
  const tasksPath = useMemo(() => buildCanonicalTasksPath(companyCode), [companyCode]);

  const close = () => {
    router.replace(tasksPath);
  };

  return (
    <>
      <CompanyTasksPage />
      <CreateTaskModal
        open
        onClose={close}
        onCreated={close}
        companySlug={slug}
        companyCode={companyCode}
        companyName={company?.name}
        defaultProjectId={defaultProjectId}
      />
    </>
  );
}
