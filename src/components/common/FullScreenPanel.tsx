import React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  isWindows,
  isLinux,
  DRAG_REGION_ATTR,
  DRAG_REGION_STYLE,
} from "@/lib/platform";
import { isTextEditableTarget } from "@/utils/domUtils";

interface FullScreenPanelProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const DRAG_BAR_HEIGHT = isWindows() || isLinux() ? 0 : 28; // px - match App.tsx
const HEADER_HEIGHT = 64; // px - match App.tsx

/**
 * Reusable full-screen panel component
 * Handles portal rendering, header with back button, and footer
 * Uses solid theme colors without transparency
 */
export const FullScreenPanel: React.FC<FullScreenPanelProps> = ({
  isOpen,
  title,
  onClose,
  children,
  footer,
}) => {
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // ESC 键关闭面板
  const onCloseRef = React.useRef(onClose);

  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // 子组件（例如 Radix 的 Select/Dialog/Dropdown）如果已经消费了 ESC，就不要再关闭整个面板
        if (event.defaultPrevented) {
          return;
        }

        if (isTextEditableTarget(event.target)) {
          return; // 让输入框自己处理 ESC（比如清空、失焦等）
        }

        event.stopPropagation(); // 阻止事件继续冒泡到 window，避免触发 App.tsx 的全局监听
        onCloseRef.current();
      }
    };

    // 使用冒泡阶段监听，让子组件（如 Radix UI）优先处理 ESC
    window.addEventListener("keydown", handleKeyDown, false);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, false);
    };
  }, [isOpen]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] flex flex-col"
          style={{ backgroundColor: "hsl(var(--background))" }}
        >
          {/* Drag region - match App.tsx. Linux 上 DRAG_BAR_HEIGHT=0，
              直接跳过整个元素；macOS 保留 28px 拖拽占位。 */}
          {DRAG_BAR_HEIGHT > 0 && (
            <div
              data-tauri-drag-region
              style={
                {
                  WebkitAppRegion: "drag",
                  height: DRAG_BAR_HEIGHT,
                } as React.CSSProperties
              }
            />
          )}

          {/* Header - match App.tsx */}
          <div
            className="app-sticky-surface flex flex-shrink-0 items-center border-b border-border-default/60 shadow-sm"
            {...DRAG_REGION_ATTR}
            style={
              {
                ...DRAG_REGION_STYLE,
                height: HEADER_HEIGHT,
              } as React.CSSProperties
            }
          >
            <div
              className="px-6 w-full flex items-center gap-4"
              {...DRAG_REGION_ATTR}
              style={{ ...DRAG_REGION_STYLE } as React.CSSProperties}
            >
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={onClose}
                className="rounded-lg select-none"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h2 className="min-w-0 truncate text-lg font-semibold text-foreground select-none">
                {title}
              </h2>
            </div>
          </div>

          {/* Content */}
          <div className="app-scroll-y flex-1">
            <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-5 md:px-6 md:py-6">
              {children}
            </div>
          </div>

          {/* Footer */}
          {footer && (
            <div
              className="app-sticky-surface flex-shrink-0 border-t border-border-default/60 py-3 shadow-[0_-18px_40px_-34px_rgba(15,23,42,0.45)] md:py-4"
            >
              <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-end gap-3 px-4 md:px-6">
                {footer}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
