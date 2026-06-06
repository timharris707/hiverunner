"use client";

import { useParams } from "next/navigation";

import { OverseerCockpit } from "@/components/overseer/OverseerCockpit";

export default function CompanyOverseerPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  return <OverseerCockpit slug={slug} />;
}
