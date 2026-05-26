import { redirect } from "next/navigation";

export default async function CanonicalTaskDetailPage({
  params,
}: {
  params: Promise<{ companyCode: string; taskKey: string }>;
}) {
  const { companyCode, taskKey } = await params;
  // Middleware will rewrite /{CODE}/tasks/{key} to /companies/{slug}/tasks/{key}
  // This redirect is a fallback if middleware doesn't catch it
  redirect(`/companies/${companyCode}/tasks/${taskKey}`);
}
