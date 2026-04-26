import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestLogTable } from "@/components/usage/RequestLogTable";

const { useRequestLogsMock } = vi.hoisted(() => ({
  useRequestLogsMock: vi.fn(),
}));

vi.mock("@/lib/query/usage", () => ({
  useRequestLogs: useRequestLogsMock,
  usageKeys: {
    logs: () => ["usage", "logs"],
  },
}));

describe("RequestLogTable", () => {
  beforeEach(() => {
    useRequestLogsMock.mockReset();
  });

  it("renders Codex session usage rows in the web activity view", () => {
    useRequestLogsMock.mockReturnValue({
      data: {
        data: [
          {
            requestId: "req-1",
            providerId: "codex-session",
            providerName: "Codex (Session)",
            appType: "codex",
            model: "gpt-5.4",
            costMultiplier: "1",
            inputTokens: 120,
            outputTokens: 48,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            inputCostUsd: "0.001",
            outputCostUsd: "0.002",
            cacheReadCostUsd: "0",
            cacheCreationCostUsd: "0",
            totalCostUsd: "0.003",
            isStreaming: true,
            latencyMs: 2100,
            firstTokenMs: 350,
            durationMs: 4200,
            statusCode: 200,
            createdAt: 1_710_000_000,
            dataSource: "codex_session",
          },
        ],
        total: 1,
        page: 0,
        pageSize: 20,
      },
      isLoading: false,
    });

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={client}>
        <RequestLogTable appType="codex" refreshIntervalMs={0} />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Codex (Session)")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.4")).toBeInTheDocument();
  });

  it("renders the empty state with a horizontal-scroll hint", () => {
    useRequestLogsMock.mockReturnValue({
      data: {
        data: [],
        total: 0,
        page: 0,
        pageSize: 20,
      },
      isLoading: false,
    });

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={client}>
        <RequestLogTable appType="codex" refreshIntervalMs={0} />
      </QueryClientProvider>,
    );

    expect(
      screen.getByText(/表格可横向滚动|Table scrolls horizontally/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/暂无数据|No data/i)).toBeInTheDocument();
  });
});
