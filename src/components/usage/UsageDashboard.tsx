import {
  lazy,
  startTransition,
  Suspense,
  useDeferredValue,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { TimeRange } from "@/types/usage";
import { useUsageSummary } from "@/lib/query/usage";
import { motion } from "framer-motion";
import {
  Calendar,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import { usageKeys } from "@/lib/query/usage";
import { cn } from "@/lib/utils";
import { fmtUsd, parseFiniteNumber } from "./format";

const DataSourceBar = lazy(() =>
  import("./DataSourceBar").then((module) => ({
    default: module.DataSourceBar,
  })),
);
const UsageSummaryCards = lazy(() =>
  import("./UsageSummaryCards").then((module) => ({
    default: module.UsageSummaryCards,
  })),
);
const UsageTrendChart = lazy(() =>
  import("./UsageTrendChart").then((module) => ({
    default: module.UsageTrendChart,
  })),
);
const RequestLogTable = lazy(() =>
  import("./RequestLogTable").then((module) => ({
    default: module.RequestLogTable,
  })),
);
const ProviderStatsTable = lazy(() =>
  import("./ProviderStatsTable").then((module) => ({
    default: module.ProviderStatsTable,
  })),
);
const ModelStatsTable = lazy(() =>
  import("./ModelStatsTable").then((module) => ({
    default: module.ModelStatsTable,
  })),
);

interface UsageDashboardProps {
  /** App type filter, controlled by the top-level AppSwitcher */
  appType?: string;
  embedded?: boolean;
}

export function UsageDashboard({
  appType = "all",
  embedded = false,
}: UsageDashboardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [timeRange, setTimeRange] = useState<TimeRange>("1d");
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(0);
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 16);
  });
  const [customEnd, setCustomEnd] = useState(() =>
    new Date().toISOString().slice(0, 16),
  );

  const refreshIntervalOptionsMs = [0, 5000, 10000, 30000, 60000] as const;
  const changeRefreshInterval = () => {
    const currentIndex = refreshIntervalOptionsMs.indexOf(
      refreshIntervalMs as (typeof refreshIntervalOptionsMs)[number],
    );
    const safeIndex = currentIndex >= 0 ? currentIndex : 3;
    const nextIndex = (safeIndex + 1) % refreshIntervalOptionsMs.length;
    const next = refreshIntervalOptionsMs[nextIndex];
    setRefreshIntervalMs(next);
    queryClient.invalidateQueries({ queryKey: usageKeys.all });
  };

  const days = useMemo(() => {
    if (timeRange === "custom") {
      const start = new Date(customStart).getTime();
      const end = new Date(customEnd).getTime();
      return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
    }
    const map: Record<string, number> = {
      "1d": 1, "7d": 7, "30d": 30, "90d": 90, "180d": 180, "365d": 365,
    };
    return map[timeRange] ?? 30;
  }, [timeRange, customStart, customEnd]);
  const deferredAppType = useDeferredValue(appType);
  const deferredDays = useDeferredValue(days);
  const isRefiningFilters =
    deferredAppType !== appType || deferredDays !== days;

  const { data: summaryData } = useUsageSummary(deferredDays, deferredAppType, {
    refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
  });

  const cardFallback = <div className="app-panel-inset h-[148px] animate-pulse" />;
  const chartFallback = <div className="app-panel-inset h-[350px] animate-pulse" />;
  const tableFallback = <div className="app-panel-inset h-[420px] animate-pulse" />;
  const barFallback = <div className="app-panel-inset h-[48px] animate-pulse" />;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={cn("space-y-6 pb-8", embedded && "space-y-5 pb-4")}
    >
      {/* ── Toolbar: time range + refresh ── */}
      <div className="sticky top-0 z-10 app-panel bg-white/84 px-4 py-3 shadow-sm dark:border-white/[0.08] dark:bg-slate-950/72">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 rounded-md border border-black/[0.08] bg-white/56 px-2.5 text-xs text-muted-foreground shadow-sm hover:bg-white/80 dark:border-white/[0.08] dark:bg-white/[0.04] dark:hover:bg-white/[0.09]"
            title={t("common.refresh", "刷新")}
            onClick={changeRefreshInterval}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            {refreshIntervalMs > 0
              ? `${refreshIntervalMs / 1000}s`
              : t("common.manual", { defaultValue: "手动" })}
          </Button>

          {isRefiningFilters && (
            <div className="rounded-full border border-black/[0.08] bg-white/72 px-2 py-0.5 text-[11px] text-muted-foreground dark:border-white/[0.08] dark:bg-white/[0.05]">
              {t("common.loading", { defaultValue: "读取中" })}
            </div>
          )}

          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{(summaryData?.totalRequests ?? 0).toLocaleString()} {t("usage.requestsLabel")}</span>
            <span className="text-border">|</span>
            <span>{fmtUsd(parseFiniteNumber(summaryData?.totalCost) ?? 0, 4)} {t("usage.costLabel")}</span>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Tabs
              value={timeRange}
              onValueChange={(value) =>
                startTransition(() => setTimeRange(value as TimeRange))
              }
            >
              <TabsList className="app-segmented flex h-8">
                <TabsTrigger value="1d" className="app-tabs-trigger px-2.5 text-xs">
                  {t("usage.today", { defaultValue: "今天" })}
                </TabsTrigger>
                <TabsTrigger value="7d" className="app-tabs-trigger px-2.5 text-xs">
                  {t("usage.last7days", { defaultValue: "7天" })}
                </TabsTrigger>
                <TabsTrigger value="30d" className="app-tabs-trigger px-2.5 text-xs">
                  {t("usage.last30days", { defaultValue: "30天" })}
                </TabsTrigger>
                <TabsTrigger value="90d" className="app-tabs-trigger px-2.5 text-xs">
                  {t("usage.last90days", { defaultValue: "90天" })}
                </TabsTrigger>
                <TabsTrigger value="180d" className="app-tabs-trigger px-2.5 text-xs">
                  {t("usage.last180days", { defaultValue: "半年" })}
                </TabsTrigger>
                <TabsTrigger value="365d" className="app-tabs-trigger px-2.5 text-xs">
                  {t("usage.last365days", { defaultValue: "一年" })}
                </TabsTrigger>
                <TabsTrigger value="custom" className="app-tabs-trigger px-2.5 text-xs">
                  <Calendar className="mr-1 h-3 w-3" />
                  {t("usage.custom", { defaultValue: "自定义" })}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {timeRange === "custom" && (
              <div className="flex items-center gap-1.5">
                <input
                  type="datetime-local"
                  className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
                <span className="text-[11px] text-muted-foreground">→</span>
                <input
                  type="datetime-local"
                  className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {days}{t("usage.daysLabel", { defaultValue: "天" })}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 2-tab layout: 总览 / 请求日志 ── */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="app-segmented flex h-10 w-fit">
          <TabsTrigger value="overview" className="app-tabs-trigger px-5">
            {t("usage.overview", { defaultValue: "总览" })}
          </TabsTrigger>
          <TabsTrigger value="logs" className="app-tabs-trigger px-5">
            {t("usage.requestLogs", { defaultValue: "请求日志" })}
          </TabsTrigger>
        </TabsList>

        {/* 总览 = 数据源 + 概览卡片 + 趋势图 + 供应商/模型统计 */}
        <TabsContent value="overview" className="mt-4 space-y-6">
          <Suspense fallback={barFallback}>
            <DataSourceBar refreshIntervalMs={refreshIntervalMs} />
          </Suspense>
          <Suspense fallback={cardFallback}>
            <UsageSummaryCards
              days={deferredDays}
              appType={deferredAppType}
              refreshIntervalMs={refreshIntervalMs}
            />
          </Suspense>
          <Suspense fallback={chartFallback}>
            <UsageTrendChart
              days={deferredDays}
              appType={deferredAppType}
              refreshIntervalMs={refreshIntervalMs}
            />
          </Suspense>
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-2">
              <h3 className="px-1 text-sm font-semibold text-foreground">
                {t("usage.providerStats", { defaultValue: "供应商统计" })}
              </h3>
              <Suspense fallback={tableFallback}>
                <ProviderStatsTable
                  appType={deferredAppType}
                  refreshIntervalMs={refreshIntervalMs}
                />
              </Suspense>
            </div>
            <div className="space-y-2">
              <h3 className="px-1 text-sm font-semibold text-foreground">
                {t("usage.modelStats", { defaultValue: "模型统计" })}
              </h3>
              <Suspense fallback={tableFallback}>
                <ModelStatsTable
                  appType={deferredAppType}
                  refreshIntervalMs={refreshIntervalMs}
                />
              </Suspense>
            </div>
          </div>
        </TabsContent>

        {/* 请求日志 */}
        <TabsContent value="logs" className="mt-4">
          <Suspense fallback={tableFallback}>
            <RequestLogTable
              appType={deferredAppType}
              refreshIntervalMs={refreshIntervalMs}
            />
          </Suspense>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
