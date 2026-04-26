import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronRight, FileText, Pencil, Save, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AppId } from "@/lib/api";
import { vscodeApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { extractErrorMessage } from "@/utils/errorUtils";

interface AgentsPanelProps {
  appId: AppId;
}

/** Maps appId to known agent instruction file names */
function getAgentFiles(appId: AppId): Array<{ path: string; label: string; description: string }> {
  switch (appId) {
    case "claude":
      return [
        { path: "CLAUDE.md", label: "CLAUDE.md", description: "项目级 Agent 指令" },
        { path: ".claude/settings.json", label: ".claude/settings.json", description: "项目配置" },
        { path: ".claude/commands", label: ".claude/commands/", description: "自定义斜杠命令" },
        { path: ".claude/agents", label: ".claude/agents/", description: "自定义子智能体" },
      ];
    case "codex":
      return [
        { path: "AGENTS.md", label: "AGENTS.md", description: "项目级 Agent 指令" },
        { path: "codex.md", label: "codex.md", description: "备选项目指令" },
        { path: ".codex/instructions.md", label: ".codex/instructions.md", description: "指令文件" },
      ];
    case "gemini":
      return [
        { path: "GEMINI.md", label: "GEMINI.md", description: "项目级指令" },
      ];
    case "opencode":
      return [
        { path: "OPENCODE.md", label: "OPENCODE.md", description: "项目级指令" },
      ];
    default:
      return [];
  }
}

export function AgentsPanel({ appId }: AgentsPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedProjectDir, setSelectedProjectDir] = useState<string | null>(
    () => localStorage.getItem("cli-memory-project-dir"),
  );
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const { data: projectConfigs, isFetching, refetch } = useQuery({
    queryKey: ["agentConfigs", appId, selectedProjectDir],
    queryFn: () => vscodeApi.readProjectConfigs(appId, selectedProjectDir!),
    enabled: Boolean(selectedProjectDir),
    retry: false,
  });

  // Also load global agent files (e.g., ~/.claude/agents/, ~/.codex/instructions.md)
  const { data: globalConfigs } = useQuery({
    queryKey: ["globalConfigs", appId],
    queryFn: () => vscodeApi.readGlobalConfigs(appId),
  });

  const handleSave = useCallback(async (filePath: string, content: string) => {
    setIsSaving(true);
    try {
      await vscodeApi.writeConfigFile(filePath, content);
      toast.success(t("common.saved", { defaultValue: "已保存" }));
      setEditingFile(null);
      await queryClient.invalidateQueries({ queryKey: ["agentConfigs", appId, selectedProjectDir] });
      await queryClient.invalidateQueries({ queryKey: ["globalConfigs", appId] });
    } catch (error) {
      toast.error(extractErrorMessage(error) || "保存失败");
    } finally {
      setIsSaving(false);
    }
  }, [appId, selectedProjectDir, queryClient, t]);

  const agentFileTemplates = getAgentFiles(appId);

  // Merge global instruction files
  const globalAgentFiles = (globalConfigs as any)?.files?.filter(
    (f: any) => f.fileType === "markdown" || f.path.includes("instructions"),
  ) ?? [];

  // Project-level files
  const projectAgentFiles = projectConfigs?.files?.filter(
    (f) => f.fileType === "markdown" || f.path.includes("commands") || f.path.includes("instructions"),
  ) ?? [];

  return (
    <ScrollArea className="app-scroll-y h-full">
      <div className="p-5 lg:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Bot className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">
              {t("agents.title", { defaultValue: "Agent 指令管理" })}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("agents.description", { defaultValue: "管理各 CLI 工具的 Agent 指令文件（CLAUDE.md, AGENTS.md 等）" })}
            </p>
          </div>
        </div>

        {/* Expected files for this app */}
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("agents.expectedFiles", { defaultValue: "支持的指令文件" })}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {agentFileTemplates.map((f) => (
              <div key={f.path} className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-mono">{f.label}</div>
                  <div className="text-[11px] text-muted-foreground">{f.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Global agent files */}
        {globalAgentFiles.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("agents.globalFiles", { defaultValue: "全局指令" })}
              </span>
              <Badge variant="outline" className="text-[10px]">Global</Badge>
            </div>
            <div className="space-y-1">
              {globalAgentFiles.map((file: any) => {
                const isEditing = editingFile === file.fullPath;
                const isExpanded = expandedFiles.has(file.fullPath) || isEditing;
                return (
                  <div key={file.fullPath} className="rounded-lg border border-border/50">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40 rounded-lg transition-colors"
                      onClick={() => toggleExpand(file.fullPath)}
                    >
                      <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform", isExpanded && "rotate-90")} />
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">{file.path}</span>
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3">
                        <div className="flex justify-end mb-2">
                          <Button
                            variant="ghost" size="sm" className="h-7 gap-1 text-xs"
                            onClick={() => {
                              if (isEditing) { setEditingFile(null); }
                              else { setEditingFile(file.fullPath); setEditContent(file.content ?? ""); }
                            }}
                          >
                            {isEditing ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                            {isEditing ? "取消" : "编辑"}
                          </Button>
                        </div>
                        {isEditing ? (
                          <div>
                            <textarea
                              className="w-full rounded-lg border border-border bg-slate-950/[0.92] p-3 font-mono text-[12px] leading-6 text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
                              rows={Math.min(Math.max((editContent.split("\n").length) + 2, 6), 30)}
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                            />
                            <div className="mt-2 flex justify-end">
                              <Button size="sm" className="gap-1.5" disabled={isSaving}
                                onClick={() => void handleSave(file.fullPath, editContent)}>
                                <Save className="h-3.5 w-3.5" /> {isSaving ? "保存中..." : "保存"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <pre className="rounded-lg bg-muted/40 p-3 text-xs font-mono leading-6 whitespace-pre-wrap break-words max-h-[300px] overflow-auto">
                            {file.content ?? "(empty)"}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Project selector */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t("agents.projectFiles", { defaultValue: "项目指令" })}
            </span>
            <Badge variant="outline" className="text-[10px]">Project</Badge>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder={t("agents.enterProjectDir", { defaultValue: "输入项目目录路径..." })}
              value={selectedProjectDir ?? ""}
              onChange={(e) => {
                const v = e.target.value || null;
                setSelectedProjectDir(v);
                if (v) localStorage.setItem("cli-memory-project-dir", v);
              }}
            />
            <Button variant="ghost" size="sm" className="h-8" onClick={() => void refetch()} disabled={isFetching || !selectedProjectDir}>
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </Button>
          </div>

          {selectedProjectDir && projectAgentFiles.length > 0 && (
            <div className="space-y-1">
              {projectAgentFiles.map((file) => {
                const isEditing = editingFile === file.fullPath;
                const isExpanded = expandedFiles.has(file.fullPath) || isEditing;
                return (
                  <div key={file.fullPath} className="rounded-lg border border-border/50">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40 rounded-lg transition-colors"
                      onClick={() => toggleExpand(file.fullPath)}
                    >
                      <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform", isExpanded && "rotate-90")} />
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">{file.path}</span>
                      <span className="text-[10px] text-muted-foreground">{file.fileType}</span>
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3">
                        <div className="flex justify-end mb-2">
                          <Button
                            variant="ghost" size="sm" className="h-7 gap-1 text-xs"
                            onClick={() => {
                              if (isEditing) { setEditingFile(null); }
                              else { setEditingFile(file.fullPath); setEditContent(file.content ?? ""); }
                            }}
                          >
                            {isEditing ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                            {isEditing ? "取消" : "编辑"}
                          </Button>
                        </div>
                        {file.error ? (
                          <div className="text-xs text-red-500">{file.error}</div>
                        ) : isEditing ? (
                          <div>
                            <textarea
                              className="w-full rounded-lg border border-border bg-slate-950/[0.92] p-3 font-mono text-[12px] leading-6 text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
                              rows={Math.min(Math.max((editContent.split("\n").length) + 2, 6), 30)}
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                            />
                            <div className="mt-2 flex justify-end">
                              <Button size="sm" className="gap-1.5" disabled={isSaving}
                                onClick={() => void handleSave(file.fullPath, editContent)}>
                                <Save className="h-3.5 w-3.5" /> {isSaving ? "保存中..." : "保存"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <pre className="rounded-lg bg-muted/40 p-3 text-xs font-mono leading-6 whitespace-pre-wrap break-words max-h-[300px] overflow-auto">
                            {file.content ?? "(empty)"}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {selectedProjectDir && projectAgentFiles.length === 0 && !isFetching && (
            <div className="text-sm text-muted-foreground py-4 text-center">
              {t("agents.noProjectFiles", { defaultValue: "该目录下未检测到 Agent 指令文件" })}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
