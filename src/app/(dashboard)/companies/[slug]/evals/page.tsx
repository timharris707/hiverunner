"use client";

import { useParams } from "next/navigation";

import { EvalsLibraryView } from "@/components/orchestration/EvalsLibraryView";

export default function CompanyEvalsPage() {
  const params = useParams<{ slug: string }>();
  return <EvalsLibraryView companySlug={params?.slug ?? ""} />;
}
