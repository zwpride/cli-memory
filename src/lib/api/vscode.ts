import { invoke } from "@/lib/transport";
import type { CustomEndpoint } from "@/types";
import type { AppId } from "./types";

export interface ConfigFileEntry {
  path: string;
  fullPath: string;
  fileType: string;
  level: string;
  content: string | null;
  exists: boolean;
  error?: string;
}

export interface ConfigFilesResult {
  files: ConfigFileEntry[];
  projectDir?: string;
  app?: string;
}

export interface EndpointLatencyResult {
  url: string;
  latency: number | null;
  status?: number;
  error?: string;
}

export const vscodeApi = {
  async getLiveProviderSettings(appId: AppId) {
    return await invoke("read_live_provider_settings", { app: appId });
  },

  async testApiEndpoints(
    urls: string[],
    options?: { timeoutSecs?: number },
  ): Promise<EndpointLatencyResult[]> {
    return await invoke("test_api_endpoints", {
      urls,
      timeoutSecs: options?.timeoutSecs,
    });
  },

  async getCustomEndpoints(
    appId: AppId,
    providerId: string,
  ): Promise<CustomEndpoint[]> {
    return await invoke("get_custom_endpoints", {
      app: appId,
      providerId: providerId,
    });
  },

  async addCustomEndpoint(
    appId: AppId,
    providerId: string,
    url: string,
  ): Promise<void> {
    await invoke("add_custom_endpoint", {
      app: appId,
      providerId: providerId,
      url,
    });
  },

  async removeCustomEndpoint(
    appId: AppId,
    providerId: string,
    url: string,
  ): Promise<void> {
    await invoke("remove_custom_endpoint", {
      app: appId,
      providerId: providerId,
      url,
    });
  },

  async updateEndpointLastUsed(
    appId: AppId,
    providerId: string,
    url: string,
  ): Promise<void> {
    await invoke("update_endpoint_last_used", {
      app: appId,
      providerId: providerId,
      url,
    });
  },

  async exportConfigToFile(filePath: string) {
    return await invoke("export_config_to_file", {
      filePath,
    });
  },

  async importConfigFromFile(filePath: string) {
    return await invoke("import_config_from_file", {
      filePath,
    });
  },

  async saveFileDialog(defaultName: string): Promise<string | null> {
    return await invoke("save_file_dialog", {
      defaultName,
    });
  },

  async openFileDialog(): Promise<string | null> {
    return await invoke("open_file_dialog");
  },

  async readProjectConfigs(
    appId: AppId,
    projectDir: string,
  ): Promise<ConfigFilesResult> {
    return await invoke("read_project_configs", { app: appId, projectDir });
  },

  async readGlobalConfigs(appId: AppId): Promise<ConfigFilesResult> {
    return await invoke("read_global_configs", { app: appId });
  },

  async getSymlinkStatus(persistentBase: string): Promise<{
    home: string;
    persistentBase: string;
    items: Array<{
      app: string;
      dirName: string;
      homePath: string;
      persistPath: string;
      persistExists: boolean;
      status: "linked" | "linked_other" | "local_dir" | "missing" | "error";
      linkTarget: string;
    }>;
  }> {
    return await invoke("get_symlink_status", { persistentBase });
  },

  async createConfigSymlink(
    appId: string,
    persistentBase: string,
  ): Promise<{ success: boolean; app: string; homePath: string; persistPath: string }> {
    return await invoke("create_config_symlink", { app: appId, persistentBase });
  },

  async writeConfigFile(filePath: string, content: string): Promise<boolean> {
    return await invoke("write_config_file", { filePath, content });
  },
};
