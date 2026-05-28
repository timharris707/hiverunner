import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const intentionalCommonJsFiles = [
  "server.js",
  "src/app/api/agents/route.ts",
  "src/app/api/cron/route.ts",
  "src/lib/agent-pipeline.ts",
  "src/lib/supabase/server.ts",
  "src/lib/visual-qa.ts",
];

const legacyExplicitAnyFiles = [
  "src/app/api/agents/*/status/route.ts",
  "src/app/api/agents/route.ts",
  "src/app/api/office/route.ts",
  "src/app/api/projects/*/route.ts",
  "src/app/api/quota/route.ts",
  "src/app/api/tasks/archive/route.ts",
  "src/app/api/tasks/build/route.ts",
  "src/app/api/tasks/route-model/route.ts",
  "src/app/api/tasks/visual-qc/route.ts",
  "src/lib/__tests__/build-state-terminal-transitions.test.ts",
  "src/lib/__tests__/ideas-route-bootstrap.test.ts",
  "src/lib/__tests__/ideas-route-project-alias.test.ts",
  "src/lib/__tests__/ideas-takeaway-build-route-dedup.test.ts",
  "src/lib/__tests__/llm-router.test.ts",
  "src/lib/__tests__/narrative-review-events.test.ts",
  "src/lib/__tests__/orchestration-execution-adapter-registry.test.ts",
  "src/lib/__tests__/orchestration-heartbeat-settings-contract.test.ts",
  "src/lib/__tests__/orchestration-memory-utilization-receipts.test.ts",
  "src/lib/__tests__/orchestration-middleware-auth.test.ts",
  "src/lib/__tests__/orchestration-openclaw-heartbeat.test.ts",
  "src/lib/__tests__/orchestration-project-rename-safety.test.ts",
  "src/lib/__tests__/orchestration-symphony-tracker-adapter.test.ts",
  "src/lib/__tests__/tasks-build-route.test.ts",
  "src/lib/projects.ts",
  "src/lib/realtime-snapshot.ts",
  "src/lib/skill-parser.ts",
  "src/lib/usage-collector.ts",
];

const reactCompilerBaselineFiles = [
  "src/app/(dashboard)/companies/*/routines/*/page.tsx",
  "src/components/FilePreview.tsx",
  "src/components/FileTree.tsx",
  "src/components/NarrativeFeed.tsx",
  "src/components/Notepad.tsx",
  "src/components/office/OfficeCanvas.tsx",
  "src/components/office/PixelCharacter.tsx",
  "src/components/tasks/TaskQuickViewModal.tsx",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: intentionalCommonJsFiles,
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["scripts/register-ts-test-hooks.mjs"],
    rules: {
      "@next/next/no-assign-module-variable": "off",
    },
  },
  {
    files: legacyExplicitAnyFiles,
    rules: {
      // Keep first-install lint green while making the legacy any debt visible
      // and preventing new files from adding the same pattern.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: reactCompilerBaselineFiles,
    rules: {
      // These existing React Compiler findings need component-specific review;
      // keep them visible without forcing risky render-timing changes here.
      "react-hooks/immutability": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
    },
  },
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
