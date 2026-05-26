import { backfillActiveMemoryRecordsToVault, syncCompanyMemoryVault } from "@/lib/orchestration/memory-vault";

function parseArgs(): { company: string; apply: boolean } {
  const args = process.argv.slice(2);
  const companyIndex = args.findIndex((arg) => arg === "--company");
  const company = companyIndex >= 0 ? args[companyIndex + 1] : args.find((arg) => !arg.startsWith("--"));
  if (!company) {
    throw new Error("Usage: npx tsx scripts/memory-vault-backfill.ts --company <slug-or-code> [--apply]");
  }
  return { company, apply: args.includes("--apply") };
}

async function main() {
  const { company, apply } = parseArgs();
  const result = backfillActiveMemoryRecordsToVault({ companySlug: company, apply });
  const sync = apply ? syncCompanyMemoryVault(company) : null;
  console.log(JSON.stringify({ ...result, sync }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
