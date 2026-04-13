import { useRef } from "react";
import {
  ArrowLeft,
  Bot,
  Download,
  FolderArchive,
  History,
  Plus,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { AgentsPanel } from "@/components/agents/AgentsPanel";
import UnifiedMcpPanel from "@/components/mcp/UnifiedMcpPanel";
import PromptPanel from "@/components/prompts/PromptPanel";
import { SkillsPage } from "@/components/skills/SkillsPage";
import UnifiedSkillsPanel from "@/components/skills/UnifiedSkillsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AppId } from "@/lib/api";
import { cn } from "@/lib/utils";

export type ToolPanel = "prompts" | "skills" | "skillsDiscovery" | "mcp" | "agents";

interface ToolsWorkspaceProps {
  activeApp: AppId;
  activeToolPanel: ToolPanel;
  onToolPanelChange: (panel: ToolPanel) => void;
}

const pageContainerClass =
  "mx-auto flex w-full flex-1 flex-col gap-5 px-4 pb-8 md:px-6 lg:px-10 md:pb-10";
const segmentedButtonClass =
  "app-segmented-item h-10 px-4 text-sm font-medium";
const sectionBadgeClass =
  "border-black/[0.08] bg-white/70 text-muted-foreground shadow-sm dark:border-white/[0.08] dark:bg-white/[0.05]";
const utilityActionButtonClass =
  "border border-black/[0.08] bg-white/72 text-foreground shadow-sm hover:bg-white/92 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-foreground dark:hover:bg-white/[0.1]";

function toolPanelIcon(panel: ToolPanel) {
  switch (panel) {
    case "skills":
    case "skillsDiscovery":
      return <Download className="h-4 w-4" />;
    case "prompts":
      return <History className="h-4 w-4" />;
    case "mcp":
      return <FolderArchive className="h-4 w-4" />;
    case "agents":
      return <Bot className="h-4 w-4" />;
  }
}

function toolPanelLabel(
  panel: ToolPanel,
  activeApp: AppId,
  t: ReturnType<typeof useTranslation>["t"],
) {
  switch (panel) {
    case "skills":
      return t("skills.title");
    case "skillsDiscovery":
      return t("skills.discover");
    case "prompts":
      return t("prompts.title", { appName: t(`apps.${activeApp}`) });
    case "mcp":
      return t("mcp.unifiedPanel.title");
    case "agents":
      return t("agents.title", { defaultValue: "Agents" });
  }
}

export default function ToolsWorkspace({
  activeApp,
  activeToolPanel,
  onToolPanelChange,
}: ToolsWorkspaceProps) {
  const { t } = useTranslation();
  const promptPanelRef = useRef<any>(null);
  const mcpPanelRef = useRef<any>(null);
  const skillsPageRef = useRef<any>(null);
  const unifiedSkillsPanelRef = useRef<any>(null);

  const currentApp = activeApp;

  const renderActions = () => {
    switch (activeToolPanel) {
      case "prompts":
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => promptPanelRef.current?.openAdd()}
            className={utilityActionButtonClass}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("prompts.add")}
          </Button>
        );
      case "mcp":
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => mcpPanelRef.current?.openImport()}
              className={utilityActionButtonClass}
            >
              <Download className="mr-2 h-4 w-4" />
              {t("mcp.importExisting")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => mcpPanelRef.current?.openAdd()}
              className={utilityActionButtonClass}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("mcp.addMcp")}
            </Button>
          </div>
        );
      case "skills":
        return (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => unifiedSkillsPanelRef.current?.openImport()}
              className={utilityActionButtonClass}
            >
              <Download className="mr-2 h-4 w-4" />
              {t("skills.import")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onToolPanelChange("skillsDiscovery")}
              className={utilityActionButtonClass}
            >
              <Search className="mr-2 h-4 w-4" />
              {t("skills.discover")}
            </Button>
          </div>
        );
      case "skillsDiscovery":
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onToolPanelChange("skills")}
              className={utilityActionButtonClass}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("common.back", { defaultValue: "返回" })}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => skillsPageRef.current?.refresh()}
              className={utilityActionButtonClass}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("skills.refresh")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => skillsPageRef.current?.openRepoManager()}
              className={utilityActionButtonClass}
            >
              <Settings className="mr-2 h-4 w-4" />
              {t("skills.repoManager")}
            </Button>
          </div>
        );
      case "agents":
        return null;
    }
  };

  const renderContent = () => {
    switch (activeToolPanel) {
      case "prompts":
        return (
          <PromptPanel
            ref={promptPanelRef}
            open={true}
            onOpenChange={() => undefined}
            appId={activeApp}
          />
        );
      case "skills":
        return (
          <UnifiedSkillsPanel
            ref={unifiedSkillsPanelRef}
            onOpenDiscovery={() => onToolPanelChange("skillsDiscovery")}
            currentApp={currentApp}
          />
        );
      case "skillsDiscovery":
        return <SkillsPage ref={skillsPageRef} initialApp={currentApp} />;
      case "mcp":
        return <UnifiedMcpPanel ref={mcpPanelRef} onOpenChange={() => undefined} />;
      case "agents":
        return <AgentsPanel appId={activeApp} />;
    }
  };

  return (
    <div className={pageContainerClass}>
      <section className="app-shell flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border-default/60 px-5 py-4 lg:px-6">
          <div className="flex min-w-[220px] flex-1 items-start gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-black/[0.08] bg-white/76 text-foreground shadow-sm dark:border-white/[0.08] dark:bg-white/[0.06]">
              <FolderArchive className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={sectionBadgeClass}>
                  {t(`apps.${activeApp}`)}
                </Badge>
                <Badge variant="outline" className={sectionBadgeClass}>
                  {t("common.localConfig", { defaultValue: "本地配置" })}
                </Badge>
              </div>
              <h2 className="mt-2 text-lg font-semibold text-foreground">
                {t("common.tools", { defaultValue: "工具" })}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                {t("common.toolsDescription", {
                  defaultValue:
                    "这里只保留 Skills、Prompts 和 MCP 管理，其他设置和附加页面先全部移出主流程。",
                })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {renderActions()}
          </div>
        </div>

        <div className="border-b border-border-default/60 px-6 py-5 lg:px-8">
          <div className="app-segmented w-fit">
            {(["agents", "skills", "prompts", "mcp"] as const).map((panel) => (
              <Button
                key={panel}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onToolPanelChange(panel)}
                className={cn(
                  segmentedButtonClass,
                  activeToolPanel === panel && "shadow-sm",
                )}
                data-active={activeToolPanel === panel}
              >
                <span className="mr-2 inline-flex items-center justify-center">
                  {toolPanelIcon(panel)}
                </span>
                {toolPanelLabel(panel, activeApp, t)}
              </Button>
            ))}
            {activeToolPanel === "skillsDiscovery" && (
              <Badge variant="outline" className="h-10 rounded-lg px-4 text-sm">
                {toolPanelLabel("skillsDiscovery", activeApp, t)}
              </Badge>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">{renderContent()}</div>
      </section>
    </div>
  );
}
