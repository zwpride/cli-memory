import { createRef } from "react";
import {
  render,
  screen,
  waitFor,
  act,
  within,
  fireEvent,
} from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import UnifiedSkillsPanel, {
  type UnifiedSkillsPanelHandle,
} from "@/components/skills/UnifiedSkillsPanel";

const scanUnmanagedMock = vi.fn();
const toggleSkillAppMock = vi.fn();
const uninstallSkillMock = vi.fn();
const importSkillsMock = vi.fn();
const installFromZipMock = vi.fn();
const deleteSkillBackupMock = vi.fn();
const restoreSkillBackupMock = vi.fn();
let installedSkillsData: any[] = [];

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/hooks/useSkills", () => ({
  useInstalledSkills: () => ({
    data: installedSkillsData,
    isLoading: false,
  }),
  useSkillBackups: () => ({
    data: [],
    refetch: vi.fn(),
    isFetching: false,
  }),
  useDeleteSkillBackup: () => ({
    mutateAsync: deleteSkillBackupMock,
    isPending: false,
  }),
  useToggleSkillApp: () => ({
    mutateAsync: toggleSkillAppMock,
  }),
  useRestoreSkillBackup: () => ({
    mutateAsync: restoreSkillBackupMock,
    isPending: false,
  }),
  useUninstallSkill: () => ({
    mutateAsync: uninstallSkillMock,
  }),
  useScanUnmanagedSkills: () => ({
    data: [
      {
        directory: "shared-skill",
        name: "Shared Skill",
        description: "Imported from Claude",
        foundIn: ["claude"],
        path: "/tmp/shared-skill",
      },
    ],
    refetch: scanUnmanagedMock,
  }),
  useImportSkillsFromApps: () => ({
    mutateAsync: importSkillsMock,
  }),
  useInstallSkillsFromZip: () => ({
    mutateAsync: installFromZipMock,
  }),
  useCheckSkillUpdates: () => ({
    data: [],
    refetch: vi.fn(),
    isFetching: false,
  }),
  useUpdateSkill: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

describe("UnifiedSkillsPanel", () => {
  beforeEach(() => {
    installedSkillsData = [];
    scanUnmanagedMock.mockResolvedValue({
      data: [
        {
          directory: "shared-skill",
          name: "Shared Skill",
          description: "Imported from Claude",
          foundIn: ["claude"],
          path: "/tmp/shared-skill",
        },
      ],
    });
    toggleSkillAppMock.mockReset();
    uninstallSkillMock.mockReset();
    importSkillsMock.mockReset();
    installFromZipMock.mockReset();
    deleteSkillBackupMock.mockReset();
    restoreSkillBackupMock.mockReset();
  });

  it("opens the import dialog without crashing when app toggles render", async () => {
    const ref = createRef<UnifiedSkillsPanelHandle>();

    render(
      <UnifiedSkillsPanel
        ref={ref}
        onOpenDiscovery={() => {}}
        currentApp="claude"
      />,
    );

    await act(async () => {
      await ref.current?.openImport();
    });

    await waitFor(() => {
      expect(screen.getByText("skills.import")).toBeInTheDocument();
      expect(screen.getByText("Shared Skill")).toBeInTheDocument();
      expect(screen.getByText("/tmp/shared-skill")).toBeInTheDocument();
    });
  });

  it("supports cross-app skill actions without switching the whole page app", async () => {
    installedSkillsData = [
      {
        id: "skill-1",
        name: "Cross App Skill",
        description: "Shared workflow helper",
        directory: "cross-app-skill",
        repoOwner: "demo",
        repoName: "skills",
        readmeUrl: null,
        apps: {
          claude: true,
          codex: false,
          gemini: false,
          opencode: false,
          openclaw: false,
        },
      },
    ];

    render(<UnifiedSkillsPanel onOpenDiscovery={() => {}} currentApp="claude" />);

    expect(screen.getByText("Cross App Skill")).toBeInTheDocument();
    expect(screen.getByText("跨应用启用")).toBeInTheDocument();

    const row = screen.getByText("Cross App Skill").closest(".group");
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByText("全部启用"));

    await waitFor(() => {
      expect(toggleSkillAppMock).toHaveBeenCalledWith({
        id: "skill-1",
        app: "codex",
        enabled: true,
      });
      expect(toggleSkillAppMock).toHaveBeenCalledWith({
        id: "skill-1",
        app: "gemini",
        enabled: true,
      });
      expect(toggleSkillAppMock).toHaveBeenCalledWith({
        id: "skill-1",
        app: "opencode",
        enabled: true,
      });
    });
  });
});
