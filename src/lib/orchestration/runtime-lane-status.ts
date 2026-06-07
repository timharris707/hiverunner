import { resolveHiveRunnerLane } from "@/lib/workspaces/root";

export type RuntimeLaneStatus = {
  mode: "dev" | "exec-dev" | "stable";
  port: string;
  role: "executor" | "observer";
  engineTick: "active" | "disabled";
  engineTickActive: boolean;
  engineTickSetting: string;
  requestedEngineTickSetting: string;
  engineTickForcedObserver: boolean;
  observerOnly: boolean;
  devExecutionTestModeGate: "enabled" | "disabled";
  executionDisabledReason: string | null;
};

export function getRuntimeLaneStatus(env: NodeJS.ProcessEnv = process.env): RuntimeLaneStatus {
  const isDev = env.NODE_ENV !== "production";
  const mode = resolveHiveRunnerLane(env);
  const port = env.PORT || "3010";
  const requestedEngineTickSetting = (env.MC_ENGINE_TICK || (isDev ? "off" : "on")).toLowerCase();
  const engineTickForcedObserver = port === "3010";
  const engineTickSetting = engineTickForcedObserver ? "off" : requestedEngineTickSetting;
  const baseEngineTickActive =
    engineTickSetting === "on" ? true :
    engineTickSetting === "off" ? false :
    /* auto */ !isDev;
  const devExecutionTestModeGateEnabled =
    isDev &&
    port === "3010" &&
    (env.MC_DEV_EXECUTION_TEST_MODE || "").trim() === "1";
  const engineTickActive = baseEngineTickActive ||
    (!engineTickForcedObserver && engineTickSetting !== "off" && devExecutionTestModeGateEnabled);
  const observerOnly = !engineTickActive;

  let executionDisabledReason: string | null = null;
  if (observerOnly) {
    executionDisabledReason = engineTickForcedObserver
      ? "Port 3010 is the observer lane; engine tick is forced off here."
      : engineTickSetting === "off"
        ? "Engine tick is disabled by MC_ENGINE_TICK=off."
        : "Engine tick is disabled for this runtime lane.";
  }

  return {
    mode,
    port,
    role: engineTickActive ? "executor" : "observer",
    engineTick: engineTickActive ? "active" : "disabled",
    engineTickActive,
    engineTickSetting,
    requestedEngineTickSetting,
    engineTickForcedObserver,
    observerOnly,
    devExecutionTestModeGate: devExecutionTestModeGateEnabled ? "enabled" : "disabled",
    executionDisabledReason,
  };
}
