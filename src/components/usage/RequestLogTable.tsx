import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRequestLogs, usageKeys } from "@/lib/query/usage";
import { useQueryClient } from "@tanstack/react-query";
import type { LogFilters } from "@/types/usage";
import { ChevronLeft, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import {
  fmtInt,
  fmtUsd,
  getLocaleFromLanguage,
  parseFiniteNumber,
} from "./format";
import { cn } from "@/lib/utils";

interface RequestLogTableProps {
  appType?: string;
  refreshIntervalMs: number;
}

const ONE_DAY_SECONDS = 24 * 60 * 60;
const MAX_FIXED_RANGE_SECONDS = 30 * ONE_DAY_SECONDS;

type TimeMode = "rolling" | "fixed";

function FilterField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function getDurationClass(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300";
  }
  if (seconds <= 5) {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300";
  }
  if (seconds <= 120) {
    return "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300";
  }
  return "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300";
}

function pillClass(className: string) {
  return cn(
    "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-medium",
    className,
  );
}

export function RequestLogTable({
  appType: dashboardAppType,
  refreshIntervalMs,
}: RequestLogTableProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const getRollingRange = () => {
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - ONE_DAY_SECONDS;
    return { startDate: oneDayAgo, endDate: now };
  };

  const [appliedTimeMode, setAppliedTimeMode] = useState<TimeMode>("rolling");
  const [draftTimeMode, setDraftTimeMode] = useState<TimeMode>("rolling");

  const [appliedFilters, setAppliedFilters] = useState<LogFilters>({});
  const [draftFilters, setDraftFilters] = useState<LogFilters>({});
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const [validationError, setValidationError] = useState<string | null>(null);

  // When dashboard-level app filter is active (not "all"), override the local appType filter
  const dashboardAppTypeActive = dashboardAppType && dashboardAppType !== "all";
  const effectiveFilters: LogFilters = dashboardAppTypeActive
    ? { ...appliedFilters, appType: dashboardAppType }
    : appliedFilters;

  const { data: result, isLoading } = useRequestLogs({
    filters: effectiveFilters,
    timeMode: appliedTimeMode,
    rollingWindowSeconds: ONE_DAY_SECONDS,
    page,
    pageSize,
    options: {
      refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
    },
  });

  const logs = result?.data ?? [];
  const total = result?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const handleSearch = () => {
    setValidationError(null);

    if (draftTimeMode === "fixed") {
      const start = draftFilters.startDate;
      const end = draftFilters.endDate;

      if (typeof start !== "number" || typeof end !== "number") {
        setValidationError(
          t("usage.invalidTimeRange", "请选择完整的开始/结束时间"),
        );
        return;
      }

      if (start > end) {
        setValidationError(
          t("usage.invalidTimeRangeOrder", "开始时间不能晚于结束时间"),
        );
        return;
      }

      if (end - start > MAX_FIXED_RANGE_SECONDS) {
        setValidationError(
          t("usage.timeRangeTooLarge", "时间范围过大，请缩小范围"),
        );
        return;
      }
    }

    setAppliedTimeMode(draftTimeMode);
    setAppliedFilters((prev) => {
      const next = { ...prev, ...draftFilters };
      if (draftTimeMode === "rolling") {
        delete next.startDate;
        delete next.endDate;
      }
      return next;
    });
    setPage(0);
  };

  const handleReset = () => {
    setValidationError(null);
    setAppliedTimeMode("rolling");
    setDraftTimeMode("rolling");
    setDraftFilters({});
    setAppliedFilters({});
    setPage(0);
  };

  const handleRefresh = () => {
    const key = {
      timeMode: appliedTimeMode,
      rollingWindowSeconds:
        appliedTimeMode === "rolling" ? ONE_DAY_SECONDS : undefined,
      appType: appliedFilters.appType,
      providerName: appliedFilters.providerName,
      model: appliedFilters.model,
      statusCode: appliedFilters.statusCode,
      startDate:
        appliedTimeMode === "fixed" ? appliedFilters.startDate : undefined,
      endDate: appliedTimeMode === "fixed" ? appliedFilters.endDate : undefined,
    };

    queryClient.invalidateQueries({
      queryKey: usageKeys.logs(key, page, pageSize),
    });
  };

  // 将 Unix 时间戳转换为本地时间的 datetime-local 格式
  const timestampToLocalDatetime = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  // 将 datetime-local 格式转换为 Unix 时间戳
  const localDatetimeToTimestamp = (datetime: string): number | undefined => {
    if (!datetime) return undefined;
    // 验证格式是否完整 (YYYY-MM-DDTHH:mm)
    if (datetime.length < 16) return undefined;
    const timestamp = new Date(datetime).getTime();
    // 验证是否为有效日期
    if (isNaN(timestamp)) return undefined;
    return Math.floor(timestamp / 1000);
  };

  const language = i18n.resolvedLanguage || i18n.language || "en";
  const locale = getLocaleFromLanguage(language);

  const rollingRangeForDisplay =
    draftTimeMode === "rolling" ? getRollingRange() : null;
  const activeFilterCount = [
    effectiveFilters.appType,
    appliedFilters.providerName,
    appliedFilters.model,
    appliedFilters.statusCode,
    appliedTimeMode === "fixed" ? appliedFilters.startDate : undefined,
    appliedTimeMode === "fixed" ? appliedFilters.endDate : undefined,
  ].filter((value) => value !== undefined && value !== "").length;

  return (
    <div className="min-w-0 space-y-4">
      {/* 筛选栏 */}
      <div className="app-panel-inset grid gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-foreground">
              {t("usage.filters", { defaultValue: "筛选条件" })}
            </div>
            <div className="text-xs text-muted-foreground">
              {appliedTimeMode === "rolling"
                ? t("usage.rollingWindowHint", {
                    defaultValue:
                      "默认查看最近 24 小时，可切换为固定时间范围。",
                  })
                : t("usage.fixedWindowHint", {
                    defaultValue: "固定时间范围最多 30 天。",
                  })}
            </div>
          </div>
          <span className="rounded-full border border-black/[0.08] bg-white/70 px-2.5 py-1 text-[11px] text-muted-foreground dark:border-white/[0.08] dark:bg-white/[0.05]">
            {t("usage.activeFilters", {
              defaultValue: "{{count}} active",
              count: activeFilterCount,
            })}
          </span>
        </div>

        <div className="grid gap-3 xl:grid-cols-[132px_150px_minmax(0,1fr)]">
          <FilterField label={t("usage.appType", { defaultValue: "应用" })}>
            <Select
              value={
                dashboardAppTypeActive
                  ? dashboardAppType
                  : draftFilters.appType || "all"
              }
              onValueChange={(v) =>
                setDraftFilters({
                  ...draftFilters,
                  appType: v === "all" ? undefined : v,
                })
              }
              disabled={!!dashboardAppTypeActive}
            >
              <SelectTrigger className="h-9 w-full bg-background">
                <SelectValue placeholder={t("usage.appType")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("usage.allApps")}</SelectItem>
                <SelectItem value="claude">Claude</SelectItem>
                <SelectItem value="codex">Codex</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField
            label={t("usage.statusCode", { defaultValue: "状态码" })}
          >
            <Select
              value={draftFilters.statusCode?.toString() || "all"}
              onValueChange={(v) =>
                setDraftFilters({
                  ...draftFilters,
                  statusCode:
                    v === "all"
                      ? undefined
                      : Number.isFinite(Number.parseInt(v, 10))
                        ? Number.parseInt(v, 10)
                        : undefined,
                })
              }
            >
              <SelectTrigger className="h-9 w-full bg-background">
                <SelectValue placeholder={t("usage.statusCode")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.all")}</SelectItem>
                <SelectItem value="200">200 OK</SelectItem>
                <SelectItem value="400">400 Bad Request</SelectItem>
                <SelectItem value="401">401 Unauthorized</SelectItem>
                <SelectItem value="429">429 Rate Limit</SelectItem>
                <SelectItem value="500">500 Server Error</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
            <FilterField
              label={t("usage.provider", { defaultValue: "供应商" })}
            >
              <div className="relative min-w-0">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  aria-label={t("usage.searchProviderPlaceholder")}
                  placeholder={t("usage.searchProviderPlaceholder")}
                  className="h-9 bg-background pl-9"
                  value={draftFilters.providerName || ""}
                  onChange={(e) =>
                    setDraftFilters({
                      ...draftFilters,
                      providerName: e.target.value || undefined,
                    })
                  }
                />
              </div>
            </FilterField>
            <FilterField
              label={t("usage.billingModel", { defaultValue: "模型" })}
            >
              <Input
                aria-label={t("usage.searchModelPlaceholder")}
                placeholder={t("usage.searchModelPlaceholder")}
                className="h-9 bg-background"
                value={draftFilters.model || ""}
                onChange={(e) =>
                  setDraftFilters({
                    ...draftFilters,
                    model: e.target.value || undefined,
                  })
                }
              />
            </FilterField>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,220px)_minmax(0,220px)]">
            <FilterField
              label={t("usage.startTime", { defaultValue: "开始时间" })}
            >
              <Input
                type="datetime-local"
                className="h-9 min-w-0 bg-background"
                value={
                  (rollingRangeForDisplay?.startDate ?? draftFilters.startDate)
                    ? timestampToLocalDatetime(
                        (rollingRangeForDisplay?.startDate ??
                          draftFilters.startDate) as number,
                      )
                    : ""
                }
                onChange={(e) => {
                  const timestamp = localDatetimeToTimestamp(e.target.value);
                  setDraftTimeMode("fixed");
                  setDraftFilters({
                    ...draftFilters,
                    startDate: timestamp,
                  });
                }}
              />
            </FilterField>
            <FilterField
              label={t("usage.endTime", { defaultValue: "结束时间" })}
            >
              <Input
                type="datetime-local"
                className="h-9 min-w-0 bg-background"
                value={
                  (rollingRangeForDisplay?.endDate ?? draftFilters.endDate)
                    ? timestampToLocalDatetime(
                        (rollingRangeForDisplay?.endDate ??
                          draftFilters.endDate) as number,
                      )
                    : ""
                }
                onChange={(e) => {
                  const timestamp = localDatetimeToTimestamp(e.target.value);
                  setDraftTimeMode("fixed");
                  setDraftFilters({
                    ...draftFilters,
                    endDate: timestamp,
                  });
                }}
              />
            </FilterField>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 xl:ml-auto">
            <Button
              size="sm"
              variant="default"
              onClick={handleSearch}
              className="h-9"
            >
              <Search className="mr-2 h-3.5 w-3.5" />
              {t("common.search")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleReset}
              className="h-9"
            >
              <X className="mr-2 h-3.5 w-3.5" />
              {t("common.reset")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRefresh}
              className="h-9 border border-black/[0.08] bg-white/56 px-2 shadow-sm hover:bg-white/80 dark:border-white/[0.08] dark:bg-white/[0.04] dark:hover:bg-white/[0.09]"
              aria-label={t("common.refresh")}
            >
              <RefreshCw className="mr-0 h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">{t("common.refresh")}</span>
            </Button>
          </div>
        </div>

        {validationError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {validationError}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {t("usage.requestLogs", { defaultValue: "请求日志" })}
          </span>
          <span className="rounded-full border border-black/[0.08] bg-white/70 px-2 py-0.5 text-[11px] text-muted-foreground dark:border-white/[0.08] dark:bg-white/[0.05]">
            {t("usage.totalRecords", {
              defaultValue: "共 {{total}} 条记录",
              total,
            })}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {t("usage.horizontalScrollHint", {
            defaultValue: "表格可横向滚动",
          })}
        </span>
      </div>

      {isLoading ? (
        <div className="app-loading-state h-[400px] animate-pulse">
          <RefreshCw className="h-4 w-4 animate-spin" />
          {t("common.loading", { defaultValue: "读取中" })}
        </div>
      ) : (
        <>
          <div className="app-table-shell rounded-xl">
            <Table className="min-w-[1180px] text-xs">
              <TableHeader className="bg-white/72 backdrop-blur dark:bg-white/[0.04]">
                <TableRow>
                  <TableHead className="whitespace-nowrap">
                    {t("usage.time")}
                  </TableHead>
                  <TableHead className="whitespace-nowrap">
                    {t("usage.provider")}
                  </TableHead>
                  <TableHead className="min-w-[200px] whitespace-nowrap">
                    {t("usage.billingModel")}
                  </TableHead>
                  <TableHead className="text-right whitespace-nowrap">
                    {t("usage.inputTokens")}
                  </TableHead>
                  <TableHead className="text-right whitespace-nowrap">
                    {t("usage.outputTokens")}
                  </TableHead>
                  <TableHead className="text-right min-w-[90px] whitespace-nowrap">
                    {t("usage.cacheReadTokens")}
                  </TableHead>
                  <TableHead className="text-right min-w-[90px] whitespace-nowrap">
                    {t("usage.cacheCreationTokens")}
                  </TableHead>
                  <TableHead className="text-right whitespace-nowrap">
                    {t("usage.multiplier")}
                  </TableHead>
                  <TableHead className="text-right whitespace-nowrap">
                    {t("usage.totalCost")}
                  </TableHead>
                  <TableHead className="text-center min-w-[140px] whitespace-nowrap">
                    {t("usage.timingInfo")}
                  </TableHead>
                  <TableHead className="whitespace-nowrap">
                    {t("usage.status")}
                  </TableHead>
                  <TableHead className="whitespace-nowrap">
                    {t("usage.source", { defaultValue: "Source" })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={12}
                      className="py-0 text-center text-muted-foreground"
                    >
                      <div className="app-empty-state">
                        <Search className="h-6 w-6 text-muted-foreground/60" />
                        <div className="text-sm font-medium text-foreground">
                          {t("usage.noData", { defaultValue: "暂无数据" })}
                        </div>
                        <div className="max-w-md text-xs leading-5">
                          {t("usage.noRequestLogsDescription", {
                            defaultValue:
                              "当前时间范围或筛选条件下没有请求记录。可以放宽筛选条件后再试。",
                          })}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow
                      key={log.requestId}
                      className="align-top hover:bg-white/72 dark:hover:bg-white/[0.08]"
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {new Date(log.createdAt * 1000).toLocaleString(locale)}
                      </TableCell>
                      <TableCell className="max-w-[180px]">
                        <div
                          className="truncate font-medium text-foreground"
                          title={log.providerName || t("usage.unknownProvider")}
                        >
                          {log.providerName || t("usage.unknownProvider")}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px] font-mono text-xs">
                        <div
                          className="truncate rounded-md bg-black/[0.025] px-2 py-1 text-foreground/90 dark:bg-white/[0.04]"
                          title={
                            log.requestModel && log.requestModel !== log.model
                              ? `${t("usage.requestModel")}: ${log.requestModel}\n${t("usage.responseModel")}: ${log.model}`
                              : log.model
                          }
                        >
                          {log.model}
                        </div>
                        {log.requestModel && log.requestModel !== log.model && (
                          <div
                            className="mt-1 truncate text-[10px] text-muted-foreground"
                            title={log.requestModel}
                          >
                            ← {log.requestModel}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtInt(log.inputTokens, locale)}
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtInt(log.outputTokens, locale)}
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtInt(log.cacheReadTokens, locale)}
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtInt(log.cacheCreationTokens, locale)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {(parseFiniteNumber(log.costMultiplier) ?? 1) !== 1 ? (
                          <span className="text-orange-600">
                            ×{log.costMultiplier}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">×1</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtUsd(log.totalCostUsd, 6)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          {(() => {
                            const durationMs =
                              typeof log.durationMs === "number"
                                ? log.durationMs
                                : log.latencyMs;
                            const durationSec = durationMs / 1000;
                            return (
                              <span
                                className={pillClass(
                                  getDurationClass(durationSec),
                                )}
                              >
                                {Number.isFinite(durationSec)
                                  ? `${Math.round(durationSec)}s`
                                  : "--"}
                              </span>
                            );
                          })()}
                          {log.isStreaming &&
                            log.firstTokenMs != null &&
                            (() => {
                              const firstSec = log.firstTokenMs / 1000;
                              return (
                                <span
                                  className={pillClass(
                                    getDurationClass(firstSec),
                                  )}
                                >
                                  {Number.isFinite(firstSec)
                                    ? `${firstSec.toFixed(1)}s`
                                    : "--"}
                                </span>
                              );
                            })()}
                          <span
                            className={pillClass(
                              log.isStreaming
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300"
                                : "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
                            )}
                          >
                            {log.isStreaming
                              ? t("usage.stream")
                              : t("usage.nonStream")}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={pillClass(
                            log.statusCode >= 200 && log.statusCode < 300
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                              : "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
                          )}
                        >
                          {log.statusCode}
                        </span>
                      </TableCell>
                      <TableCell>
                        {log.dataSource && log.dataSource !== "proxy" ? (
                          <span
                            className={pillClass(
                              "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
                            )}
                          >
                            {t(`usage.dataSource.${log.dataSource}`, {
                              defaultValue: log.dataSource,
                            })}
                          </span>
                        ) : (
                          <span
                            className={pillClass(
                              "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
                            )}
                          >
                            {t("usage.dataSource.proxy", {
                              defaultValue: "Proxy",
                            })}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* 分页控件 */}
          {total > 0 && (
            <div className="app-panel-inset grid gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t("usage.totalRecords", {
                    defaultValue: "共 {{total}} 条记录",
                    total,
                  })}
                </span>
                <span className="ml-2 text-xs">
                  {t("usage.pageIndicator", {
                    defaultValue: "第 {{page}} / {{totalPages}} 页",
                    page: page + 1,
                    totalPages: Math.max(totalPages, 1),
                  })}
                </span>
              </div>
              <div className="app-scroll-x flex min-w-0 items-center gap-1 pb-1 sm:justify-end sm:pb-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  aria-label={t("common.previous", {
                    defaultValue: "上一页",
                  })}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {/* 页码按钮 */}
                {(() => {
                  const pages: (number | string)[] = [];
                  if (totalPages <= 7) {
                    for (let i = 0; i < totalPages; i++) pages.push(i);
                  } else {
                    pages.push(0);
                    if (page > 2) pages.push("...");
                    for (
                      let i = Math.max(1, page - 1);
                      i <= Math.min(totalPages - 2, page + 1);
                      i++
                    ) {
                      pages.push(i);
                    }
                    if (page < totalPages - 3) pages.push("...");
                    pages.push(totalPages - 1);
                  }
                  return pages.map((p, idx) =>
                    typeof p === "string" ? (
                      <span
                        key={`ellipsis-${idx}`}
                        className="px-2 text-muted-foreground"
                      >
                        ...
                      </span>
                    ) : (
                      <Button
                        key={p}
                        variant={p === page ? "default" : "outline"}
                        size="sm"
                        className="h-8 w-8 shrink-0 p-0"
                        onClick={() => setPage(p)}
                        aria-label={t("usage.gotoPage", {
                          defaultValue: "跳转到第 {{page}} 页",
                          page: p + 1,
                        })}
                      >
                        {p + 1}
                      </Button>
                    ),
                  );
                })()}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={page >= totalPages - 1}
                  aria-label={t("common.next", {
                    defaultValue: "下一页",
                  })}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
