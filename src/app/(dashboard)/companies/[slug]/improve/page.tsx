"use client";

import { useParams } from "next/navigation";

import { ImproveQueueView } from "@/components/orchestration/ImproveQueueView";

export default function CompanyImprovePage() {
  const params = useParams<{ slug: string }>();
  return <ImproveQueueView companySlug={params?.slug ?? ""} />;
}
