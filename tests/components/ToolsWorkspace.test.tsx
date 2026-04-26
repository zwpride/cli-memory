import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ToolsWorkspace from "@/components/workspace/ToolsWorkspace";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: { appName?: string; defaultValue?: string },
    ) => {
      switch (key) {
        case "apps.claude":
          return "Claude";
        case "skills.title":
          return "Skills";
        case "skills.discover":
          return "Discover";
        case "prompts.title":
          return `${options?.appName ?? "{{appName}}"} Prompt Management`;
        case "mcp.unifiedPanel.title":
          return "MCP";
        case "common.tools":
          return "Tools";
        case "common.localConfig":
          return "Local Config";
        case "common.toolsDescription":
          return options?.defaultValue ?? "Tools description";
        case "prompts.add":
          return "Add Prompt";
        default:
          return options?.defaultValue ?? key;
      }
    },
  }),
}));

vi.mock("@/components/prompts/PromptPanel", () => ({
  default: React.forwardRef(() => <div data-testid="prompt-panel">prompt-panel</div>),
}));

vi.mock("@/components/mcp/UnifiedMcpPanel", () => ({
  default: React.forwardRef(() => <div data-testid="mcp-panel">mcp-panel</div>),
}));

vi.mock("@/components/skills/SkillsPage", () => ({
  SkillsPage: React.forwardRef(() => (
    <div data-testid="skills-discovery-panel">skills-discovery-panel</div>
  )),
}));

vi.mock("@/components/skills/UnifiedSkillsPanel", () => ({
  default: React.forwardRef(() => (
    <div data-testid="skills-panel">skills-panel</div>
  )),
}));

describe("ToolsWorkspace", () => {
  it("renders interpolated app name for prompt management title", () => {
    render(
      <ToolsWorkspace
        activeApp="claude"
        activeToolPanel="prompts"
        onToolPanelChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Claude Prompt Management")).toBeInTheDocument();
    expect(
      screen.getByText("维护当前 CLI 的提示词模板和启用状态。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\{\{appName\}\}/)).not.toBeInTheDocument();
  });
});
