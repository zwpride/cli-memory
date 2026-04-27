import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
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

  const renderTable = (appType = "codex") => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    return render(
      <QueryClientProvider client={client}>
        <RequestLogTable appType={appType} refreshIntervalMs={0} />
      </QueryClientProvider>,
    );
  };

  const logFixture = {
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
  };

  it("renders Codex session usage rows in the web activity view", () => {
    useRequestLogsMock.mockReturnValue({
      data: {
        data: [logFixture],
        total: 1,
        page: 0,
        pageSize: 20,
      },
      isLoading: false,
    });

    renderTable();

    expect(screen.getByText("Codex (Session)")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.4")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getAllByText(/Codex/i).length).toBeGreaterThan(1);
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

    renderTable();

    expect(
      screen.getByText(/表格可横向滚动|Table scrolls horizontally/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/暂无数据|No data/i)).toBeInTheDocument();
  });

  it("shows fixed-range validation and keeps the filter controls visible", () => {
    useRequestLogsMock.mockReturnValue({
      data: {
        data: [],
        total: 0,
        page: 0,
        pageSize: 20,
      },
      isLoading: false,
    });

    renderTable();

    expect(screen.getAllByText(/筛选条件|Filters/i).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText(/开始时间|Start time/i), {
      target: { value: "2026-01-01T00:00" },
    });
    fireEvent.change(screen.getByLabelText(/结束时间|End time/i), {
      target: { value: "2026-02-15T00:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /搜索|Search/i }));

    expect(
      screen.getByText(/时间范围过大|Time range is too large/i),
    ).toBeInTheDocument();
  });

  it("renders the pagination summary for multi-page results", () => {
    useRequestLogsMock.mockReturnValue({
      data: {
        data: [logFixture],
        total: 45,
        page: 0,
        pageSize: 20,
      },
      isLoading: false,
    });

    renderTable();

    expect(
      screen.getAllByText((content) => content.includes("45")),
    ).toHaveLength(2);
    expect(
      screen.getByText(
        (content) =>
          content.includes("1 / 3") || content.includes("Page 1 / 3"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /跳转到第 2 页|Go to page 2/i }),
    ).toBeInTheDocument();
  });
});
