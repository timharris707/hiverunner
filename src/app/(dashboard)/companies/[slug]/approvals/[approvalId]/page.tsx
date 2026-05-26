import ApprovalDetailClient from "../ApprovalDetailClient";

export default async function ApprovalDetailPage({
  params,
}: {
  params: Promise<{ slug: string; approvalId: string }>;
}) {
  const { slug, approvalId } = await params;
  return <ApprovalDetailClient slug={slug} approvalId={approvalId} />;
}
