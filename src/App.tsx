import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Check, Eye, EyeOff, FolderGit2, FolderArchive, LayoutGrid, Link2, MessageSquare, Moon, Pencil, RefreshCw, Save, Sun } from "lucide-react";
import { toast } from "sonner";

import { AppSwitcher } from "@/components/AppSwitcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/components/theme-provider";
import { settingsApi, type AppId, vscodeApi } from "@/lib/api";
import { useSessionsQuery } from "@/lib/query";
import { cn } from "@/lib/utils";
import { extractErrorMessage } from "@/utils/errorUtils";

const STORAGE_KEY = "cli-memory-last-app";
const PANEL_STORAGE_KEY = "cli-memory-utility-panel";
const PROJECT_DIR_KEY = "cli-memory-project-dir";
const PERSISTENT_BASE_KEY = "cli-memory-persistent-base";

const VALID_APPS: AppId[] = ["claude", "codex", "gemini", "opencode"];
type UtilityPanel =
  | "overview"
  | "usage"
  | "sessions"
  | "prompts"
  | "skills"
  | "skillsDiscovery"
  | "mcp"
  | "agents";
type ToolPanel = "prompts" | "skills" | "skillsDiscovery" | "mcp" | "agents";

const VALID_PANELS: UtilityPanel[] = [
  "overview",
  "usage",
  "sessions",
  "prompts",
  "skills",
  "skillsDiscovery",
  "mcp",
  "agents",
];

const loadLoginPage = () =>
  import("@/components/LoginPage").then((module) => ({
    default: module.LoginPage,
  }));
const loadUsageDashboard = () =>
  import("@/components/usage/UsageDashboard").then((module) => ({
    default: module.UsageDashboard,
  }));
const loadSessionManagerPage = () =>
  import("@/components/sessions/SessionManagerPage").then((module) => ({
    default: module.SessionManagerPage,
  }));
const loadToolsWorkspace = () => import("@/components/workspace/ToolsWorkspace");

const LoginPage = lazy(loadLoginPage);
const UsageDashboard = lazy(loadUsageDashboard);
const SessionManagerPage = lazy(loadSessionManagerPage);
const ToolsWorkspace = lazy(loadToolsWorkspace);

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|api[_-]?key|auth|cookie|session|credential|private[_-]?key)/i;
const pageContainerClass =
  "mx-auto flex w-full flex-1 flex-col gap-5 px-4 pb-8 md:px-6 lg:px-10 md:pb-10";
const toolbarNavButtonClass =
  "app-segmented-item h-9 shrink-0 px-3 text-[13px] font-medium";
const sectionBadgeClass =
  "border-black/[0.08] bg-white/70 text-muted-foreground shadow-sm dark:border-white/[0.08] dark:bg-white/[0.05]";
const utilityActionButtonClass =
  "border border-black/[0.08] bg-white/72 text-foreground shadow-sm hover:bg-white/92 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-foreground dark:hover:bg-white/[0.1]";

interface LocalConfigSection {
  id: string;
  label: string;
  preview: string;
  keys: string[];
}

const getInitialApp = (): AppId => {
  const saved = localStorage.getItem(STORAGE_KEY) as AppId | null;
  if (saved && VALID_APPS.includes(saved)) {
    return saved;
  }
  return "claude";
};

const getInitialUtilityPanel = (): UtilityPanel => {
  const saved = localStorage.getItem(PANEL_STORAGE_KEY) as UtilityPanel | null;
  if (saved && VALID_PANELS.includes(saved)) {
    return saved;
  }
  return "overview";
};

const maskSensitiveValue = (key: string, value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  if (!SENSITIVE_KEY_PATTERN.test(key)) {
    return value;
  }

  if (value.length <= 8) {
    return "********";
  }

  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
};

const sanitizeConfigValue = (value: unknown, key = ""): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeConfigValue(item, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeConfigValue(entryValue, entryKey),
      ]),
    );
  }

  return maskSensitiveValue(key, value);
};

const formatJsonPreview = (value: unknown, raw = false): string =>
  JSON.stringify(raw ? value : sanitizeConfigValue(value), null, 2) ?? "";

const formatEnvPreview = (value: unknown, raw = false): string => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  return Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${key}=${String(raw ? entryValue ?? "" : maskSensitiveValue(key, entryValue) ?? "")}`)
    .join("\n");
};

const formatTomlPreview = (value: string, raw = false): string =>
  raw
    ? value
    : value
        .split("\n")
        .map((line) => {
          const match = /^(\s*([\w.-]+)\s*=\s*)(.+)$/.exec(line);
          if (!match) {
            return line;
          }

          const [, prefix, key] = match;
          return SENSITIVE_KEY_PATTERN.test(key) ? `${prefix}"********"` : line;
        })
        .join("\n");

const collectObjectKeys = (value: unknown): string[] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.keys(value as Record<string, unknown>);
};

const dedupeLabels = (labels: string[]): string[] => Array.from(new Set(labels));

const truncatePath = (path: string): string => {
  if (path.length <= 72) {
    return path;
  }

  return `${path.slice(0, 28)}…${path.slice(-32)}`;
};

const buildLocalConfigSections = (
  appId: AppId,
  liveConfig: unknown,
  raw = false,
): LocalConfigSection[] => {
  if (!liveConfig) {
    return [];
  }

  if (appId === "codex" && typeof liveConfig === "object" && liveConfig !== null) {
    const codex = liveConfig as { auth?: unknown; config?: unknown };
    return [
      codex.auth
        ? {
            id: "auth",
            label: "auth.json",
            preview: formatJsonPreview(codex.auth, raw),
            keys: collectObjectKeys(codex.auth),
          }
        : null,
      typeof codex.config === "string"
        ? {
            id: "config",
            label: "config.toml",
            preview: formatTomlPreview(codex.config, raw),
            keys: dedupeLabels(
              codex.config
                .split("\n")
                .map((line) => /^(\s*([\w.-]+)\s*=)/.exec(line)?.[2] ?? "")
                .filter(Boolean),
            ),
          }
        : null,
    ].filter((section): section is LocalConfigSection => Boolean(section));
  }

  if (appId === "gemini" && typeof liveConfig === "object" && liveConfig !== null) {
    const gemini = liveConfig as { env?: unknown; config?: unknown };
    return [
      gemini.env
        ? {
            id: "env",
            label: ".env",
            preview: formatEnvPreview(gemini.env, raw),
            keys: collectObjectKeys(gemini.env),
          }
        : null,
      gemini.config
        ? {
            id: "config",
            label: "settings.json",
            preview: formatJsonPreview(gemini.config, raw),
            keys: collectObjectKeys(gemini.config),
          }
        : null,
    ].filter((section): section is LocalConfigSection => Boolean(section));
  }

  const fileLabel =
    appId === "claude"
      ? "settings.json"
      : appId === "opencode"
        ? "opencode.json"
        : "config.json";

  return [
    {
      id: "config",
      label: fileLabel,
      preview: formatJsonPreview(liveConfig, raw),
      keys: collectObjectKeys(liveConfig),
    },
  ];
};

const TOOL_VERSION_APPS: Partial<Record<AppId, "claude" | "codex" | "gemini" | "opencode">> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
};

const formatRefreshTime = (updatedAt: number | undefined, fallback: string): string => {
  if (!updatedAt) {
    return fallback;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(updatedAt);
};

const statusToneClass = (tone: "positive" | "warning" | "neutral"): string => {
  switch (tone) {
    case "positive":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "warning":
      return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    default:
      return "border-black/[0.08] bg-white/72 text-muted-foreground dark:border-white/[0.08] dark:bg-white/[0.05]";
  }
};

function App() {
  const { t } = useTranslation();
  const { isLoading: authLoading, isAuthenticated, authEnabled } = useAuth();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();

  const [activeApp, setActiveApp] = useState<AppId>(getInitialApp);
  const [utilityPanel, setUtilityPanel] = useState<UtilityPanel>(getInitialUtilityPanel);
  const [showRawValues, setShowRawValues] = useState(false);
  const [selectedProjectDir, setSelectedProjectDir] = useState<string | null>(
    () => localStorage.getItem(PROJECT_DIR_KEY),
  );
  const [persistentBase, setPersistentBase] = useState<string>(
    () => localStorage.getItem(PERSISTENT_BASE_KEY) || "/volume/pt-coder/users/wzhang",
  );
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    localStorage.setItem(PANEL_STORAGE_KEY, utilityPanel);
  }, [utilityPanel]);

  useEffect(() => {
    if (selectedProjectDir) {
      localStorage.setItem(PROJECT_DIR_KEY, selectedProjectDir);
    } else {
      localStorage.removeItem(PROJECT_DIR_KEY);
    }
  }, [selectedProjectDir]);

  useEffect(() => {
    localStorage.setItem(PERSISTENT_BASE_KEY, persistentBase);
  }, [persistentBase]);

  const hasUsageSupport =
    activeApp === "claude" || activeApp === "codex" || activeApp === "gemini" || activeApp === "opencode";
  const hasSessionSupport =
    activeApp === "claude" ||
    activeApp === "codex" ||
    activeApp === "opencode" ||
    activeApp === "gemini";

  // When switching apps, fall back to "overview" if current panel is unsupported
  useEffect(() => {
    if (utilityPanel === "usage" && !hasUsageSupport) {
      setUtilityPanel("overview");
    } else if (utilityPanel === "sessions" && !hasSessionSupport) {
      setUtilityPanel("overview");
    }
  }, [activeApp, utilityPanel, hasUsageSupport, hasSessionSupport]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const warmUpPanels = () => {
      void loadUsageDashboard();
      void loadSessionManagerPage();
      void loadToolsWorkspace();
    };

    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warmUpPanels, { timeout: 1800 });
      return () => window.cancelIdleCallback(id);
    }

    const timer = globalThis.setTimeout(warmUpPanels, 1200);
    return () => globalThis.clearTimeout(timer);
  }, []);

  const {
    data: configDir,
    error: configDirError,
    refetch: refetchConfigDir,
    isFetching: isConfigDirFetching,
    dataUpdatedAt: configDirUpdatedAt,
  } = useQuery({
    queryKey: ["configDir", activeApp],
    queryFn: () => settingsApi.getConfigDir(activeApp),
    retry: false,
  });

  const {
    data: configStatus,
    error: configStatusError,
    refetch: refetchConfigStatus,
    isFetching: isConfigStatusFetching,
    dataUpdatedAt: configStatusUpdatedAt,
  } = useQuery({
    queryKey: ["configStatus", activeApp],
    queryFn: () => settingsApi.getConfigStatus(activeApp),
    retry: false,
  });

  const {
    data: liveConfig,
    refetch: refetchLiveConfig,
    isFetching: isLiveConfigFetching,
    dataUpdatedAt: liveConfigUpdatedAt,
  } = useQuery({
    queryKey: ["live-provider-settings", activeApp],
    queryFn: () => vscodeApi.getLiveProviderSettings(activeApp),
    retry: false,
  });

  const activeToolVersionApp = TOOL_VERSION_APPS[activeApp];

  const {
    data: activeToolVersions,
    error: toolVersionError,
    refetch: refetchToolVersion,
    isFetching: isToolVersionFetching,
    dataUpdatedAt: toolVersionUpdatedAt,
  } = useQuery({
    queryKey: ["toolVersion", activeToolVersionApp],
    queryFn: () => settingsApi.getToolVersions(activeToolVersionApp ? [activeToolVersionApp] : []),
    enabled: Boolean(activeToolVersionApp),
    retry: false,
  });

  const {
    data: claudeOfficialAuthStatus,
    error: claudeOfficialAuthError,
    refetch: refetchClaudeOfficialAuthStatus,
    isFetching: isClaudeOfficialAuthFetching,
    dataUpdatedAt: claudeOfficialAuthUpdatedAt,
  } = useQuery({
    queryKey: ["claudeOfficialAuthStatus"],
    queryFn: () => settingsApi.getClaudeOfficialAuthStatus(),
    enabled: activeApp === "claude",
    retry: false,
  });

  // Sessions for project directory extraction
  const { data: sessionsData } = useSessionsQuery();
  const projectDirs = useMemo(() => {
    if (!sessionsData) return [];
    const dirs = new Set<string>();
    for (const session of sessionsData) {
      if (session.projectDir) dirs.add(session.projectDir);
    }
    return Array.from(dirs).sort();
  }, [sessionsData]);

  // Global-level config reading (all files including auth/credentials)
  const {
    data: globalConfigs,
    isFetching: isGlobalConfigFetching,
    refetch: refetchGlobalConfigs,
  } = useQuery({
    queryKey: ["globalConfigs", activeApp],
    queryFn: () => vscodeApi.readGlobalConfigs(activeApp),
    retry: false,
  });

  // Project-level config reading
  const {
    data: projectConfigs,
    isFetching: isProjectConfigFetching,
    refetch: refetchProjectConfigs,
  } = useQuery({
    queryKey: ["projectConfigs", activeApp, selectedProjectDir],
    queryFn: () => vscodeApi.readProjectConfigs(activeApp, selectedProjectDir!),
    enabled: Boolean(selectedProjectDir),
    retry: false,
  });

  // Symlink status
  const {
    data: symlinkStatus,
    refetch: refetchSymlinkStatus,
  } = useQuery({
    queryKey: ["symlinkStatus", persistentBase],
    queryFn: () => vscodeApi.getSymlinkStatus(persistentBase),
    retry: false,
  });

  const handleCreateSymlink = useCallback(async (app: string) => {
    try {
      await vscodeApi.createConfigSymlink(app, persistentBase);
      toast.success(t("common.symlinkCreated", { defaultValue: `${app} 配置已链接到持久化目录` }));
      await refetchSymlinkStatus();
      await queryClient.invalidateQueries({ queryKey: ["globalConfigs"] });
    } catch (error) {
      toast.error(extractErrorMessage(error) || t("common.symlinkFailed", { defaultValue: "创建链接失败" }));
    }
  }, [persistentBase, refetchSymlinkStatus, queryClient, t]);

  const handleSaveConfigFile = useCallback(async (filePath: string, content: string) => {
    setIsSaving(true);
    try {
      await vscodeApi.writeConfigFile(filePath, content);
      toast.success(t("common.saved", { defaultValue: "已保存" }));
      setEditingFile(null);
      // Refresh all config queries
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["live-provider-settings", activeApp] }),
        queryClient.invalidateQueries({ queryKey: ["globalConfigs", activeApp] }),
        selectedProjectDir
          ? queryClient.invalidateQueries({ queryKey: ["projectConfigs", activeApp, selectedProjectDir] })
          : Promise.resolve(),
      ]);
    } catch (error) {
      toast.error(extractErrorMessage(error) || t("common.saveFailed", { defaultValue: "保存失败" }));
    } finally {
      setIsSaving(false);
    }
  }, [activeApp, selectedProjectDir, queryClient, t]);

  const configSections = useMemo(
    () => buildLocalConfigSections(activeApp, liveConfig, showRawValues),
    [activeApp, liveConfig, showRawValues],
  );
  const configKeySummary = useMemo(
    () => dedupeLabels(configSections.flatMap((section) => section.keys)),
    [configSections],
  );
  const activeToolVersion = activeToolVersions?.[0] ?? null;
  const configPreviewUpdatedAt = Math.max(
    configDirUpdatedAt || 0,
    configStatusUpdatedAt || 0,
    liveConfigUpdatedAt || 0,
    toolVersionUpdatedAt || 0,
    claudeOfficialAuthUpdatedAt || 0,
  );
  const isConfigRefreshing =
    isConfigDirFetching ||
    isConfigStatusFetching ||
    isLiveConfigFetching ||
    isToolVersionFetching ||
    isClaudeOfficialAuthFetching;

  const toolPanels: ToolPanel[] = ["skills", "prompts", "mcp", "skillsDiscovery"];
  const primaryPage: "overview" | "usage" | "sessions" | "tools" =
    utilityPanel === "usage"
      ? "usage"
      : utilityPanel === "sessions"
        ? "sessions"
        : toolPanels.includes(utilityPanel as ToolPanel)
          ? "tools"
          : "overview";
  const activeToolPanel: ToolPanel = toolPanels.includes(utilityPanel as ToolPanel)
    ? (utilityPanel as ToolPanel)
    : "skills";

  /** Map AppId to the usage API app filter string */
  const usageAppFilter =
    activeApp === "claude"
      ? "claude"
      : activeApp === "codex"
        ? "codex"
        : activeApp === "gemini"
          ? "gemini"
          : activeApp === "opencode"
            ? "opencode"
            : "all";

  const primaryPageItems = [
    {
      id: "overview" as const,
      label: t("common.status", { defaultValue: "状态" }),
      icon: <LayoutGrid className="h-4 w-4" />,
      onSelect: () => setUtilityPanel("overview"),
    },
    ...(hasSessionSupport
      ? [
          {
            id: "sessions" as const,
            label: t("sessionManager.title", { defaultValue: "会话管理" }),
            icon: <MessageSquare className="h-4 w-4" />,
            onSelect: () => setUtilityPanel("sessions"),
          },
        ]
      : []),
    ...(hasUsageSupport
      ? [
          {
            id: "usage" as const,
            label: t("usage.title", { defaultValue: "使用统计" }),
            icon: <BarChart3 className="h-4 w-4" />,
            onSelect: () => setUtilityPanel("usage"),
          },
        ]
      : []),
    {
      id: "tools" as const,
      label: t("common.tools", { defaultValue: "工具" }),
      icon: <FolderArchive className="h-4 w-4" />,
      onSelect: () => setUtilityPanel(activeToolPanel),
    },
  ];

  const handleRefreshLocalConfig = async () => {
    const refreshTasks = [refetchConfigDir(), refetchConfigStatus(), refetchLiveConfig()];

    if (activeToolVersionApp) {
      refreshTasks.push(refetchToolVersion());
    }

    if (activeApp === "claude") {
      refreshTasks.push(refetchClaudeOfficialAuthStatus());
    }

    await Promise.all(refreshTasks);
  };

  const renderOverviewPage = () => {
    const configDetected = Boolean(configStatus?.exists || configSections.length > 0);
    const configStatusPath = configStatus?.path ?? null;
    const configSourcesSummary =
      configSections.length > 0
        ? configSections.map((section) => section.label).join(" · ")
        : t("common.noConfigDetected", { defaultValue: "未检测到可展示的配置内容" });
    const toolRuntimeLabel = activeToolVersion?.version
      ? `v${activeToolVersion.version}`
      : activeToolVersion?.error || toolVersionError
        ? t("common.unavailable", { defaultValue: "不可用" })
        : activeToolVersionApp
          ? t("common.notDetected", { defaultValue: "未检测到" })
          : t("common.notApplicable", { defaultValue: "不适用" });
    const toolRuntimeHint = toolVersionError
      ? extractErrorMessage(toolVersionError)
      : activeToolVersion?.error
        ? activeToolVersion.error
        : activeToolVersion
          ? [
              activeToolVersion.env_type.toUpperCase(),
              activeToolVersion.wsl_distro,
            ]
              .filter(Boolean)
              .join(" · ")
          : activeToolVersionApp
            ? t(`apps.${activeToolVersionApp}`)
            : t("common.currentStatusDescription", {
                defaultValue: "这里直接读取当前应用在本机上的真实配置文件，不再显示 Provider 切换和代理控制。",
              });

    let authValue = "";
    let authHint = "";
    let authTone: "positive" | "warning" | "neutral" = "neutral";
    let authBadge = "";

    if (activeApp === "claude") {
      if (claudeOfficialAuthError) {
        authValue = "不可用";
        authHint = extractErrorMessage(claudeOfficialAuthError);
        authTone = "warning";
        authBadge = "AUTH";
      } else if (claudeOfficialAuthStatus?.authenticated) {
        authValue = "已登录";
        authHint =
          claudeOfficialAuthStatus.detail ||
          truncatePath(claudeOfficialAuthStatus.credentialsPath);
        authTone = "positive";
        authBadge = "READY";
      } else if (claudeOfficialAuthStatus?.credentialStatus === "expired") {
        authValue = "凭据过期";
        authHint =
          claudeOfficialAuthStatus.detail ||
          truncatePath(claudeOfficialAuthStatus.credentialsPath);
        authTone = "warning";
        authBadge = "EXPIRED";
      } else if (claudeOfficialAuthStatus?.credentialStatus === "not_found") {
        authValue = "未登录";
        authHint = truncatePath(claudeOfficialAuthStatus.credentialsPath);
        authTone = "neutral";
        authBadge = "EMPTY";
      } else if (claudeOfficialAuthStatus?.credentialStatus === "parse_error") {
        authValue = "配置异常";
        authHint =
          claudeOfficialAuthStatus.detail ||
          truncatePath(claudeOfficialAuthStatus.credentialsPath);
        authTone = "warning";
        authBadge = "CHECK";
      } else {
        authValue = "待检查";
        authHint =
          claudeOfficialAuthStatus?.detail ||
          claudeOfficialAuthStatus?.credentialStatus ||
          truncatePath(claudeOfficialAuthStatus?.credentialsPath || "");
        authTone = "warning";
        authBadge = "CHECK";
      }
    }

    const summaryCards: Array<{
      label: string;
      value: string;
      hint: string;
      tone: "positive" | "warning" | "neutral";
      badge: string;
    }> = [
      {
        label: t("common.configDetected", { defaultValue: "配置检测" }),
        value: configDetected
          ? t("common.detected", { defaultValue: "已检测到" })
          : t("common.notDetected", { defaultValue: "未检测到" }),
        hint:
          configStatusError
            ? extractErrorMessage(configStatusError)
            : configStatusPath || configSourcesSummary,
        tone: configDetected ? "positive" : "warning",
        badge: configDetected ? "READY" : "EMPTY",
      },
      {
        label: t("common.configSources", { defaultValue: "配置来源" }),
        value: t("common.filesCount", {
          defaultValue: `${configSections.length} 份`,
          count: configSections.length,
        }),
        hint: configSourcesSummary,
        tone: configSections.length > 0 ? "positive" : "neutral",
        badge: configSections.length > 1 ? "MULTI" : "FILE",
      },
      {
        label: t("common.localCli", { defaultValue: "本地 CLI" }),
        value: toolRuntimeLabel,
        hint: toolRuntimeHint,
        tone:
          activeToolVersion?.version
            ? "positive"
            : activeToolVersion?.error || toolVersionError
              ? "warning"
              : "neutral",
        badge: activeToolVersion?.version ? "LOCAL" : "CHECK",
      },
      {
        label: t("common.detectedKeys", { defaultValue: "变量名 / 顶层键" }),
        value: `${configKeySummary.length} ${t("common.items", { defaultValue: "个" })}`,
        hint:
          configKeySummary.length > 0
            ? configKeySummary.join(" · ")
            : t("common.noKeysDetected", { defaultValue: "没有可提取的键名" }),
        tone: configKeySummary.length > 0 ? "positive" : "neutral",
        badge: "READ",
      },
      ...(activeApp === "claude"
        ? [
            {
              label: t("common.authStatus", { defaultValue: "官方认证" }),
              value: authValue,
              hint: authHint,
              tone: authTone,
              badge: authBadge,
            },
          ]
        : []),
    ];

    return (
      <div className={pageContainerClass}>
        <section className="app-shell relative overflow-hidden px-5 py-5 lg:px-6 lg:py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={sectionBadgeClass}>
                  {t(`apps.${activeApp}`)}
                </Badge>
                <Badge variant="outline" className={sectionBadgeClass}>
                  {t("common.status", { defaultValue: "状态" })}
                </Badge>
                <Badge variant="outline" className={sectionBadgeClass}>
                  {t("common.readOnlyPreview", { defaultValue: "只读预览" })}
                </Badge>
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground md:text-[2rem]">
                {t("common.currentStatus", { defaultValue: "当前状态" })}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {t("common.currentStatusDescription", {
                  defaultValue:
                    "这里直接读取当前应用在本机上的真实配置文件，不再显示 Provider 切换和代理控制。",
                })}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="liquid-pill">
                  {t("common.lastUpdated", { defaultValue: "最近刷新" })} ·{" "}
                  {formatRefreshTime(
                    configPreviewUpdatedAt || undefined,
                    t("common.notUpdated", { defaultValue: "未刷新" }),
                  )}
                </span>
                <button
                  type="button"
                  className={cn(
                    "liquid-pill inline-flex cursor-pointer items-center gap-1.5 transition-colors",
                    showRawValues
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : "",
                  )}
                  onClick={() => setShowRawValues((v) => !v)}
                >
                  {showRawValues ? (
                    <Eye className="h-3 w-3" />
                  ) : (
                    <EyeOff className="h-3 w-3" />
                  )}
                  {showRawValues
                    ? t("common.showingRawValues", { defaultValue: "显示原始值" })
                    : t("common.maskedSecrets", { defaultValue: "敏感密钥已脱敏" })}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                className={utilityActionButtonClass}
                onClick={() => void handleRefreshLocalConfig()}
                disabled={isConfigRefreshing}
              >
                <RefreshCw
                  className={cn("mr-2 h-4 w-4", isConfigRefreshing && "animate-spin")}
                />
                {t("common.refresh", { defaultValue: "刷新" })}
              </Button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {summaryCards.map((card) => (
              <div key={card.label} className="app-panel-inset px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      {card.label}
                    </div>
                    <div className="mt-3 text-lg font-semibold text-foreground">
                      {card.value}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-muted-foreground">
                      {card.hint}
                    </div>
                  </div>
                  <span className={cn("liquid-pill", statusToneClass(card.tone))}>
                    {card.badge}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* ── Paths & detected info ── */}
          <div className="app-panel-inset mt-3 px-4 py-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  {t("settings.advanced.configDir.title", { defaultValue: "配置目录" })}
                </div>
                <div className="mt-2 break-all font-mono text-sm leading-6 text-foreground">
                  {configDirError
                    ? extractErrorMessage(configDirError)
                    : configDir ?? t("common.loading", { defaultValue: "读取中" })}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  {t("common.statusPath", { defaultValue: "状态路径" })}
                </div>
                <div className="mt-2 break-all font-mono text-sm leading-6 text-foreground">
                  {configStatusError
                    ? extractErrorMessage(configStatusError)
                    : configStatus?.path ||
                      t("common.noConfigDetected", {
                        defaultValue: "未检测到可展示的配置内容",
                      })}
                </div>
              </div>
            </div>

            <div className="mt-5 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              {t("common.detectedKeys", { defaultValue: "变量名 / 顶层键" })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {configKeySummary.length > 0 ? (
                configKeySummary.map((label) => (
                  <span key={label} className="liquid-pill">
                    {label}
                  </span>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">
                  {t("common.noKeysDetected", { defaultValue: "没有可提取的键名" })}
                </span>
              )}
            </div>
          </div>

          {/* ── Symlink / persistent storage ── */}
          {symlinkStatus?.items && symlinkStatus.items.length > 0 && (
            <div className="mt-4">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {t("common.persistentLink", { defaultValue: "持久化链接" })}
                </h3>
                <Badge variant="outline" className={sectionBadgeClass}>Symlink</Badge>
              </div>
              <div className="app-panel-inset px-4 py-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">
                    {t("common.persistentBase", { defaultValue: "持久化目录" })}:
                  </span>
                  <input
                    type="text"
                    className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                    value={persistentBase}
                    onChange={(e) => setPersistentBase(e.target.value)}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {symlinkStatus.items.map((item) => (
                    <div key={item.app} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{item.dirName}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {item.status === "linked"
                            ? `→ ${item.linkTarget}`
                            : item.status === "linked_other"
                              ? `→ ${item.linkTarget} (其他)`
                              : item.status === "local_dir"
                                ? t("common.localDir", { defaultValue: "本地目录（未链接）" })
                                : t("common.notFound", { defaultValue: "不存在" })}
                        </div>
                      </div>
                      {item.status === "linked" ? (
                        <Badge variant="outline" className="shrink-0 border-emerald-500/25 bg-emerald-500/10 text-emerald-700 text-xs">
                          <Link2 className="mr-1 h-3 w-3" />OK
                        </Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 shrink-0 gap-1 text-xs"
                          onClick={() => void handleCreateSymlink(item.app)}
                        >
                          <Link2 className="h-3 w-3" />
                          {t("common.link", { defaultValue: "链接" })}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Global config files (editable, includes auth/credentials) ── */}
          <div className="mt-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {t("common.globalConfig", { defaultValue: "全局配置" })}
                </h3>
                <Badge variant="outline" className={sectionBadgeClass}>Global</Badge>
                {globalConfigs?.files && (
                  <span className="text-xs text-muted-foreground">
                    {globalConfigs.files.length} {t("common.filesFound", { defaultValue: "个文件" })}
                  </span>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => void refetchGlobalConfigs()}
                disabled={isGlobalConfigFetching}
              >
                <RefreshCw className={cn("h-3 w-3", isGlobalConfigFetching && "animate-spin")} />
              </Button>
            </div>
            {!globalConfigs?.files || globalConfigs.files.length === 0 ? (
              <div className="app-panel-inset px-4 py-4 text-sm text-muted-foreground">
                {t("common.noConfigPreview", {
                  defaultValue: "当前应用没有可预览的本地配置内容。",
                })}
              </div>
            ) : (
              <div className="grid gap-3">
                {globalConfigs.files.map((file) => {
                  const isFileEditing = editingFile === file.fullPath;
                  const displayContent = showRawValues
                    ? (file.content ?? "")
                    : (file.fileType === "json" && file.content
                      ? formatJsonPreview(JSON.parse(file.content))
                      : file.fileType === "toml" && file.content
                        ? formatTomlPreview(file.content)
                        : file.fileType === "env" && file.content
                          ? formatEnvPreview(
                              Object.fromEntries(
                                file.content.split("\n")
                                  .filter((l: string) => l.includes("=") && !l.startsWith("#"))
                                  .map((l: string) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
                              ),
                            )
                          : (file.content ?? ""));

                  return (
                    <div key={file.fullPath} className="app-panel-inset px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">{file.path}</span>
                          <span className="liquid-pill text-xs">{file.fileType}</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 text-xs"
                          onClick={() => {
                            if (isFileEditing) {
                              setEditingFile(null);
                            } else {
                              setEditingFile(file.fullPath);
                              setEditContent(file.content ?? "");
                            }
                          }}
                        >
                          {isFileEditing ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                          {isFileEditing
                            ? t("common.cancel", { defaultValue: "取消" })
                            : t("common.edit", { defaultValue: "编辑" })}
                        </Button>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground break-all">{file.fullPath}</div>
                      {file.error ? (
                        <div className="mt-2 text-xs text-red-500">{file.error}</div>
                      ) : isFileEditing ? (
                        <div className="mt-3">
                          <textarea
                            className="w-full rounded-xl border border-border bg-slate-950/[0.92] p-4 font-mono text-[12px] leading-6 text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
                            rows={Math.min(Math.max((editContent.split("\n").length) + 2, 6), 30)}
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                          />
                          <div className="mt-2 flex justify-end">
                            <Button
                              type="button"
                              size="sm"
                              className="gap-1.5"
                              disabled={isSaving}
                              onClick={() => void handleSaveConfigFile(file.fullPath, editContent)}
                            >
                              <Save className="h-3.5 w-3.5" />
                              {isSaving
                                ? t("common.saving", { defaultValue: "保存中..." })
                                : t("common.save", { defaultValue: "保存" })}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg border border-black/[0.08] bg-slate-950/[0.92] p-4 dark:border-white/[0.08]">
                          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-6 text-slate-100">
                            {displayContent}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Project directory selector ── */}
          <div className="mt-6">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {t("common.projectConfig", { defaultValue: "项目配置" })}
              </h3>
              <Badge variant="outline" className={sectionBadgeClass}>Project</Badge>
            </div>
            <div className="app-panel-inset px-4 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <FolderGit2 className="h-4 w-4 text-muted-foreground shrink-0" />
                {projectDirs.length > 0 ? (
                  <select
                    className="flex-1 min-w-0 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={selectedProjectDir ?? ""}
                    onChange={(e) => setSelectedProjectDir(e.target.value || null)}
                  >
                    <option value="">
                      {t("common.selectProject", { defaultValue: "选择项目目录（从会话记录推断）" })}
                    </option>
                    {projectDirs.map((dir) => (
                      <option key={dir} value={dir}>
                        {dir}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t("common.noProjectDirs", { defaultValue: "暂无项目目录（可在会话管理中查看历史会话）" })}
                  </span>
                )}
                {selectedProjectDir && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => void refetchProjectConfigs()}
                    disabled={isProjectConfigFetching}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", isProjectConfigFetching && "animate-spin")} />
                  </Button>
                )}
              </div>

              {/* Project config files */}
              {selectedProjectDir && projectConfigs?.files && projectConfigs.files.length > 0 && (
                <div className="mt-4 grid gap-3">
                  {projectConfigs.files.map((file) => {
                    const isEditing2 = editingFile === file.fullPath;

                    return (
                      <div key={file.path} className="rounded-xl border border-border/50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{file.path}</span>
                            <span className="liquid-pill text-xs">{file.fileType}</span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-xs"
                            onClick={() => {
                              if (isEditing2) {
                                setEditingFile(null);
                              } else {
                                setEditingFile(file.fullPath);
                                setEditContent(file.content ?? "");
                              }
                            }}
                          >
                            {isEditing2 ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                            {isEditing2
                              ? t("common.cancel", { defaultValue: "取消" })
                              : t("common.edit", { defaultValue: "编辑" })}
                          </Button>
                        </div>
                        {file.error ? (
                          <div className="mt-2 text-xs text-red-500">{file.error}</div>
                        ) : isEditing2 ? (
                          <div className="mt-2">
                            <textarea
                              className="w-full rounded-lg border border-border bg-slate-950/[0.92] p-3 font-mono text-[12px] leading-6 text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
                              rows={Math.min(Math.max((editContent.split("\n").length) + 2, 6), 30)}
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                            />
                            <div className="mt-2 flex justify-end">
                              <Button
                                type="button"
                                size="sm"
                                className="gap-1.5"
                                disabled={isSaving}
                                onClick={() => void handleSaveConfigFile(file.fullPath, editContent)}
                              >
                                <Save className="h-3.5 w-3.5" />
                                {isSaving
                                  ? t("common.saving", { defaultValue: "保存中..." })
                                  : t("common.save", { defaultValue: "保存" })}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 rounded-lg bg-slate-950/[0.92] p-3">
                            <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-6 text-slate-100">
                              {file.content ?? ""}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {selectedProjectDir && projectConfigs?.files && projectConfigs.files.length === 0 && (
                <div className="mt-3 text-sm text-muted-foreground">
                  {t("common.noProjectConfig", { defaultValue: "该项目目录下未检测到配置文件。" })}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    );
  };

  const renderPageSuspenseFallback = (title: string) => (
    <div className={pageContainerClass}>
      <section className="app-shell flex min-h-[440px] flex-1 flex-col overflow-hidden">
        <div className="border-b border-border-default/60 px-5 py-4 lg:px-6">
          <div className="text-lg font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {t("common.loading", { defaultValue: "读取中" })}
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {t("common.loading", { defaultValue: "读取中" })}
          </div>
        </div>
      </section>
    </div>
  );

  const renderContent = () => {
    if (primaryPage === "overview") {
      return renderOverviewPage();
    }

    if (primaryPage === "usage") {
      return (
        <Suspense
          fallback={renderPageSuspenseFallback(
            t("usage.title", { defaultValue: "统计" }),
          )}
        >
          <div className={pageContainerClass}>
            <UsageDashboard embedded appType={usageAppFilter} />
          </div>
        </Suspense>
      );
    }

    if (primaryPage === "sessions") {
      return (
        <Suspense
          fallback={renderPageSuspenseFallback(
            t("sessionManager.title", { defaultValue: "会话" }),
          )}
        >
          <div className={pageContainerClass}>
            <SessionManagerPage key={activeApp} appId={activeApp} />
          </div>
        </Suspense>
      );
    }

    return (
      <Suspense
        fallback={renderPageSuspenseFallback(
          t("common.tools", { defaultValue: "工具" }),
        )}
      >
        <ToolsWorkspace
          activeApp={activeApp}
          activeToolPanel={activeToolPanel}
          onToolPanelChange={setUtilityPanel}
        />
      </Suspense>
    );
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            {t("auth.checking", { defaultValue: "Checking authentication..." })}
          </p>
        </div>
      </div>
    );
  }

  if (authEnabled && !isAuthenticated) {
    return (
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center bg-background" />
        }
      >
        <LoginPage />
      </Suspense>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-primary/30">
      <header className="sticky top-0 z-40 px-4 pt-4 md:px-6 lg:px-10">
        <div className="app-toolbar-shell mx-auto flex h-[60px] items-center justify-between gap-3 px-3 md:px-4">
          <span className="text-lg font-semibold tracking-tight text-foreground">
            CLI Memory
          </span>

          <div className="flex min-w-0 items-center justify-end gap-2 overflow-x-auto py-3 pr-1">
            <AppSwitcher activeApp={activeApp} onSwitch={setActiveApp} />
            <div className="app-segmented flex min-w-0 items-center overflow-x-auto">
              {primaryPageItems.map((panel) => (
                <Button
                  key={panel.id}
                  variant="ghost"
                  size="sm"
                  onClick={panel.onSelect}
                  aria-pressed={primaryPage === panel.id}
                  className={cn(
                    toolbarNavButtonClass,
                    primaryPage === panel.id && "shadow-sm",
                  )}
                  data-active={primaryPage === panel.id}
                >
                  <span className="mr-2 inline-flex items-center justify-center">
                    {panel.icon}
                  </span>
                  {panel.label}
                </Button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 shrink-0 rounded-full p-0"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col overflow-y-auto pt-5 animate-fade-in">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[320px] overflow-hidden"
        >
          <div className="absolute -left-16 top-[-120px] h-64 w-64 rounded-full bg-orange-500/12 blur-3xl" />
          <div className="absolute right-[-80px] top-[-140px] h-72 w-72 rounded-full bg-blue-500/12 blur-3xl" />
        </div>
        {renderContent()}
      </main>
    </div>
  );
}

export default App;
