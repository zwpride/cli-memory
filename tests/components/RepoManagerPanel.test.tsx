import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RepoManagerPanel } from "@/components/skills/RepoManagerPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

vi.mock("@/lib/api", () => ({
  settingsApi: {
    openExternal: vi.fn(),
  },
}));

describe("RepoManagerPanel", () => {
  it("renders the improved repository empty state", () => {
    render(
      <RepoManagerPanel
        repos={[]}
        skills={[]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText("添加 GitHub 仓库后，CLI Memory 会从该仓库发现可安装的 Skills。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("添加一个 GitHub 仓库后，这里会显示它提供的 Skills 数量。"),
    ).toBeInTheDocument();
  });
});
