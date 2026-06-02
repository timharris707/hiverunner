type DefaultCompanyEnv = {
  readonly [key: string]: string | undefined;
  MC_DEFAULT_COMPANY_CODE?: string;
};

export function normalizeCompanyCode(value: string | undefined | null): string {
  return value?.trim().toUpperCase() ?? "";
}

export function selectDefaultCompanyCode(
  actualCompanyCodes: readonly string[],
  companyCodeToSlug: Record<string, string | undefined>,
  env: DefaultCompanyEnv = {},
): string {
  const actualCodes: string[] = [];
  for (const code of actualCompanyCodes) {
    const normalized = normalizeCompanyCode(code);
    if (normalized && companyCodeToSlug[normalized]) {
      actualCodes.push(normalized);
    }
  }

  const configuredDefault = normalizeCompanyCode(env.MC_DEFAULT_COMPANY_CODE);
  if (configuredDefault && actualCodes.includes(configuredDefault)) return configuredDefault;
  if (actualCodes.includes("HIVE") && actualCodes.length > 1) {
    const lastRealCompany = [...actualCodes].reverse().find((code) => code !== "HIVE");
    if (lastRealCompany) return lastRealCompany;
  }
  if (actualCodes.includes("HIVE")) return "HIVE";
  if (actualCodes.includes("INS")) return "INS";
  if (actualCodes.length > 0) return actualCodes[0];

  const fallbackCodes = Object.keys(companyCodeToSlug);
  if (configuredDefault && companyCodeToSlug[configuredDefault]) return configuredDefault;
  if (companyCodeToSlug.HIVE) return "HIVE";
  if (companyCodeToSlug.INS) return "INS";
  return fallbackCodes[0] ?? "HIVE";
}
