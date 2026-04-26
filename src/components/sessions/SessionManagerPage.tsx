import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSessionSearch } from "@/hooks/useSessionSearch";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Download,
  RefreshCw,
  Search,
  Trash2,
  MessageSquare,
  Clock,
  FolderOpen,
  Terminal,
  X,
  CheckSquare,
  List,
} from "lucide-react";
import {
  useDeleteSessionMutation,
  useSessionMessagesQuery,
  useSessionsQuery,
} from "@/lib/query";
import { sessionsApi } from "@/lib/api";
import type { SessionMeta, SessionMessage } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { extractErrorMessage } from "@/utils/errorUtils";
import { cn } from "@/lib/utils";
import { ProviderIcon } from "@/components/ProviderIcon";
import { SessionItem } from "./SessionItem";
import { SessionMessageItem } from "./SessionMessageItem";
import {
  formatSessionTitle,
  formatTimestamp,
  getProviderIconName,
  getSessionKindLabel,
  getSessionKey,
  highlightText,
} from "./utils";

/** Convert session messages to SFT training JSONL format */
function exportSessionAsSftJsonl(
  messages: SessionMessage[],
  sessionMeta?: SessionMeta | null,
): string {
  const sftMessages: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    const role = msg.role.toLowerCase();

    if (role === "system") {
      sftMessages.push({
        role: "system",
        content: msg.content,
      });
    } else if (role === "user") {
      sftMessages.push({
        role: "user",
        content: msg.content,
      });
    } else if (role === "assistant") {
      const entry: Record<string, unknown> = {
        role: "assistant",
        reasoning_content: msg.thinking ?? null,
        reasoning_content_mask: false,
        content: msg.content,
        content_mask: false,
      };

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        entry.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id ?? "",
          type: "function",
          function: {
            name: tc.name ?? "",
            arguments: tc.arguments ?? "{}",
          },
        }));
      }

      sftMessages.push(entry);
    } else if (role === "tool") {
      sftMessages.push({
        role: "tool",
        content: msg.content,
        content_mask: true,
      });
    }
  }

  // Ensure ends with assistant (SFT requirement)
  if (sftMessages.length > 0 && sftMessages[sftMessages.length - 1].role !== "assistant") {
    // Remove trailing non-assistant messages
    while (sftMessages.length > 0 && sftMessages[sftMessages.length - 1].role !== "assistant") {
      sftMessages.pop();
    }
  }

  if (sftMessages.length === 0) return "";

  // Extract tools definitions from tool_calls
  const toolNames = new Set<string>();
  const tools: Array<Record<string, unknown>> = [];
  for (const msg of sftMessages) {
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls as Array<{ function?: { name?: string } }>) {
        const name = tc.function?.name;
        if (name && !toolNames.has(name)) {
          toolNames.add(name);
          tools.push({
            type: "function",
            function: { name, description: "", parameters: { type: "object", properties: {} } },
          });
        }
      }
    }
  }

  const sample: Record<string, unknown> = { messages: sftMessages };
  if (tools.length > 0) {
    sample.tools = tools;
  }

  // Add metadata as comment-safe fields
  if (sessionMeta) {
    sample._meta = {
      provider: sessionMeta.providerId,
      sessionId: sessionMeta.sessionId,
      title: sessionMeta.title,
      projectDir: sessionMeta.projectDir,
    };
  }

  return JSON.stringify(sample);
}

function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: "application/jsonl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}


type ProviderFilter =
  | "all"
  | "codex"
  | "claude"
  | "opencode"
  | "gemini";

export function SessionManagerPage({ appId }: { appId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useSessionsQuery();
  const sessions = data ?? [];
  const detailRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [activeMessageIndex, setActiveMessageIndex] = useState<number | null>(
    null,
  );
  const [deleteTargets, setDeleteTargets] = useState<SessionMeta[] | null>(
    null,
  );
  const [selectedSessionKeys, setSelectedSessionKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);

  const [search, setSearch] = useState("");
  const providerFilter = appId as ProviderFilter;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    setSelectedKey(null);
    setSearch("");
    setSelectionMode(false);
    setSelectedSessionKeys(new Set());
  }, [appId]);

  const { filteredSessions, isSearching } = useSessionSearch({
    sessions,
    providerFilter,
    query: deferredSearch,
  });
  const isFiltering = search !== deferredSearch || isSearching;

  const hasExplicitSessionFilter = search.trim().length > 0;

  useEffect(() => {
    if (!selectedKey) return;
    const exists = filteredSessions.some(
      (session) => getSessionKey(session) === selectedKey,
    );
    if (!exists) {
      setSelectedKey(null);
    }
  }, [filteredSessions, selectedKey]);

  const selectedSession = useMemo(() => {
    if (!selectedKey) return null;
    return (
      filteredSessions.find(
        (session) => getSessionKey(session) === selectedKey,
      ) || null
    );
  }, [filteredSessions, selectedKey]);

  const { data: messages = [], isLoading: isLoadingMessages } =
    useSessionMessagesQuery(
      selectedSession?.providerId,
      selectedSession?.sourcePath,
    );
  const deleteSessionMutation = useDeleteSessionMutation();
  const isDeleting = deleteSessionMutation.isPending || isBatchDeleting;

  useEffect(() => {
    messageRefs.current = new Map();
    setActiveMessageIndex(null);
  }, [selectedSession?.providerId, selectedSession?.sourcePath]);

  useEffect(() => {
    const validKeys = new Set(
      sessions.map((session) => getSessionKey(session)),
    );
    setSelectedSessionKeys((current) => {
      let changed = false;
      const next = new Set<string>();
      current.forEach((key) => {
        if (validKeys.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [sessions]);

  // 提取用户消息用于目录
  const userMessagesToc = useMemo(() => {
    return messages
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => message.role.toLowerCase() === "user")
      .map(({ message, index }) => ({
        index,
        preview:
          message.content.slice(0, 50) +
          (message.content.length > 50 ? "..." : ""),
        ts: message.ts,
      }));
  }, [messages]);

  const scrollToMessage = (index: number) => {
    const el = messageRefs.current.get(index);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setActiveMessageIndex(index);
      setTimeout(() => setActiveMessageIndex(null), 2000);
    }
  };

  // 清理定时器
  useEffect(() => {
    return () => {
      // 这里的 setTimeout 其实无法直接清理，因为它在函数闭包里。
      // 如果要严格清理，需要用 useRef 存 timer id。
      // 但对于 2秒的高亮清除，通常不清理也没大问题。
      // 为了代码规范，我们在组件卸载时将 activeMessageIndex 重置 (虽然 React 会处理)
    };
  }, []);

  const handleCopy = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMessage);
    } catch (error) {
      toast.error(
        extractErrorMessage(error) ||
          t("common.error", { defaultValue: "Copy failed" }),
      );
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTargets || deleteTargets.length === 0 || isDeleting) {
      return;
    }

    const targets = deleteTargets.filter((session) => session.sourcePath);
    setDeleteTargets(null);

    if (targets.length === 0) {
      return;
    }

    if (targets.length === 1) {
      const [target] = targets;
      await deleteSessionMutation.mutateAsync({
        providerId: target.providerId,
        sessionId: target.sessionId,
        sourcePath: target.sourcePath!,
      });
      await queryClient.invalidateQueries({ queryKey: ["sessionSearch"] });
      setSelectedSessionKeys((current) => {
        const next = new Set(current);
        next.delete(getSessionKey(target));
        return next;
      });
      return;
    }

    setIsBatchDeleting(true);
    try {
      const results = await sessionsApi.deleteMany(
        targets.map((session) => ({
          providerId: session.providerId,
          sessionId: session.sessionId,
          sourcePath: session.sourcePath!,
        })),
      );

      const deletedKeys = results
        .filter((result) => result.success)
        .map(
          (result) =>
            `${result.providerId}:${result.sessionId}:${result.sourcePath ?? ""}`,
        );

      const failedErrors = results
        .filter((result) => !result.success)
        .map((result) => result.error || t("common.unknown"));

      if (deletedKeys.length > 0) {
        const deletedKeySet = new Set(deletedKeys);
        queryClient.setQueryData<SessionMeta[]>(["sessions"], (current) =>
          (current ?? []).filter(
            (session) => !deletedKeySet.has(getSessionKey(session)),
          ),
        );
      }

      results
        .filter((result) => result.success)
        .forEach((result) => {
          queryClient.removeQueries({
            queryKey: ["sessionMessages", result.providerId, result.sourcePath],
          });
        });

      setSelectedSessionKeys((current) => {
        const next = new Set(current);
        deletedKeys.forEach((key) => next.delete(key));
        return next;
      });

      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["sessionSearch"] });

      if (deletedKeys.length > 0) {
        toast.success(
          t("sessionManager.batchDeleteSuccess", {
            defaultValue: "已删除 {{count}} 个会话",
            count: deletedKeys.length,
          }),
        );
      }

      if (failedErrors.length > 0) {
        toast.error(
          t("sessionManager.batchDeleteFailed", {
            defaultValue: "{{failed}} 个会话删除失败",
            failed: failedErrors.length,
          }),
          {
            description: failedErrors[0],
          },
        );
      }
    } catch (error) {
      toast.error(
        extractErrorMessage(error) ||
          t("sessionManager.batchDeleteRequestFailed", {
            defaultValue: "批量删除失败，请稍后重试",
          }),
      );
    } finally {
      setIsBatchDeleting(false);
    }
  };

  const deletableFilteredSessions = useMemo(
    () => filteredSessions.filter((session) => Boolean(session.sourcePath)),
    [filteredSessions],
  );

  const selectedSessions = useMemo(
    () =>
      sessions.filter((session) =>
        selectedSessionKeys.has(getSessionKey(session)),
      ),
    [sessions, selectedSessionKeys],
  );

  const selectedDeletableSessions = useMemo(
    () => selectedSessions.filter((session) => Boolean(session.sourcePath)),
    [selectedSessions],
  );
  const selectedSessionKindLabel = getSessionKindLabel(
    selectedSession?.sessionKind,
    t,
  );

  useEffect(() => {
    if (!selectionMode) return;

    const visibleKeys = new Set(
      deletableFilteredSessions.map((session) => getSessionKey(session)),
    );

    setSelectedSessionKeys((current) => {
      let changed = false;
      const next = new Set<string>();

      current.forEach((key) => {
        if (visibleKeys.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [deletableFilteredSessions, selectionMode]);

  const allFilteredSelected =
    deletableFilteredSessions.length > 0 &&
    deletableFilteredSessions.every((session) =>
      selectedSessionKeys.has(getSessionKey(session)),
    );

  const toggleSessionChecked = (session: SessionMeta, checked: boolean) => {
    if (!session.sourcePath) return;
    const key = getSessionKey(session);
    setSelectedSessionKeys((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    setSelectedSessionKeys((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        deletableFilteredSessions.forEach((session) =>
          next.delete(getSessionKey(session)),
        );
      } else {
        deletableFilteredSessions.forEach((session) =>
          next.add(getSessionKey(session)),
        );
      }
      return next;
    });
  };

  const openBatchDeleteDialog = () => {
    if (selectedDeletableSessions.length === 0) return;
    setDeleteTargets(selectedDeletableSessions);
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedSessionKeys(new Set());
  };

  return (
    <TooltipProvider>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="sticky top-0 z-20">
            <div className="app-panel app-sticky-surface px-4 py-4 shadow-sm">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="text-sm font-semibold text-foreground">
                      {t("sessionManager.sessionList")}
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {filteredSessions.length}
                    </Badge>
                    {isFiltering && (
                      <Badge variant="outline" className="text-xs">
                        {t("common.loading", { defaultValue: "读取中" })}
                      </Badge>
                    )}
                  </div>
                  {selectionMode && (
                    <Badge variant="outline" className="text-xs">
                      {t("sessionManager.selectedCount", {
                        defaultValue: "已选 {{count}} 项",
                        count: selectedDeletableSessions.length,
                      })}
                    </Badge>
                  )}
                </div>

                <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px_auto] xl:grid-cols-[minmax(0,1fr)_180px_auto_auto]">
                  <div className="relative min-w-0">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t("sessionManager.searchPlaceholder")}
                      className="h-10 rounded-lg border-black/[0.08] bg-white/72 pl-9 pr-9 text-sm shadow-sm dark:border-white/[0.08] dark:bg-white/[0.05]"
                      aria-label={t("sessionManager.searchSessions", {
                        defaultValue: "搜索会话",
                      })}
                    />
                    {search.trim().length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 size-7 -translate-y-1/2 rounded-xl"
                        onClick={() => setSearch("")}
                        aria-label={t("common.clear", {
                          defaultValue: "清除",
                        })}
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-lg px-3"
                    onClick={() => {
                      void Promise.all([
                        refetch(),
                        queryClient.invalidateQueries({
                          queryKey: ["sessionSearch"],
                        }),
                      ]);
                    }}
                  >
                    <RefreshCw className="mr-2 size-3.5" />
                    {t("common.refresh")}
                  </Button>

                  {(selectionMode || deletableFilteredSessions.length > 0) && (
                    <Button
                      type="button"
                      variant={selectionMode ? "secondary" : "ghost"}
                      size="sm"
                      className={cn(
                        "h-10 rounded-lg px-3",
                        selectionMode &&
                          "bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60",
                      )}
                      onClick={() => {
                        if (selectionMode) {
                          exitSelectionMode();
                        } else {
                          setSelectionMode(true);
                        }
                      }}
                    >
                      <CheckSquare className="mr-2 size-3.5" />
                      {selectionMode
                        ? t("sessionManager.exitBatchModeTooltip", {
                            defaultValue: "退出批量管理",
                          })
                        : t("sessionManager.manageBatchTooltip", {
                            defaultValue: "批量管理",
                          })}
                    </Button>
                  )}
                </div>

                {selectionMode && (
                  <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/40 px-3 py-3">
                    <div className="text-xs text-muted-foreground">
                      {t("sessionManager.batchModeHint", {
                        defaultValue: "勾选要删除的会话。搜索和筛选会自动只保留当前可见结果。",
                      })}
                    </div>
                    <div className="grid gap-3 min-[520px]:grid-cols-[minmax(0,1fr)_auto] min-[520px]:items-center">
                      <div className="flex flex-wrap items-center gap-2">
                        {deletableFilteredSessions.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 rounded-xl px-3 text-xs whitespace-nowrap"
                            onClick={handleToggleSelectAll}
                          >
                            {allFilteredSelected
                              ? t("sessionManager.clearFilteredSelection", {
                                  defaultValue: "取消全选",
                                })
                              : t("sessionManager.selectAllFiltered", {
                                  defaultValue: "全选当前",
                                })}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-xl px-3 text-xs whitespace-nowrap"
                          onClick={() => setSelectedSessionKeys(new Set())}
                        >
                          {t("sessionManager.clearSelection", {
                            defaultValue: "清空已选",
                          })}
                        </Button>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-8 gap-1.5 rounded-xl px-3 whitespace-nowrap justify-self-start min-[520px]:justify-self-end"
                        onClick={openBatchDeleteDialog}
                        disabled={
                          isDeleting || selectedDeletableSessions.length === 0
                        }
                      >
                        <Trash2 className="size-3.5" />
                        <span className="text-xs">
                          {isBatchDeleting
                            ? t("sessionManager.batchDeleting", {
                                defaultValue: "删除中...",
                              })
                            : t("sessionManager.deleteSelected", {
                                defaultValue: "批量删除",
                              })}
                        </span>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 会话列表 - 全宽 */}
          <Card className="flex min-h-[360px] flex-1 flex-col overflow-hidden">
            <CardHeader className="border-b px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-sm font-medium whitespace-nowrap">
                  {t("sessionManager.sessionList")}
                </CardTitle>
                <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
                  <span>
                    {t("sessionManager.visibleSessions", {
                      defaultValue: "当前显示 {{count}} 项",
                      count: filteredSessions.length,
                    })}
                  </span>
                  {sessions.length > filteredSessions.length && (
                    <>
                      <span className="text-border">|</span>
                      <span>
                        {t("sessionManager.totalSessions", {
                          defaultValue: "总计 {{count}} 项",
                          count: sessions.length,
                        })}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 p-0">
              <ScrollArea className="h-full">
                <div className="p-2">
                  {isLoading ? (
                    <div className="app-loading-state border-0 bg-transparent shadow-none">
                      <RefreshCw className="size-5 animate-spin text-muted-foreground" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {t("sessionManager.loadingTitle", {
                            defaultValue: "正在加载会话",
                          })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("sessionManager.loadingDescription", {
                            defaultValue:
                              "正在读取本地会话索引和历史记录，请稍候。",
                          })}
                        </p>
                      </div>
                    </div>
                  ) : filteredSessions.length === 0 ? (
                    <div className="app-empty-state">
                      <MessageSquare className="mb-1 size-8 text-muted-foreground/50" />
                      <p className="text-sm font-medium text-foreground">
                        {sessions.length === 0
                          ? t("sessionManager.noSessions", {
                              defaultValue: "暂无会话",
                            })
                          : t("sessionManager.noFilteredSessions", {
                              defaultValue: "当前筛选下没有匹配的会话",
                            })}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {sessions.length === 0
                          ? t("sessionManager.noSessionsDescription", {
                              defaultValue:
                                "当前应用下还没有可读取的本地会话记录。",
                            })
                          : hasExplicitSessionFilter
                            ? t("sessionManager.noFilteredSessionsDescription", {
                                defaultValue:
                                  "试试清空搜索词或切回全部来源，再查看其它会话。",
                              })
                            : t("sessionManager.noSessionsInCurrentApp", {
                                defaultValue:
                                  "当前应用下没有会话，但其它应用可能已有历史记录。",
                              })}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {filteredSessions.map((session) => {
                        const isSelected =
                          selectedKey !== null &&
                          getSessionKey(session) === selectedKey;

                        return (
                          <SessionItem
                            key={getSessionKey(session)}
                            session={session}
                            isSelected={isSelected}
                            selectionMode={selectionMode}
                            searchQuery={search}
                            isChecked={selectedSessionKeys.has(
                              getSessionKey(session),
                            )}
                            isCheckDisabled={!session.sourcePath}
                            onSelect={setSelectedKey}
                            onToggleChecked={(checked) =>
                              toggleSessionChecked(session, checked)
                            }
                            onCopy={handleCopy}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* 会话详情弹窗 */}
          <Dialog
            open={!!selectedSession}
            onOpenChange={(open) => {
              if (!open) setSelectedKey(null);
            }}
          >
            <DialogContent
              className="max-w-6xl w-[95vw] h-[90vh] p-0 gap-0 flex flex-col"
              zIndex="nested"
            >
              {selectedSession && (
                <>
                  <div className="grid gap-4 border-b border-border-default bg-muted/20 px-5 py-4 shrink-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div className="min-w-0 flex items-start gap-3">
                      <ProviderIcon
                        icon={getProviderIconName(selectedSession.providerId)}
                        name={selectedSession.providerId}
                        size={22}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <DialogTitle className="min-w-0 break-words text-base font-semibold">
                            {formatSessionTitle(selectedSession)}
                          </DialogTitle>
                          {selectedSessionKindLabel && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200/80 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                              {selectedSessionKindLabel}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            {formatTimestamp(
                              selectedSession.lastActiveAt ?? selectedSession.createdAt,
                            )}
                          </span>
                          <span>{messages.length} {t("sessionManager.messagesCount", { defaultValue: "条消息" })}</span>
                        </div>
                        {selectedSession.summary?.trim() && (
                          <div className="mt-3 rounded-md border border-black/[0.08] bg-white/72 px-2.5 py-2 dark:border-white/10 dark:bg-white/[0.05]">
                            <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                              {t("sessionManager.summaryLabel", {
                                defaultValue: "摘要",
                              })}
                            </div>
                            <p className="break-words text-[11px] leading-5 text-foreground/85">
                              {deferredSearch
                                ? highlightText(
                                    selectedSession.summary ?? "",
                                    deferredSearch,
                                  )
                                : selectedSession.summary}
                            </p>
                          </div>
                        )}

                        <div className="mt-3 grid gap-2">
                          <div className="grid gap-1.5 rounded-md border border-black/[0.08] bg-white/72 px-2.5 py-2 dark:border-white/10 dark:bg-white/[0.05] min-[760px]:grid-cols-[96px_minmax(0,1fr)_auto] min-[760px]:items-start">
                            <span className="pt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                              Session ID
                            </span>
                            <code className="min-w-0 break-all font-mono text-[11px] leading-5 text-foreground/85">
                              {selectedSession.sessionId}
                            </code>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 justify-self-start rounded-lg px-2 text-[11px] min-[760px]:justify-self-end"
                              aria-label={t("sessionManager.copySessionId", {
                                defaultValue: "复制 Session ID",
                              })}
                              onClick={() =>
                                void handleCopy(
                                  selectedSession.sessionId,
                                  t("sessionManager.sessionIdCopied", {
                                    defaultValue: "Session ID 已复制",
                                  }),
                                )
                              }
                            >
                              <Copy className="size-3.5" />
                              {t("common.copy", { defaultValue: "复制" })}
                            </Button>
                          </div>

                        {selectedSession.projectDir && (
                          <div className="grid gap-1.5 rounded-md border border-black/[0.08] bg-white/72 px-2.5 py-2 dark:border-white/10 dark:bg-white/[0.05] min-[760px]:grid-cols-[96px_minmax(0,1fr)_auto] min-[760px]:items-start">
                            <span className="flex items-center gap-1.5 pt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                              <FolderOpen className="size-3.5" />
                              {t("sessionManager.projectDir", {
                                defaultValue: "项目目录",
                              })}
                            </span>
                              <code
                              className="min-w-0 break-all font-mono text-[11px] leading-5 text-foreground/85"
                                title={selectedSession.projectDir}
                              >
                                {selectedSession.projectDir}
                              </code>
                              <Button
                                variant="outline"
                                size="sm"
                              className="h-7 justify-self-start rounded-lg px-2 text-[11px] min-[760px]:justify-self-end"
                                aria-label={t("sessionManager.copyProjectDir", {
                                  defaultValue: "复制目录",
                                })}
                                onClick={() =>
                                  void handleCopy(
                                    selectedSession.projectDir!,
                                    t("sessionManager.projectDirCopied", {
                                      defaultValue: "目录已复制",
                                    }),
                                  )
                                }
                              >
                                <Copy className="size-3.5" />
                                {t("common.copy", { defaultValue: "复制" })}
                              </Button>
                          </div>
                        )}
                        {selectedSession.resumeCommand && (
                          <div className="grid gap-1.5 rounded-md border border-black/[0.08] bg-white/72 px-2.5 py-2 dark:border-white/10 dark:bg-white/[0.05] min-[760px]:grid-cols-[96px_minmax(0,1fr)_auto] min-[760px]:items-start">
                            <span className="flex items-center gap-1.5 pt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                              <Terminal className="size-3.5" />
                              {t("sessionManager.resumeCommandLabel", {
                                defaultValue: "Resume",
                              })}
                            </span>
                              <code
                              className="min-w-0 break-all font-mono text-[11px] leading-5 text-foreground/85"
                                title={selectedSession.resumeCommand}
                              >
                                {selectedSession.resumeCommand}
                              </code>
                              <Button
                                variant="outline"
                                size="sm"
                              className="h-7 justify-self-start rounded-lg px-2 text-[11px] min-[760px]:justify-self-end"
                                aria-label={t("sessionManager.copyResumeCommand", {
                                  defaultValue: "复制恢复命令",
                                })}
                                onClick={() =>
                                  void handleCopy(
                                    selectedSession.resumeCommand!,
                                    t("sessionManager.resumeCommandCopied", {
                                      defaultValue: "已复制恢复命令",
                                    }),
                                  )
                                }
                              >
                                <Copy className="size-3.5" />
                                {t("common.copy", { defaultValue: "复制" })}
                              </Button>
                          </div>
                        )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-1.5 shrink-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => {
                              const jsonl = exportSessionAsSftJsonl(messages, selectedSession);
                              if (jsonl) {
                                const fname = `${selectedSession.providerId}-${selectedSession.sessionId.slice(0, 8)}.jsonl`;
                                downloadText(jsonl, fname);
                                toast.success(t("sessionManager.exported", { defaultValue: "已导出 SFT JSONL" }));
                              } else {
                                toast.error(t("sessionManager.exportEmpty", { defaultValue: "无可导出的对话内容" }));
                              }
                            }}
                            disabled={messages.length === 0}
                          >
                            <Download className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("sessionManager.exportSft", { defaultValue: "导出" })}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive"
                            aria-label={t("sessionManager.delete", { defaultValue: "删除" })}
                            onClick={() => setDeleteTargets([selectedSession])}
                            disabled={!selectedSession.sourcePath || isDeleting}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("sessionManager.delete", { defaultValue: "删除" })}</TooltipContent>
                      </Tooltip>
                      <div className="w-px h-5 bg-border mx-0.5" />
                      <DialogClose asChild>
                        <Button variant="ghost" size="icon" className="size-8">
                          <X className="size-4" />
                        </Button>
                      </DialogClose>
                    </div>
                  </div>

                  {/* 消息列表 + 对话目录 */}
                  <div className="flex flex-1 min-h-0" ref={detailRef}>
                    {/* 消息区 - 可滚动 */}
                    <ScrollArea className="flex-1 min-w-0">
                      <div className="p-5 min-w-0">
                        {isLoadingMessages ? (
                          <div className="flex items-center justify-center py-12">
                            <RefreshCw className="size-5 animate-spin text-muted-foreground" />
                          </div>
                        ) : messages.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-12 text-center">
                            <MessageSquare className="size-8 text-muted-foreground/50 mb-2" />
                            <p className="text-sm text-muted-foreground">
                              {t("sessionManager.emptySession")}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {messages.map((message, index) => (
                              <SessionMessageItem
                                key={`${message.role}-${index}`}
                                message={message}
                                index={index}
                                isActive={activeMessageIndex === index}
                                searchQuery={deferredSearch}
                                setRef={(el) => {
                                  if (el) messageRefs.current.set(index, el);
                                }}
                                onCopy={(content) =>
                                  handleCopy(
                                    content,
                                    t("sessionManager.messageCopied", {
                                      defaultValue: "已复制消息内容",
                                    }),
                                  )
                                }
                              />
                            ))}
                            <div ref={messagesEndRef} />
                          </div>
                        )}
                      </div>
                    </ScrollArea>

                    {/* 对话目录 - 固定在右侧，带高亮 */}
                    {userMessagesToc.length > 0 && (
                      <div className="w-52 border-l shrink-0 flex flex-col bg-muted/30">
                        <div className="px-3 py-2 border-b shrink-0">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <List className="size-3.5" />
                            <span>{t("sessionManager.tocTitle")}</span>
                            <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">
                              {userMessagesToc.length}
                            </Badge>
                          </div>
                        </div>
                        <ScrollArea className="flex-1 min-h-0">
                          <div className="p-1.5 space-y-0.5">
                            {userMessagesToc.map((item, tocIndex) => (
                              <button
                                key={item.index}
                                type="button"
                                onClick={() => scrollToMessage(item.index)}
                                className={cn(
                                  "w-full text-left px-2 py-1.5 rounded-md text-xs transition-all",
                                  "flex items-start gap-2",
                                  activeMessageIndex === item.index
                                    ? "bg-primary/10 text-primary font-medium"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                )}
                              >
                                <span className={cn(
                                  "shrink-0 w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-medium",
                                  activeMessageIndex === item.index
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-primary/10 text-primary",
                                )}>
                                  {tocIndex + 1}
                                </span>
                                <span className="line-clamp-2 leading-snug">{item.preview}</span>
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                </>
              )}
            </DialogContent>
          </Dialog>
      </div>
      <ConfirmDialog
        isOpen={Boolean(deleteTargets)}
        title={
          deleteTargets && deleteTargets.length > 1
            ? t("sessionManager.batchDeleteConfirmTitle", {
                defaultValue: "批量删除会话",
              })
            : t("sessionManager.deleteConfirmTitle", {
                defaultValue: "删除会话",
              })
        }
        message={
          deleteTargets && deleteTargets.length > 1
            ? t("sessionManager.batchDeleteConfirmMessage", {
                defaultValue:
                  "将永久删除已选中的 {{count}} 个本地会话记录。\n\n此操作不可恢复。",
                count: deleteTargets.length,
              })
            : deleteTargets?.[0]
              ? t("sessionManager.deleteConfirmMessage", {
                  defaultValue:
                    "将永久删除本地会话“{{title}}”\nSession ID: {{sessionId}}\n\n此操作不可恢复。",
                  title: formatSessionTitle(deleteTargets[0]),
                  sessionId: deleteTargets[0].sessionId,
                })
              : ""
        }
        confirmText={
          deleteTargets && deleteTargets.length > 1
            ? t("sessionManager.batchDeleteConfirmAction", {
                defaultValue: "删除所选会话",
              })
            : t("sessionManager.deleteConfirmAction", {
                defaultValue: "删除会话",
              })
        }
        cancelText={t("common.cancel", { defaultValue: "取消" })}
        variant="destructive"
        zIndex="top"
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => {
          if (!isDeleting) {
            setDeleteTargets(null);
          }
        }}
      />
    </TooltipProvider>
  );
}
