import { invokeCommand } from "./tauri";
import type { PublicAppConfig, SaveAppConfigInput } from "../types/config";

export function getAppConfig() {
  return invokeCommand<PublicAppConfig>("get_app_config");
}

export function saveAppConfig(input: SaveAppConfigInput) {
  return invokeCommand<PublicAppConfig>("save_app_config", { input });
}

export function clearDeepSeekKey() {
  return invokeCommand<PublicAppConfig>("clear_deepseek_key");
}

export function clearAzureKey() {
  return invokeCommand<PublicAppConfig>("clear_azure_key");
}
