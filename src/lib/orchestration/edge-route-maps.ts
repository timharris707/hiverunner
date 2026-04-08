export type EdgeRouteMaps = {
  companyCodeToSlug: Record<string, string>;
  companySlugToCode: Record<string, string>;
  projectIdToSlugByCompany: Record<string, Record<string, string>>;
  /** Maps old project slug → current canonical slug (cross-company). */
  projectSlugAliasToCanonical: Record<string, string>;
  generatedAt?: string;
};

export const COMPANY_CODE_TO_SLUG: Record<string, string> = {
  CAS: "cascade-inc",
  NEV: "neveridle-core",
  RIV: "river-s-edge",
  VIR: "virtual-design-house",
};

export const COMPANY_SLUG_TO_CODE: Record<string, string> = {
  "cascade-inc": "CAS",
  "neveridle-core": "NEV",
  // Legacy slug alias — now DB-backed via company_slug_aliases table (migration 38).
  // Kept here as a static fallback for edge middleware when the DB is unreachable.
  "weather-edge": "NEV",
  "river-s-edge": "RIV",
  "virtual-design-house": "VIR",
};

export const PROJECT_ID_TO_SLUG_BY_COMPANY: Record<string, Record<string, string>> = {
  "cascade-inc": {
    "f4460476-a764-4160-8040-10d41602b010": "demo-project",
  },
  "neveridle-core": {
    "294910a8-48c1-408c-afce-d96b58dfeab9": "boardrunner",
    "6cc39dec-2f7d-4431-8b80-6b44d46424d4": "company-scope-a-1775118055539",
    "15d55d8d-dcaa-46e5-8149-94875bf5f645": "company-scope-b-1775118055544",
    "6ebf17b1-202e-47d6-8813-25df3bcdea91": "crypto-trading",
    "cd2c2548-f290-4446-9067-cd760271e498": "ideas-pipeline",
    "e95a1fef-fe44-456e-82bf-e0eba6a8aeca": "insight-website",
    "362ce09c-7ea1-413e-827e-88bcc34530a9": "mission-control-orchestration",
    "a887930e-cf84-4184-810e-4426437eecc3": "signalforge",
    "5583a258-581f-4d6c-b100-0d8d45635389": "snapaudit",
    "56d595bd-03d6-42c2-8821-cb00a0a47f0a": "stock-trading",
    "bcc1b5b2-f7e7-41a4-9d5f-200a1b1ad919": "weather-trading",
  },
  "river-s-edge": {
    "52f63c9c-ea0d-434c-8b49-b1a1dac14f5d": "store-1",
  },
  "virtual-design-house": {
    "e6ee2ed4-0086-41de-8e2c-24c3ff97ee7a": "playing-around",
  },
};

export const EDGE_ROUTE_MAPS_FALLBACK: EdgeRouteMaps = {
  companyCodeToSlug: COMPANY_CODE_TO_SLUG,
  companySlugToCode: COMPANY_SLUG_TO_CODE,
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
    projectIdToSlugByCompany: mergedProjectMaps,
    projectSlugAliasToCanonical: {
      ...(routeMaps?.projectSlugAliasToCanonical ?? {}),
    },
    generatedAt: routeMaps?.generatedAt,
  };
}
