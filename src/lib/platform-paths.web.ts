import type { AppId } from "@/lib/api";
import { invoke } from "@/lib/transport";

export async function computeDefaultAppConfigDir(): Promise<string | undefined> {
  try {
    return await invoke("get_default_app_config_dir");
  } catch (error) {
    console.error(
      "[platform-paths] Failed to resolve default app config dir for web",
      error,
    );
    return undefined;
  }
}

export async function computeDefaultConfigDir(
  app: AppId,
): Promise<string | undefined> {
  try {
    return await invoke("get_default_config_dir", { app });
  } catch (error) {
    console.error(
      "[platform-paths] Failed to resolve default config dir for web",
      error,
    );
    return undefined;
  }
}
