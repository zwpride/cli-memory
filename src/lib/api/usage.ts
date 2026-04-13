import { invoke } from "@/lib/transport";
import type {
  UsageSummary,
  DailyStats,
  ProviderStats,
  ModelStats,
  LogFilters,
  PaginatedLogs,
  SessionSyncResult,
  DataSourceSummary,
} from "@/types/usage";
import type { UsageResult } from "@/types";
import type { AppId } from "./types";
import type { TemplateType } from "@/config/constants";

export const usageApi = {
  // Provider usage script methods
  query: async (providerId: string, appId: AppId): Promise<UsageResult> => {
    return invoke("queryProviderUsage", { providerId, app: appId });
  },

  testScript: async (
    providerId: string,
    appId: AppId,
    scriptCode: string,
    timeout?: number,
    apiKey?: string,
    baseUrl?: string,
    accessToken?: string,
    userId?: string,
    templateType?: TemplateType,
  ): Promise<UsageResult> => {
    return invoke("testUsageScript", {
      providerId,
      app: appId,
      scriptCode,
      timeout,
      apiKey,
      baseUrl,
      accessToken,
      userId,
      templateType,
    });
  },

  // Proxy usage statistics methods
  getUsageSummary: async (
    startDate?: number,
    endDate?: number,
    appType?: string,
  ): Promise<UsageSummary> => {
    return invoke("get_usage_summary", { startDate, endDate, appType });
  },

  getUsageTrends: async (
    startDate?: number,
    endDate?: number,
    appType?: string,
  ): Promise<DailyStats[]> => {
    return invoke("get_usage_trends", { startDate, endDate, appType });
  },

  getProviderStats: async (appType?: string): Promise<ProviderStats[]> => {
    return invoke("get_provider_stats", { appType });
  },

  getModelStats: async (appType?: string): Promise<ModelStats[]> => {
    return invoke("get_model_stats", { appType });
  },

  getRequestLogs: async (
    filters: LogFilters,
    page: number = 0,
    pageSize: number = 20,
  ): Promise<PaginatedLogs> => {
    return invoke("get_request_logs", {
      filters,
      page,
      pageSize,
    });
  },

  // Session usage sync
  syncSessionUsage: async (): Promise<SessionSyncResult> => {
    return invoke("sync_session_usage");
  },

  getDataSourceBreakdown: async (): Promise<DataSourceSummary[]> => {
    return invoke("get_usage_data_sources");
  },
};
