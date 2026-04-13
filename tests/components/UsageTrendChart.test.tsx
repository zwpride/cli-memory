import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageTrendChart } from "@/components/usage/UsageTrendChart";

const { useUsageTrendsMock } = vi.hoisted(() => ({
  useUsageTrendsMock: vi.fn(),
}));

vi.mock("@/lib/query/usage", () => ({
  useUsageTrends: (...args: unknown[]) => useUsageTrendsMock(...args),
}));

vi.mock("recharts", () => {
  const passthrough =
    (tag: string) =>
    ({ children }: { children?: ReactNode }) =>
      <div data-testid={tag}>{children}</div>;

  return {
    ResponsiveContainer: passthrough("responsive-container"),
    AreaChart: passthrough("area-chart"),
    Area: passthrough("area"),
    XAxis: passthrough("x-axis"),
    YAxis: passthrough("y-axis"),
    CartesianGrid: passthrough("cartesian-grid"),
    Tooltip: passthrough("tooltip"),
    Legend: passthrough("legend"),
  };
});

describe("UsageTrendChart", () => {
  beforeEach(() => {
    useUsageTrendsMock.mockReset();

    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  it("keeps hook order stable when loading transitions to loaded", () => {
    let loading = true;

    useUsageTrendsMock.mockImplementation(() => ({
      data: loading
        ? undefined
        : [
            {
              date: "2026-04-13T00:00:00.000Z",
              totalCost: "0.12",
              totalInputTokens: 1200,
              totalOutputTokens: 800,
              totalCacheCreationTokens: 10,
              totalCacheReadTokens: 20,
            },
          ],
      isLoading: loading,
    }));

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const view = render(
      <QueryClientProvider client={client}>
        <UsageTrendChart days={7} appType="claude" refreshIntervalMs={0} />
      </QueryClientProvider>,
    );

    expect(screen.queryByText("使用趋势")).not.toBeInTheDocument();

    loading = false;
    view.rerender(
      <QueryClientProvider client={client}>
        <UsageTrendChart days={7} appType="claude" refreshIntervalMs={0} />
      </QueryClientProvider>,
    );

    expect(screen.getByText("使用趋势")).toBeInTheDocument();
  });
});
