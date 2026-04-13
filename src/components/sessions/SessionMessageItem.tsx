import { Brain, Copy, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SessionMessage } from "@/types";
import {
  formatTimestamp,
  getRoleLabel,
  getRoleTone,
  highlightText,
} from "./utils";

interface SessionMessageItemProps {
  message: SessionMessage;
  index: number;
  isActive: boolean;
  searchQuery?: string;
  setRef: (el: HTMLDivElement | null) => void;
  onCopy: (content: string) => void;
}

export function SessionMessageItem({
  message,
  isActive,
  searchQuery,
  setRef,
  onCopy,
}: SessionMessageItemProps) {
  const { t } = useTranslation();

  const roleLC = message.role.toLowerCase();
  const isSystem = roleLC === "system";
  const isTool = roleLC === "tool";
  const isAssistant = roleLC === "assistant";

  return (
    <div
      ref={setRef}
      className={cn(
        "rounded-lg border px-3 py-2.5 relative group transition-all min-w-0",
        roleLC === "user"
          ? "bg-primary/5 border-primary/20 ml-8"
          : isAssistant
            ? "bg-blue-500/5 border-blue-500/20 mr-8"
            : isSystem
              ? "bg-amber-500/5 border-amber-500/20"
              : isTool
                ? "bg-emerald-500/5 border-emerald-500/20 ml-4 mr-4"
                : "bg-muted/40 border-border/60",
        isActive && "ring-2 ring-primary ring-offset-2",
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 size-6 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onCopy(message.content)}
          >
            <Copy className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t("sessionManager.copyMessage", {
            defaultValue: "复制内容",
          })}
        </TooltipContent>
      </Tooltip>

      {/* Header: role + timestamp */}
      <div className="flex items-center justify-between text-xs mb-1.5 pr-6">
        <div className="flex items-center gap-1.5">
          <span className={cn("font-semibold", getRoleTone(message.role))}>
            {getRoleLabel(message.role, t)}
          </span>
          {isTool && message.toolCallId && (
            <span className="font-mono text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
              {message.toolCallId}
            </span>
          )}
        </div>
        {message.ts && (
          <span className="text-muted-foreground">
            {formatTimestamp(message.ts)}
          </span>
        )}
      </div>

      {/* Thinking block */}
      {message.thinking && (
        <div className="mb-2 rounded-md border border-purple-500/20 bg-purple-500/5 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 mb-1">
            <Brain className="size-3" />
            Thinking
          </div>
          <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground font-mono">
            {message.thinking}
          </div>
        </div>
      )}

      {/* Tool calls block */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {message.toolCalls.map((tc, i) => (
            <div
              key={tc.id ?? i}
              className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-1">
                <Wrench className="size-3" />
                {tc.name ?? "tool_use"}
                {tc.id && (
                  <span className="font-mono text-[10px] text-muted-foreground ml-1">
                    {tc.id}
                  </span>
                )}
              </div>
              {tc.arguments && (
                <pre className="whitespace-pre-wrap break-all text-[11px] leading-5 text-muted-foreground font-mono max-h-[200px] overflow-auto">
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(tc.arguments), null, 2);
                    } catch {
                      return tc.arguments;
                    }
                  })()}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Main content */}
      {message.content && (
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-relaxed min-w-0">
          {searchQuery
            ? highlightText(message.content, searchQuery)
            : message.content}
        </div>
      )}
    </div>
  );
}
