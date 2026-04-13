import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  Trash2,
  ExternalLink,
  RefreshCw,
  Loader2,
  ArrowRightLeft,
  CheckCheck,
  CircleOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  type ImportSkillSelection,
  useInstalledSkills,
  useToggleSkillApp,
  useUninstallSkill,
  useScanUnmanagedSkills,
  useImportSkillsFromApps,
  useCheckSkillUpdates,
  useUpdateSkill,
  type InstalledSkill,
  type SkillUpdateInfo,
} from "@/hooks/useSkills";
import type { AppId } from "@/lib/api/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { settingsApi } from "@/lib/api";
import { toast } from "sonner";
import { MCP_SKILLS_APP_IDS } from "@/config/appConfig";
import { APP_ICON_MAP } from "@/config/appConfig";
import { AppCountBar } from "@/components/common/AppCountBar";
import { AppToggleGroup } from "@/components/common/AppToggleGroup";
import { ListItemRow } from "@/components/common/ListItemRow";

interface UnifiedSkillsPanelProps {
  onOpenDiscovery: () => void;
  currentApp: AppId;
}

export interface UnifiedSkillsPanelHandle {
  openDiscovery: () => void;
  openImport: () => void;
  checkUpdates: () => void;
}

const UnifiedSkillsPanel = React.forwardRef<
  UnifiedSkillsPanelHandle,
  UnifiedSkillsPanelProps
>(({ onOpenDiscovery, currentApp }, ref) => {
  const { t } = useTranslation();
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    variant?: "destructive" | "info";
    onConfirm: () => void;
  } | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const { data: skills, isLoading } = useInstalledSkills();
  const toggleAppMutation = useToggleSkillApp();
  const uninstallMutation = useUninstallSkill();
  const { data: unmanagedSkills, refetch: scanUnmanaged } =
    useScanUnmanagedSkills();
  const importMutation = useImportSkillsFromApps();
  const {
    data: skillUpdates,
    refetch: checkUpdates,
    isFetching: isCheckingUpdates,
  } = useCheckSkillUpdates();
  const updateSkillMutation = useUpdateSkill();
  const [isUpdatingAll, setIsUpdatingAll] = useState(false);

  const updatesMap = useMemo(() => {
    const map: Record<string, SkillUpdateInfo> = {};
    if (skillUpdates) {
      for (const u of skillUpdates) {
        map[u.id] = u;
      }
    }
    return map;
  }, [skillUpdates]);

  const enabledCounts = useMemo(() => {
    const counts = { claude: 0, codex: 0, gemini: 0, opencode: 0, openclaw: 0 };
    if (!skills) return counts;
    skills.forEach((skill) => {
      for (const app of MCP_SKILLS_APP_IDS) {
        if (skill.apps[app]) counts[app]++;
      }
    });
    return counts;
  }, [skills]);

  const handleToggleApp = async (id: string, app: AppId, enabled: boolean) => {
    try {
      await toggleAppMutation.mutateAsync({ id, app, enabled });
    } catch (error) {
      toast.error(t("common.error"), { description: String(error) });
    }
  };

  const handleApplyApps = async (
    id: string,
    targetApps: Record<AppId, boolean>,
    currentApps: Record<AppId, boolean>,
  ) => {
    try {
      for (const app of MCP_SKILLS_APP_IDS) {
        const nextEnabled = targetApps[app];
        if (currentApps[app] === nextEnabled) continue;
        await toggleAppMutation.mutateAsync({ id, app, enabled: nextEnabled });
      }
    } catch (error) {
      toast.error(t("common.error"), { description: String(error) });
    }
  };

  const handleUninstall = (skill: InstalledSkill) => {
    setConfirmDialog({
      isOpen: true,
      title: t("skills.uninstall"),
      message: t("skills.uninstallConfirm", { name: skill.name }),
      onConfirm: async () => {
        try {
          // 构建 skillKey 用于更新 discoverable 缓存
          const installName =
            skill.directory.split(/[/\\]/).pop()?.toLowerCase() ||
            skill.directory.toLowerCase();
          const skillKey = `${installName}:${skill.repoOwner?.toLowerCase() || ""}:${skill.repoName?.toLowerCase() || ""}`;

          const result = await uninstallMutation.mutateAsync({
            id: skill.id,
            skillKey,
          });
          setConfirmDialog(null);
          toast.success(t("skills.uninstallSuccess", { name: skill.name }), {
            description: result.backupPath
              ? t("skills.backup.location", { path: result.backupPath })
              : undefined,
            closeButton: true,
          });
        } catch (error) {
          toast.error(t("common.error"), { description: String(error) });
        }
      },
    });
  };

  const handleOpenImport = async () => {
    try {
      const result = await scanUnmanaged();
      if (!result.data || result.data.length === 0) {
        toast.success(t("skills.noUnmanagedFound"), { closeButton: true });
        return;
      }
      setImportDialogOpen(true);
    } catch (error) {
      toast.error(t("common.error"), { description: String(error) });
    }
  };

  const handleImport = async (imports: ImportSkillSelection[]) => {
    try {
      const imported = await importMutation.mutateAsync(imports);
      setImportDialogOpen(false);
      toast.success(t("skills.importSuccess", { count: imported.length }), {
        closeButton: true,
      });
    } catch (error) {
      toast.error(t("common.error"), { description: String(error) });
    }
  };

  const handleCheckUpdates = async () => {
    try {
      const result = await checkUpdates();
      const updates = result.data || [];
      if (updates.length === 0) {
        toast.success(t("skills.noUpdates"), { closeButton: true });
      } else {
        toast.info(t("skills.updatesFound", { count: updates.length }), {
          closeButton: true,
        });
      }
    } catch (error) {
      toast.error(t("common.error"), { description: String(error) });
    }
  };

  const handleUpdateSkill = async (skill: InstalledSkill) => {
    try {
      const updated = await updateSkillMutation.mutateAsync(skill.id);
      toast.success(t("skills.updateSuccess", { name: updated.name }), {
        closeButton: true,
      });
    } catch (error) {
      toast.error(t("skills.updateFailed"), { description: String(error) });
    }
  };

  const handleUpdateAll = async () => {
    if (!skillUpdates || skillUpdates.length === 0) return;
    setIsUpdatingAll(true);
    let successCount = 0;
    for (const update of skillUpdates) {
      try {
        await updateSkillMutation.mutateAsync(update.id);
        successCount++;
      } catch (error) {
        toast.error(t("skills.updateFailed"), {
          description: `${update.name}: ${String(error)}`,
        });
      }
    }
    setIsUpdatingAll(false);
    if (successCount > 0) {
      toast.success(t("skills.updateAllSuccess", { count: successCount }), {
        closeButton: true,
      });
    }
  };

  React.useImperativeHandle(ref, () => ({
    openDiscovery: onOpenDiscovery,
    openImport: handleOpenImport,
    checkUpdates: handleCheckUpdates,
  }));

  return (
    <div className="px-6 flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between">
        <AppCountBar
          totalLabel={t("skills.installed", { count: skills?.length || 0 })}
          counts={enabledCounts}
          appIds={MCP_SKILLS_APP_IDS}
        />
        <div className="flex items-center gap-1.5">
          <div
            className="transition-all duration-300 ease-out overflow-hidden"
            style={{
              maxWidth:
                skillUpdates && skillUpdates.length > 0 ? "200px" : "0px",
              opacity: skillUpdates && skillUpdates.length > 0 ? 1 : 0,
            }}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 whitespace-nowrap"
              onClick={handleUpdateAll}
              disabled={isUpdatingAll || updateSkillMutation.isPending}
            >
              {isUpdatingAll ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {isUpdatingAll
                ? t("skills.updatingAll")
                : t("skills.updateAll", { count: skillUpdates?.length ?? 0 })}
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={handleCheckUpdates}
            disabled={isCheckingUpdates || !skills || skills.length === 0}
          >
            {isCheckingUpdates ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {isCheckingUpdates
              ? t("skills.checkingUpdates")
              : t("skills.checkUpdates")}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-24">
        <div className="mb-4 rounded-xl border border-border-default bg-background/70 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">
                {t("skills.crossAppTitle", {
                  defaultValue: "跨应用启用",
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("skills.crossAppDescription", {
                  defaultValue:
                    "每个技能都可以直接在 Claude、Codex、Gemini、OpenCode 间切换，不需要先切全局 app。",
                })}
              </p>
            </div>
            <Badge variant="outline" className={APP_ICON_MAP[currentApp].badgeClass}>
              <span className="mr-1">{APP_ICON_MAP[currentApp].icon}</span>
              {t("skills.currentAppLabel", {
                defaultValue: `当前应用：${APP_ICON_MAP[currentApp].label}`,
              })}
            </Badge>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            {t("skills.loading")}
          </div>
        ) : !skills || skills.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 bg-muted rounded-full flex items-center justify-center">
              <Sparkles size={24} className="text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">
              {t("skills.noInstalled")}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t("skills.noInstalledDescription")}
            </p>
          </div>
        ) : (
          <TooltipProvider delayDuration={300}>
            <div className="rounded-xl border border-border-default overflow-hidden">
              {skills.map((skill, index) => (
                <InstalledSkillListItem
                  key={skill.id}
                  skill={skill}
                  hasUpdate={!!updatesMap[skill.id]}
                  isUpdating={
                    updateSkillMutation.isPending &&
                    updateSkillMutation.variables === skill.id
                  }
                  currentApp={currentApp}
                  onToggleApp={handleToggleApp}
                  onApplyApps={handleApplyApps}
                  onUninstall={() => handleUninstall(skill)}
                  onUpdate={() => handleUpdateSkill(skill)}
                  isLast={index === skills.length - 1}
                />
              ))}
            </div>
          </TooltipProvider>
        )}
      </div>

      {confirmDialog && (
        <ConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          variant={confirmDialog.variant}
          zIndex="top"
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {importDialogOpen && unmanagedSkills && (
        <ImportSkillsDialog
          skills={unmanagedSkills}
          onImport={handleImport}
          onClose={() => setImportDialogOpen(false)}
        />
      )}

    </div>
  );
});

UnifiedSkillsPanel.displayName = "UnifiedSkillsPanel";

interface InstalledSkillListItemProps {
  skill: InstalledSkill;
  hasUpdate?: boolean;
  isUpdating?: boolean;
  currentApp: AppId;
  onToggleApp: (id: string, app: AppId, enabled: boolean) => void;
  onApplyApps: (
    id: string,
    targetApps: Record<AppId, boolean>,
    currentApps: Record<AppId, boolean>,
  ) => void;
  onUninstall: () => void;
  onUpdate?: () => void;
  isLast?: boolean;
}

const InstalledSkillListItem: React.FC<InstalledSkillListItemProps> = ({
  skill,
  hasUpdate,
  isUpdating,
  currentApp,
  onToggleApp,
  onApplyApps,
  onUninstall,
  onUpdate,
  isLast,
}) => {
  const { t } = useTranslation();

  const openDocs = async () => {
    if (!skill.readmeUrl) return;
    try {
      await settingsApi.openExternal(skill.readmeUrl);
    } catch {
      // ignore
    }
  };

  const sourceLabel = useMemo(() => {
    if (skill.repoOwner && skill.repoName) {
      return `${skill.repoOwner}/${skill.repoName}`;
    }
    return t("skills.local");
  }, [skill.repoOwner, skill.repoName, t]);

  const enabledCount = useMemo(
    () => MCP_SKILLS_APP_IDS.filter((app) => skill.apps[app]).length,
    [skill.apps],
  );

  const currentAppLabel = APP_ICON_MAP[currentApp].label;

  const applyCurrentAppOnly = () => {
    const targetApps = Object.fromEntries(
      MCP_SKILLS_APP_IDS.map((app) => [app, app === currentApp]),
    ) as Record<AppId, boolean>;
    onApplyApps(skill.id, targetApps, skill.apps);
  };

  const applyAllApps = () => {
    const targetApps = Object.fromEntries(
      MCP_SKILLS_APP_IDS.map((app) => [app, true]),
    ) as Record<AppId, boolean>;
    onApplyApps(skill.id, targetApps, skill.apps);
  };

  const clearAllApps = () => {
    const targetApps = Object.fromEntries(
      MCP_SKILLS_APP_IDS.map((app) => [app, false]),
    ) as Record<AppId, boolean>;
    onApplyApps(skill.id, targetApps, skill.apps);
  };

  return (
    <ListItemRow isLast={isLast}>
      <div className="flex-1 min-w-0 space-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-sm text-foreground truncate">
              {skill.name}
            </span>
            {skill.readmeUrl && (
              <button
                type="button"
                onClick={openDocs}
                className="text-muted-foreground/60 hover:text-foreground flex-shrink-0"
              >
                <ExternalLink size={12} />
              </button>
            )}
            <span className="text-xs text-muted-foreground/50 flex-shrink-0">
              {sourceLabel}
            </span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
              {t("skills.enabledAppsCount", {
                count: enabledCount,
                defaultValue: `${enabledCount} apps`,
              })}
            </Badge>
            {hasUpdate && (
              <Badge
                variant="outline"
                className="shrink-0 text-[10px] px-1.5 py-0 h-4 border-amber-500 text-amber-600 dark:text-amber-400"
              >
                {t("skills.updateAvailable")}
              </Badge>
            )}
          </div>
          {skill.description && (
            <p
              className="mt-1 text-xs text-muted-foreground truncate"
              title={skill.description}
            >
              {skill.description}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {MCP_SKILLS_APP_IDS.map((app) => {
            const enabled = skill.apps[app];
            const isCurrentApp = app === currentApp;
            return (
              <button
                key={app}
                type="button"
                onClick={() => onToggleApp(skill.id, app, !enabled)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  enabled
                    ? "border-primary/30 bg-primary/10 text-foreground"
                    : "border-border-default bg-background/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className={enabled ? "" : "opacity-60"}>
                  {APP_ICON_MAP[app].icon}
                </span>
                <span>{APP_ICON_MAP[app].label}</span>
                {isCurrentApp && (
                  <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                    {t("skills.currentAppShort", {
                      defaultValue: "当前",
                    })}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={applyCurrentAppOnly}
          >
            <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
            {t("skills.applyCurrentOnly", {
              defaultValue: `仅 ${currentAppLabel}`,
            })}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={applyAllApps}
          >
            <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
            {t("skills.enableAllApps", {
              defaultValue: "全部启用",
            })}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={clearAllApps}
          >
            <CircleOff className="mr-1.5 h-3.5 w-3.5" />
            {t("skills.disableAllApps", {
              defaultValue: "全部关闭",
            })}
          </Button>

          <div
            className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
            style={hasUpdate ? { opacity: 1 } : undefined}
          >
            {hasUpdate && onUpdate && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:text-blue-500 hover:bg-blue-100 dark:hover:text-blue-400 dark:hover:bg-blue-500/10"
                onClick={onUpdate}
                disabled={isUpdating}
                title={t("skills.update")}
              >
                {isUpdating ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:text-red-500 hover:bg-red-100 dark:hover:text-red-400 dark:hover:bg-red-500/10"
              onClick={onUninstall}
              title={t("skills.uninstall")}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
      </div>
    </ListItemRow>
  );
};

interface ImportSkillsDialogProps {
  skills: Array<{
    directory: string;
    name: string;
    description?: string;
    foundIn: string[];
    path: string;
  }>;
  onImport: (imports: ImportSkillSelection[]) => void;
  onClose: () => void;
}

const ImportSkillsDialog: React.FC<ImportSkillsDialogProps> = ({
  skills,
  onImport,
  onClose,
}) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(skills.map((s) => s.directory)),
  );
  const [selectedApps, setSelectedApps] = useState<
    Record<string, ImportSkillSelection["apps"]>
  >(() =>
    Object.fromEntries(
      skills.map((skill) => [
        skill.directory,
        {
          claude: skill.foundIn.includes("claude"),
          codex: skill.foundIn.includes("codex"),
          gemini: skill.foundIn.includes("gemini"),
          opencode: skill.foundIn.includes("opencode"),
          openclaw: false,
        },
      ]),
    ),
  );

  const toggleSelect = (directory: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(directory)) {
      newSelected.delete(directory);
    } else {
      newSelected.add(directory);
    }
    setSelected(newSelected);
  };

  const handleImport = () => {
    onImport(
      Array.from(selected).map((directory) => ({
        directory,
        apps: selectedApps[directory] ?? {
          claude: false,
          codex: false,
          gemini: false,
          opencode: false,
          openclaw: false,
        },
      })),
    );
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-background rounded-xl p-6 max-w-lg w-full mx-4 shadow-xl max-h-[80vh] flex flex-col">
          <h2 className="text-lg font-semibold mb-2">{t("skills.import")}</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {t("skills.importDescription")}
          </p>

          <div className="flex-1 overflow-y-auto space-y-2 mb-4">
            {skills.map((skill) => (
              <div
                key={skill.directory}
                className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={selected.has(skill.directory)}
                  onChange={() => toggleSelect(skill.directory)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{skill.name}</div>
                  {skill.description && (
                    <div className="text-sm text-muted-foreground line-clamp-1">
                      {skill.description}
                    </div>
                  )}
                  <div className="mt-2">
                    <AppToggleGroup
                      apps={
                        selectedApps[skill.directory] ?? {
                          claude: false,
                          codex: false,
                          gemini: false,
                          opencode: false,
                          openclaw: false,
                        }
                      }
                      onToggle={(app, enabled) => {
                        setSelectedApps((prev) => ({
                          ...prev,
                          [skill.directory]: {
                            ...(prev[skill.directory] ?? {
                              claude: false,
                              codex: false,
                              gemini: false,
                              opencode: false,
                              openclaw: false,
                            }),
                            [app]: enabled,
                          },
                        }));
                      }}
                      appIds={MCP_SKILLS_APP_IDS}
                    />
                  </div>
                  <div
                    className="text-xs text-muted-foreground/50 mt-1 truncate"
                    title={skill.path}
                  >
                    {skill.path}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleImport} disabled={selected.size === 0}>
              {t("skills.importSelected", { count: selected.size })}
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default UnifiedSkillsPanel;
