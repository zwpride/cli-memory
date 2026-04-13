import { ChevronRight, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  getBaseName,
  formatRelativeTime,
  formatSessionTitle,
  getProviderIconName,
  getProviderLabel,
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
}: SessionItemProps) {
  const { t } = useTranslation();
  const title = formatSessionTitle(session);
  const lastActive = session.lastActiveAt || session.createdAt || undefined;
  const sessionKey = getSessionKey(session);
  const projectName = getBaseName(session.projectDir);
  const summary = session.summary?.trim() || "";

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
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => onSelect(sessionKey)}
        className="min-w-0 flex-1 text-left"
      >
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
          <span className="flex-1 text-sm font-medium line-clamp-2 break-words" title={title}>
            {searchQuery ? highlightText(title, searchQuery) : title}
          </span>
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
          {projectName && (
            <span className="truncate max-w-[180px]">{projectName}</span>
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
            className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground"
            title={summary}
          >
            {summary}
          </p>
        )}
      </button>
    </div>
  );
}
