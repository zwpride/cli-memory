import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import "./index.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import { queryClient } from "@/lib/query";
import { Toaster } from "@/components/ui/sonner";
import { i18nReady } from "@/i18n";
import { listen, invoke } from "@/lib/transport";
import {
  AppCrashBoundary,
  AppCrashScreen,
} from "@/components/AppCrashBoundary";
import {
  handleFatalConfigLoadError,
  type ConfigLoadErrorPayload,
} from "@platform/bootstrap";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root container #root not found");
}

const root = ReactDOM.createRoot(rootElement);

try {
  const ua = navigator.userAgent || "";
  const plat = (navigator.platform || "").toLowerCase();
  const isMac = /mac/i.test(ua) || plat.includes("mac");
  if (isMac) {
    document.body.classList.add("is-mac");
  }
} catch {
  // 忽略平台检测失败
}

async function bootstrap() {
  await i18nReady;

  try {
    await listen<ConfigLoadErrorPayload | null>("configLoadError", async (payload) => {
      await handleFatalConfigLoadError(payload);
    });
  } catch (e) {
    console.error("订阅 configLoadError 事件失败", e);
  }

  try {
    const initError = (await invoke(
      "get_init_error",
    )) as ConfigLoadErrorPayload | null;
    if (initError && (initError.path || initError.error)) {
      await handleFatalConfigLoadError(initError);
      return;
    }
  } catch (e) {
    console.error("拉取初始化错误失败", e);
  }

  root.render(
    <React.StrictMode>
      <AppCrashBoundary>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider defaultTheme="system" storageKey="cli-memory-theme">
            <AuthProvider>
              <App />
              <Toaster />
            </AuthProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </AppCrashBoundary>
    </React.StrictMode>,
  );
}

void bootstrap().catch((e) => {
  console.error("应用引导失败", e);
  root.render(
    <React.StrictMode>
      <AppCrashScreen
        title="应用启动失败"
        description="初始化没有完成。通常是本地页面状态、运行时环境或启动阶段异常导致的。"
        error={e}
      />
    </React.StrictMode>,
  );
});
