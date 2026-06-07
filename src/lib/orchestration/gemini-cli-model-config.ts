import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import {
  getProviderRuntimeControls,
  type RuntimeReasoningLevel,
} from "@/lib/orchestration/provider-runtime-controls";

export type GeminiCliModelConfig = {
  alias: string;
  settingsPath: string;
  cleanupRoot: string;
};

function normalizeThinkingLevel(value: string | null | undefined): RuntimeReasoningLevel | null {
  if (value === "minimal" || value === "low" || value === "medium" || value === "high") return value;
  if (value === "max" || value === "xhigh") return "high";
  return null;
}

export function createGeminiCliModelConfig(
  model: string,
  reasoningEffort: string | null | undefined,
): GeminiCliModelConfig | null {
  const thinkingLevel = normalizeThinkingLevel(reasoningEffort);
  const controls = getProviderRuntimeControls("gemini", model);
  const thinkingLevelAllowed = controls?.reasoning.options.some((option) => option.value === thinkingLevel) ?? false;
  if (!thinkingLevel || !thinkingLevelAllowed) return null;

  const cleanupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hiverunner-gemini-cli-"));
  const settingsPath = path.join(cleanupRoot, "settings.json");
  const alias = `hiverunner-${randomUUID()}`;

  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      modelConfigs: {
        customAliases: {
          [alias]: {
            modelConfig: {
              model: model.trim().replace(/^google\//i, "").replace(/^models\//i, ""),
              generateContentConfig: {
                thinkingConfig: {
                  thinkingLevel: thinkingLevel.toUpperCase(),
                },
              },
            },
          },
        },
      },
    }),
    "utf8",
  );

  return { alias, settingsPath, cleanupRoot };
}

export function cleanupGeminiCliModelConfig(config: GeminiCliModelConfig | null): void {
  if (!config) return;
  fs.rmSync(config.cleanupRoot, { recursive: true, force: true });
}
