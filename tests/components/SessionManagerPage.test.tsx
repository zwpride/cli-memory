import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManagerPage } from "@/components/sessions/SessionManagerPage";
import { sessionsApi } from "@/lib/api/sessions";
import type { SessionMessage, SessionMeta } from "@/types";
import { setSessionFixtures } from "../msw/state";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const clipboardWriteTextMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => (
    <div data-testid="session-dialog">{children}</div>
  ),
  DialogTitle: ({ children, className }: any) => (
    <h2 className={className}>{children}</h2>
  ),
  DialogClose: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/components/ConfirmDialog", () => ({
  ConfirmDialog: ({
    isOpen,
    title,
    message,
    confirmText,
    cancelText,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    isOpen ? (
      <div data-testid="confirm-dialog">
        <div>{title}</div>
        <div>{message}</div>
        <button onClick={onConfirm}>{confirmText}</button>
        <button onClick={onCancel}>{cancelText}</button>
      </div>
    ) : null,
}));

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <SessionManagerPage appId="codex" />
      </QueryClientProvider>,
    ),
  };
};

const renderPageInWheelWrapper = (onWheel: () => void) => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <div onWheel={onWheel}>
          <SessionManagerPage appId="codex" />
        </div>
      </QueryClientProvider>,
    ),
  };
};

/** Wait for session list to load, then click the given session to open its dialog */
async function openSession(name: string) {
  await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
  fireEvent.click(screen.getByText(name));
  await waitFor(() =>
    expect(screen.getByTestId("session-dialog")).toBeInTheDocument(),
  );
}

describe("SessionManagerPage", () => {
  beforeEach(() => {
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    clipboardWriteTextMock.mockReset();
    Element.prototype.scrollIntoView = vi.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: clipboardWriteTextMock,
      },
    });
    clipboardWriteTextMock.mockResolvedValue(undefined);

    const sessions: SessionMeta[] = [
      {
        providerId: "codex",
        sessionId: "codex-session-1",
        title: "Alpha Session",
        summary: "Alpha summary with detailed deployment context",
        projectDir: "/volume/pt-coder/users/wzhang/coder/swe",
        createdAt: 2,
        lastActiveAt: 20,
        sourcePath: "/mock/codex/session-1.jsonl",
        resumeCommand: "codex --yolo resume codex-session-1",
      },
      {
        providerId: "codex",
        sessionId: "codex-session-2",
        title: "Beta Session",
        summary: "Beta summary",
        projectDir: "/mock/codex",
        createdAt: 1,
        lastActiveAt: 10,
        sourcePath: "/mock/codex/session-2.jsonl",
        resumeCommand: "codex --yolo resume codex-session-2",
      },
    ];
    const messages: Record<string, SessionMessage[]> = {
      "codex:/mock/codex/session-1.jsonl": [
        { role: "user", content: "alpha deploy regression", ts: 20 },
      ],
      "codex:/mock/codex/session-2.jsonl": [
        { role: "user", content: "beta", ts: 10 },
      ],
    };

    setSessionFixtures(sessions, messages);
  });

  it("shows session ids in the list", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("codex-session-1")).toBeInTheDocument(),
    );
    expect(screen.getByText("codex-session-2")).toBeInTheDocument();
  });

  it("shows expanded session metadata in the list", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Alpha Session")).toBeInTheDocument(),
    );

    expect(
      screen.getByText("Alpha summary with detailed deployment context"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("/volume/pt-coder/users/wzhang/coder/swe"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("codex --yolo resume codex-session-1"),
    ).toBeInTheDocument();
  });

  it("copies expanded list metadata without opening the detail dialog", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Alpha Session")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getAllByRole("button", { name: /复制目录/i })[0]);

    await waitFor(() =>
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        "/volume/pt-coder/users/wzhang/coder/swe",
      ),
    );
    expect(screen.queryByTestId("session-dialog")).not.toBeInTheDocument();
  });

  it("copies the visible resume command from the list without opening the detail dialog", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Alpha Session")).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: /复制恢复命令/i })[0],
    );

    await waitFor(() =>
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        "codex --yolo resume codex-session-1",
      ),
    );
    expect(screen.queryByTestId("session-dialog")).not.toBeInTheDocument();
  });

  it("shows and copies the visible resume command from the detail dialog", async () => {
    renderPage();
    await openSession("Alpha Session");

    const sessionDialog = screen.getByTestId("session-dialog");
    expect(
      within(sessionDialog).getByText("codex --yolo resume codex-session-1"),
    ).toBeInTheDocument();

    fireEvent.click(
      within(sessionDialog).getByRole("button", { name: /复制恢复命令/i }),
    );

    await waitFor(() =>
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        "codex --yolo resume codex-session-1",
      ),
    );
  });

  it("shows and copies the visible project directory from the detail dialog", async () => {
    renderPage();
    await openSession("Alpha Session");

    const sessionDialog = screen.getByTestId("session-dialog");
    expect(
      within(sessionDialog).getByText(
        "/volume/pt-coder/users/wzhang/coder/swe",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      within(sessionDialog).getByRole("button", { name: /复制目录/i }),
    );

    await waitFor(() =>
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        "/volume/pt-coder/users/wzhang/coder/swe",
      ),
    );
  });

  it("shows the session summary in the detail dialog", async () => {
    renderPage();
    await openSession("Alpha Session");

    expect(
      within(screen.getByTestId("session-dialog")).getByText(
        "Alpha summary with detailed deployment context",
      ),
    ).toBeInTheDocument();
  });

  it("searches expanded metadata fields and highlights all query terms", async () => {
    const { container } = renderPage();

    await waitFor(() =>
      expect(screen.getByText("Alpha Session")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "coder swe" },
    });

    await waitFor(() =>
      expect(screen.getByText("Alpha Session")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Beta Session")).not.toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll("mark")).map(
        (node) => node.textContent,
      ),
    ).toEqual(expect.arrayContaining(["coder", "swe"]));
  });

  it("searches sessions by full transcript content", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Alpha Session")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "deploy regression" },
    });

    await waitFor(() =>
      expect(screen.getByText("Alpha Session")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Beta Session")).not.toBeInTheDocument();
  });

  it("does not swallow wheel events from the session list", async () => {
    const onWheel = vi.fn();
    renderPageInWheelWrapper(onWheel);

    await waitFor(() =>
      expect(screen.getByText("Alpha Session")).toBeInTheDocument(),
    );

    fireEvent.wheel(screen.getByText("Alpha Session"));

    expect(onWheel).toHaveBeenCalled();
  });

  it("clears the session search input", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Alpha Session")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Alpha" },
    });

    await waitFor(() =>
      expect(screen.queryByText("Beta Session")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /清除/i }));

    await waitFor(() =>
      expect(screen.getByText("Beta Session")).toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("shows a stable empty state when search has no matching sessions", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Alpha Session")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "NoSuchSession" },
    });

    await waitFor(() =>
      expect(screen.queryByText("Alpha Session")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(/当前筛选下没有匹配的会话|no matching sessions/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("NoSuchSession");
  });

  it("deletes the selected session via the detail dialog", async () => {
    renderPage();
    await openSession("Alpha Session");

    const sessionDialog = screen.getByTestId("session-dialog");
    fireEvent.click(
      within(sessionDialog).getByRole("button", { name: /删除/i }),
    );

    const confirmDialog = screen.getByTestId("confirm-dialog");
    expect(confirmDialog).toBeInTheDocument();
    expect(
      within(confirmDialog).getByText(/Alpha Session/),
    ).toBeInTheDocument();

    fireEvent.click(
      within(confirmDialog).getByRole("button", { name: /删除/i }),
    );

    await waitFor(() =>
      expect(screen.queryByText("Alpha Session")).not.toBeInTheDocument(),
    );

    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it("removes a deleted session from filtered search results", async () => {
    renderPage();
    await openSession("Alpha Session");

    // Delete from dialog
    const sessionDialog = screen.getByTestId("session-dialog");
    fireEvent.click(
      within(sessionDialog).getByRole("button", { name: /删除/i }),
    );

    const confirmDialog = screen.getByTestId("confirm-dialog");
    fireEvent.click(
      within(confirmDialog).getByRole("button", { name: /删除/i }),
    );

    await waitFor(() =>
      expect(screen.queryByText("Alpha Session")).not.toBeInTheDocument(),
    );

    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it("restores batch delete controls when deleteMany rejects", async () => {
    const deleteManySpy = vi
      .spyOn(sessionsApi, "deleteMany")
      .mockRejectedValueOnce(new Error("network error"));

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Alpha Session")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /批量管理/i }));
    fireEvent.click(screen.getByRole("button", { name: /全选当前/i }));
    fireEvent.click(screen.getByRole("button", { name: /批量删除/i }));

    const dialog = screen.getByTestId("confirm-dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /删除所选会话/i }),
    );

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("network error"),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /批量删除/i }),
      ).not.toBeDisabled(),
    );

    deleteManySpy.mockRestore();
  });

  it("keeps the exit batch mode button visible when search hides all sessions", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Alpha Session")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /批量管理/i }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "NoSuchSession" },
    });

    await waitFor(() => expect(screen.queryByText("Alpha Session")).toBeNull());

    expect(screen.getByRole("button", { name: /退出批量管理/i })).toBeVisible();
  });

  it("drops hidden selections when search narrows the result set", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Alpha Session")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /批量管理/i }));
    fireEvent.click(screen.getByRole("button", { name: /全选当前/i }));

    expect(screen.getByText("已选 2 项")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Alpha" },
    });

    await waitFor(() =>
      expect(screen.queryByText("Beta Session")).not.toBeInTheDocument(),
    );

    await waitFor(() =>
      expect(screen.getByText("已选 1 项")).toBeInTheDocument(),
    );
  });

  it("removes successfully deleted sessions from the UI before refetch completes", async () => {
    const view = renderPage();
    let resolveInvalidate!: () => void;
    const invalidateSpy = vi
      .spyOn(view.client, "invalidateQueries")
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveInvalidate = () => resolve(undefined);
          }),
      );

    await waitFor(() =>
      expect(screen.getByText("Alpha Session")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /批量管理/i }));
    fireEvent.click(screen.getByRole("button", { name: /全选当前/i }));
    fireEvent.click(screen.getByRole("button", { name: /批量删除/i }));

    const dialog = screen.getByTestId("confirm-dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /删除所选会话/i }),
    );

    await waitFor(() => {
      expect(screen.queryByText("Alpha Session")).not.toBeInTheDocument();
      expect(screen.queryByText("Beta Session")).not.toBeInTheDocument();
    });

    await act(async () => {
      resolveInvalidate();
    });
    invalidateSpy.mockRestore();
  });

  it("resets the provider filter when switching from claude to codex", async () => {
    const sessions: SessionMeta[] = [
      {
        providerId: "claude",
        sessionId: "claude-session-1",
        title: "Claude Session",
        summary: "Claude summary",
        projectDir: "/mock/claude",
        createdAt: 2,
        lastActiveAt: 20,
        sourcePath: "/mock/claude/session-1.jsonl",
        resumeCommand:
          "IS_SANDBOX=1 claude --dangerously-skip-permissions --resume claude-session-1",
      },
      {
        providerId: "codex",
        sessionId: "codex-session-1",
        title: "Codex Session",
        summary: "Codex summary",
        projectDir: "/mock/codex",
        createdAt: 1,
        lastActiveAt: 10,
        sourcePath: "/mock/codex/session-1.jsonl",
        resumeCommand: "codex --yolo resume codex-session-1",
      },
    ];
    const messages: Record<string, SessionMessage[]> = {
      "claude:/mock/claude/session-1.jsonl": [
        { role: "user", content: "claude", ts: 20 },
      ],
      "codex:/mock/codex/session-1.jsonl": [
        { role: "user", content: "codex", ts: 10 },
      ],
    };

    setSessionFixtures(sessions, messages);

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const view = render(
      <QueryClientProvider client={client}>
        <SessionManagerPage appId="claude" />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("Claude Session")).toBeInTheDocument(),
    );

    view.rerender(
      <QueryClientProvider client={client}>
        <SessionManagerPage appId="codex" />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("Codex Session")).toBeInTheDocument(),
    );

    expect(screen.queryByText("Claude Session")).not.toBeInTheDocument();
  });

  it("renders all messages in a long conversation without folding", async () => {
    const sessions: SessionMeta[] = [
      {
        providerId: "codex",
        sessionId: "codex-session-long",
        title: "Long Session",
        summary: "Many messages",
        projectDir: "/mock/codex",
        createdAt: 1,
        lastActiveAt: 100,
        sourcePath: "/mock/codex/long-session.jsonl",
        resumeCommand: "codex --yolo resume codex-session-long",
      },
    ];
    const longMessages = Array.from({ length: 220 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message-${index + 1}`,
      ts: index + 1,
    })) satisfies SessionMessage[];

    setSessionFixtures(sessions, {
      "codex:/mock/codex/long-session.jsonl": longMessages,
    });

    renderPage();
    await openSession("Long Session");

    // All 220 messages should be rendered — check that the last message exists
    await waitFor(() =>
      expect(screen.getByText("message-220")).toBeInTheDocument(),
    );

    // No folding controls should be present
    expect(screen.queryByText(/折叠/)).not.toBeInTheDocument();
  });
});
