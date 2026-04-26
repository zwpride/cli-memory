import type { ReactNode } from "react";
import { ChevronRight, Clock, Copy, FolderOpen, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ProviderIcon } from "@/components/ProviderIcon";
import type { SessionMeta } from "@/types";
import {
  formatRelativeTime,
  formatSessionTitle,
  getProviderIconName,
  getProviderLabel,
  getSessionKindLabel,
  getSessionKey,
  highlightText,
} from "./utils";

interface SessionItemProps {
  session: SessionMeta;
  isSelected: boolean;
  selectionMode: boolean;
  isChecked: boolean;
  isCheckDisabled?: boolean;
  searchQuery?: string;
  onSelect: (key: string) => void;
  onToggleChecked: (checked: boolean) => void;
  onCopy: (text: string, successMessage: string) => void;
}

function FieldRow({
  label,
  value,
  icon,
  searchQuery,
  copyLabel,
  buttonText,
  copySuccess,
  onCopy,
}: {
  label: string;
  value?: string | null;
  icon?: ReactNode;
  searchQuery?: string;
  copyLabel: string;
  buttonText: string;
  copySuccess: string;
  onCopy: (text: string, successMessage: string) => void;
}) {
  const text = value?.trim();
  if (!text) return null;

  return (
    <div className="grid gap-1.5 rounded-lg border border-black/[0.06] bg-white/62 px-3 py-2 text-[11px] dark:border-white/10 dark:bg-white/[0.04] min-[620px]:grid-cols-[88px_minmax(0,1fr)_auto] min-[620px]:items-start">
      <span className="flex items-center gap-1.5 pt-0.5 font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {icon}
        {label}
      </span>
      <code className="min-w-0 break-all font-mono leading-5 text-foreground/85">
        {searchQuery ? highlightText(text, searchQuery) : text}
      </code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 justify-self-start rounded-lg px-2 text-[11px] min-[620px]:justify-self-end"
        aria-label={copyLabel}
        onClick={(event) => {
          event.stopPropagation();
          onCopy(text, copySuccess);
        }}
      >
        <Copy className="size-3.5" />
        {buttonText}
      </Button>
    </div>
  );
}

export function SessionItem({
  session,
  isSelected,
  selectionMode,
  isChecked,
  isCheckDisabled = false,
  searchQuery,
  onSelect,
  onToggleChecked,
  onCopy,
}: SessionItemProps) {
  const { t } = useTranslation();
  const title = formatSessionTitle(session);
  const lastActive = session.lastActiveAt || session.createdAt || undefined;
  const sessionKey = getSessionKey(session);
  const summary = session.summary?.trim() || "";
  const sessionKindLabel = getSessionKindLabel(session.sessionKind, t);

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-xl border px-4 py-3.5 transition-all duration-200",
        isSelected
          ? "border-primary/25 bg-white/82 shadow-sm dark:bg-white/[0.08]"
          : "border-black/[0.06] bg-white/48 hover:bg-white/64 dark:border-white/8 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]",
      )}
      style={{
        contentVisibility: "auto",
        containIntrinsicSize: "104px",
      }}
      onClick={() => onSelect(sessionKey)}
    >
      {selectionMode && (
        <div className="shrink-0 pt-0.5">
          <Checkbox
            checked={isChecked}
            disabled={isCheckDisabled}
            aria-label={t("sessionManager.selectForBatch", {
              defaultValue: "选择会话",
            })}
            onCheckedChange={(checked) => onToggleChecked(Boolean(checked))}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
      <div className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2 mb-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0">
                <ProviderIcon
                  icon={getProviderIconName(session.providerId)}
                  name={session.providerId}
                  size={18}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {getProviderLabel(session.providerId, t)}
            </TooltipContent>
          </Tooltip>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(sessionKey);
            }}
            className="min-w-0 flex-1 text-left text-sm font-medium leading-5 text-foreground"
            title={title}
          >
            {searchQuery ? highlightText(title, searchQuery) : title}
          </button>
          <ChevronRight
            className={cn(
              "size-4 text-muted-foreground/50 shrink-0 transition-transform",
              isSelected && "text-primary rotate-90",
            )}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-white/72 px-2.5 py-1 dark:border-white/10 dark:bg-white/[0.05]">
            {getProviderLabel(session.providerId, t)}
          </span>
          {sessionKindLabel && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/80 bg-amber-50 px-2.5 py-1 font-medium text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              {sessionKindLabel}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" />
            {lastActive
              ? formatRelativeTime(lastActive, t)
              : t("common.unknown")}
          </span>
        </div>

        {summary && (
          <p
            className="mt-1 text-[11px] leading-5 text-muted-foreground"
            title={summary}
          >
            {searchQuery ? highlightText(summary, searchQuery) : summary}
          </p>
        )}

        <div className="mt-2 grid gap-1.5">
          <FieldRow
            label="ID"
            value={session.sessionId}
            searchQuery={searchQuery}
            copyLabel={t("sessionManager.copySessionId", {
              defaultValue: "复制 Session ID",
            })}
            buttonText={t("common.copy", { defaultValue: "复制" })}
            copySuccess={t("sessionManager.sessionIdCopied", {
              defaultValue: "Session ID 已复制",
            })}
            onCopy={onCopy}
          />
          <FieldRow
            label={t("sessionManager.projectDir", {
              defaultValue: "项目目录",
            })}
            value={session.projectDir}
            icon={<FolderOpen className="size-3.5" />}
            searchQuery={searchQuery}
            copyLabel={t("sessionManager.copyProjectDir", {
              defaultValue: "复制目录",
            })}
            buttonText={t("common.copy", { defaultValue: "复制" })}
            copySuccess={t("sessionManager.projectDirCopied", {
              defaultValue: "目录已复制",
            })}
            onCopy={onCopy}
          />
          <FieldRow
            label={t("sessionManager.resumeCommandLabel", {
              defaultValue: "Resume",
            })}
            value={session.resumeCommand}
            icon={<Terminal className="size-3.5" />}
            searchQuery={searchQuery}
            copyLabel={t("sessionManager.copyResumeCommand", {
              defaultValue: "复制恢复命令",
            })}
            buttonText={t("common.copy", { defaultValue: "复制" })}
            copySuccess={t("sessionManager.resumeCommandCopied", {
              defaultValue: "已复制恢复命令",
            })}
            onCopy={onCopy}
          />
        </div>
      </div>
    </div>
  );
}
