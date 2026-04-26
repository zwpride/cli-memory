import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const clipboardWriteTextMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isLoading: false,
    isAuthenticated: true,
    authEnabled: false,
  }),
}));

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "light",
    setTheme: vi.fn(),
  }),
}));

vi.mock("@/components/usage/UsageDashboard", () => ({
  UsageDashboard: () => <div>Mock Usage Dashboard</div>,
}));

vi.mock("@/components/sessions/SessionManagerPage", () => ({
  SessionManagerPage: () => <div>Mock Session Manager</div>,
}));

vi.mock("@/components/workspace/ToolsWorkspace", () => ({
  default: () => <div>Mock Tools Workspace</div>,
}));

vi.mock("@/lib/api", () => {
  return {
    settingsApi: {
      getConfigDir: vi.fn(async () => "/home/mock/.claude"),
      getConfigStatus: vi.fn(async () => ({
        exists: true,
        path: "/home/mock/.claude/settings.json",
      })),
      getToolVersions: vi.fn(async () => [
        {
          name: "claude",
          version: "2.1.113",
          latest_version: null,
          error: null,
          env_type: "linux",
          wsl_distro: null,
        },
      ]),
      getClaudeOfficialAuthStatus: vi.fn(async () => ({
        configDir: "/home/mock/.claude",
        settingsPath: "/home/mock/.claude/settings.json",
        credentialsPath: "/home/mock/.claude/.credentials.json",
        credentialsFileExists: true,
        cliAvailable: true,
        authenticated: true,
        credentialStatus: "valid",
        detail: "Claude auth ready",
        loginCommand: "claude login",
        logoutCommand: "claude logout",
        doctorCommand: "claude doctor",
      })),
    },
    vscodeApi: {
      getLiveProviderSettings: vi.fn(async () => ({
        env: {
          ANTHROPIC_API_KEY: "secret-value",
        },
        permissions: {
          allow: ["Bash"],
        },
      })),
      readGlobalConfigs: vi.fn(async () => ({ files: [] })),
      readProjectConfigs: vi.fn(async () => ({ files: [] })),
      getSymlinkStatus: vi.fn(async () => ({ items: [] })),
      createConfigSymlink: vi.fn(async () => ({ success: true })),
      writeConfigFile: vi.fn(async () => true),
    },
  };
});

vi.mock("@/lib/query", () => ({
  useSessionsQuery: () => ({
    data: [
      {
        providerId: "claude",
        sessionId: "session-1",
        projectDir: "/workspace/project-a",
      },
    ],
  }),
}));

function renderApp() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App overview and navigation", () => {
  beforeEach(() => {
    localStorage.clear();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    clipboardWriteTextMock.mockReset();
    clipboardWriteTextMock.mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: clipboardWriteTextMock,
      },
    });
  });

  it("renders the overview status page by default", async () => {
    renderApp();

    await waitFor(() =>
      expect(screen.getByText("当前状态")).toBeInTheDocument(),
    );

    expect(screen.getByText("CLI Memory")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("实时快照")).toBeInTheDocument(),
    );
    expect(screen.getByText("快捷操作")).toBeInTheDocument();
    expect(screen.getByText("/home/mock/.claude")).toBeInTheDocument();
    expect(
      screen.getAllByText("/home/mock/.claude/settings.json").length,
    ).toBeGreaterThan(0);
  });

  it("copies overview paths without leaving the overview page", async () => {
    renderApp();

    await waitFor(() =>
      expect(screen.getByText("/home/mock/.claude")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /复制 配置目录/i }));

    await waitFor(() =>
      expect(clipboardWriteTextMock).toHaveBeenCalledWith("/home/mock/.claude"),
    );
    expect(toastSuccessMock).toHaveBeenCalled();
    expect(screen.getByText("当前状态")).toBeInTheDocument();
  });

  it("switches primary pages from the toolbar", async () => {
    renderApp();

    await waitFor(() =>
      expect(screen.getByText("当前状态")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /会话管理/i }));
    await waitFor(() =>
      expect(screen.getByText("Mock Session Manager")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /使用统计/i }));
    await waitFor(() =>
      expect(screen.getByText("Mock Usage Dashboard")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /工具/i }));
    await waitFor(() =>
      expect(screen.getByText("Mock Tools Workspace")).toBeInTheDocument(),
    );
  });
});
