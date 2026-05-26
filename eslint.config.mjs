import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // HiveRunner local-runtime noise / generated trees:
    ".next_backup*/**",
    ".stable/**",
    ".stable.backup-*/**",
    ".claude/**",
    ".tmp*/**",
    ".tmp*.cjs",
    "tmp/**",
    "artifacts/**",
    "**/.next/**",
    "_quarantine/**",
  ]),
]);

export default eslintConfig;
