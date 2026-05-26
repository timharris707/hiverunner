export type EdgeRouteMaps = {
  companyCodeToSlug: Record<string, string>;
  companySlugToCode: Record<string, string>;
  /** Company codes returned by the configured data store, before static fallback aliases are merged. */
  actualCompanyCodes?: string[];
  projectIdToSlugByCompany: Record<string, Record<string, string>>;
  /** Maps old project slug → current canonical slug (cross-company). */
  projectSlugAliasToCanonical: Record<string, string>;
  generatedAt?: string;
};

export const COMPANY_CODE_TO_SLUG: Record<string, string> = {
  HIVE: "hiverunner-workspace",
};

export const COMPANY_SLUG_TO_CODE: Record<string, string> = {
  "hiverunner-workspace": "HIVE",
};

export const PROJECT_ID_TO_SLUG_BY_COMPANY: Record<string, Record<string, string>> = {
};

export const EDGE_ROUTE_MAPS_FALLBACK: EdgeRouteMaps = {
  companyCodeToSlug: COMPANY_CODE_TO_SLUG,
  companySlugToCode: COMPANY_SLUG_TO_CODE,
  actualCompanyCodes: [],
  projectIdToSlugByCompany: PROJECT_ID_TO_SLUG_BY_COMPANY,
  projectSlugAliasToCanonical: {},
};

export function withEdgeRouteMapFallback(routeMaps?: Partial<EdgeRouteMaps> | null): EdgeRouteMaps {
  const mergedProjectMaps: Record<string, Record<string, string>> = {
    ...PROJECT_ID_TO_SLUG_BY_COMPANY,
  };

  for (const [companySlug, projectMap] of Object.entries(routeMaps?.projectIdToSlugByCompany ?? {})) {
    mergedProjectMaps[companySlug] = {
      ...(PROJECT_ID_TO_SLUG_BY_COMPANY[companySlug] ?? {}),
      ...projectMap,
    };
  }

  return {
    companyCodeToSlug: {
      ...COMPANY_CODE_TO_SLUG,
      ...(routeMaps?.companyCodeToSlug ?? {}),
    },
    companySlugToCode: {
      ...COMPANY_SLUG_TO_CODE,
      ...(routeMaps?.companySlugToCode ?? {}),
    },
    actualCompanyCodes: routeMaps?.actualCompanyCodes ?? [],
    projectIdToSlugByCompany: mergedProjectMaps,
    projectSlugAliasToCanonical: {
      ...(routeMaps?.projectSlugAliasToCanonical ?? {}),
    },
    generatedAt: routeMaps?.generatedAt,
  };
}
