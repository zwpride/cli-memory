import React from "react";

const LOCAL_UI_STORAGE_KEYS = [
  "cli-memory-last-app",
  "cli-memory-last-view",
  "cli-memory-utility-panel",
  "cli-memory-theme",
  "language",
] as const;

function getErrorSummary(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "Unknown error";
  }
}

export function clearLocalUiState() {
  if (typeof window === "undefined") {
    return;
  }

  for (const key of LOCAL_UI_STORAGE_KEYS) {
    window.localStorage.removeItem(key);
  }
}

interface AppCrashScreenProps {
  title?: string;
  description?: string;
  error?: unknown;
}

export function AppCrashScreen({
  title = "页面加载失败",
  description = "前端运行时出了问题。先别猜，直接刷新或清理本地页面状态恢复。",
  error,
}: AppCrashScreenProps) {
  const summary = getErrorSummary(error);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.1),_transparent_40%),linear-gradient(180deg,_rgba(248,250,252,1),_rgba(241,245,249,0.96))] px-6 py-12 text-slate-950 dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.16),_transparent_36%),linear-gradient(180deg,_rgb(2,6,23),_rgb(15,23,42))] dark:text-slate-50">
      <div className="w-full max-w-2xl rounded-xl border border-slate-200/80 bg-white/92 p-8 shadow-lg dark:border-slate-800 dark:bg-slate-950/78">
        <div className="inline-flex rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium tracking-[0.16em] text-amber-700 dark:text-amber-300">
          CC SWITCH RECOVERY
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          {description}
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-slate-950 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
          >
            强制刷新页面
          </button>
          <button
            type="button"
            onClick={() => {
              clearLocalUiState();
              window.location.reload();
            }}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            清理页面状态并刷新
          </button>
        </div>

        <div className="mt-6 rounded-lg border border-slate-200/80 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            Error Summary
          </div>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-700 dark:text-slate-200">
            {summary}
          </pre>
        </div>
      </div>
    </div>
  );
}

interface AppCrashBoundaryProps {
  children: React.ReactNode;
}

interface AppCrashBoundaryState {
  error: Error | null;
}

export class AppCrashBoundary extends React.Component<
  AppCrashBoundaryProps,
  AppCrashBoundaryState
> {
  state: AppCrashBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): AppCrashBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[AppCrashBoundary] Unhandled render error", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return <AppCrashScreen error={this.state.error} />;
    }

    return this.props.children;
  }
}
