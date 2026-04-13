import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@/lib/transport", () => ({
  invoke: invokeMock,
}));

import { sessionsApi } from "@/lib/api/sessions";

describe("sessionsApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("routes list through the shared transport layer", async () => {
    invokeMock.mockResolvedValueOnce([]);

    await sessionsApi.list();

    expect(invokeMock).toHaveBeenCalledWith("list_sessions");
  });

  it("routes getMessages through the shared transport layer", async () => {
    invokeMock.mockResolvedValueOnce([]);

    await sessionsApi.getMessages("codex", "/tmp/session.jsonl");

    expect(invokeMock).toHaveBeenCalledWith("get_session_messages", {
      providerId: "codex",
      sourcePath: "/tmp/session.jsonl",
    });
  });

  it("routes delete through the shared transport layer", async () => {
    invokeMock.mockResolvedValueOnce(true);

    await sessionsApi.delete({
      providerId: "codex",
      sessionId: "session-1",
      sourcePath: "/tmp/session.jsonl",
    });

    expect(invokeMock).toHaveBeenCalledWith("delete_session", {
      providerId: "codex",
      sessionId: "session-1",
      sourcePath: "/tmp/session.jsonl",
    });
  });

  it("passes initial input through launchTerminal", async () => {
    invokeMock.mockResolvedValueOnce(true);

    await sessionsApi.launchTerminal({
      command: "claude",
      cwd: "/tmp/project",
      initialInput: "Continue from here",
    });

    expect(invokeMock).toHaveBeenCalledWith("launch_session_terminal", {
      command: "claude",
      cwd: "/tmp/project",
      customConfig: undefined,
      initialInput: "Continue from here",
    });
  });
});
