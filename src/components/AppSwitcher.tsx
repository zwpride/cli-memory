import type { AppId } from "@/lib/api";
import { ProviderIcon } from "@/components/ProviderIcon";
import { cn } from "@/lib/utils";

interface AppSwitcherProps {
  activeApp: AppId;
  onSwitch: (app: AppId) => void;
}

const ALL_APPS: AppId[] = ["claude", "codex", "gemini", "opencode"];
const STORAGE_KEY = "cli-memory-last-app";

export function AppSwitcher({ activeApp, onSwitch }: AppSwitcherProps) {
  const handleSwitch = (app: AppId) => {
    if (app === activeApp) return;
    localStorage.setItem(STORAGE_KEY, app);
    onSwitch(app);
  };
  const appIconName: Record<AppId, string> = {
    claude: "claude",
    codex: "openai",
    gemini: "gemini",
    opencode: "opencode",
  };
  const appDisplayName: Record<AppId, string> = {
    claude: "Claude",
    codex: "Codex",
    gemini: "Gemini",
    opencode: "OpenCode",
  };

  return (
    <div className="app-segmented inline-flex gap-1">
      {ALL_APPS.map((app) => (
        <button
          key={app}
          type="button"
          onClick={() => handleSwitch(app)}
          className={cn(
            "app-segmented-item group inline-flex h-9 items-center px-2.5 text-[13px] font-medium",
            activeApp === app && "shadow-sm",
          )}
          data-active={activeApp === app}
        >
          <ProviderIcon
            icon={appIconName[app]}
            name={appDisplayName[app]}
            size={18}
          />
          <span className="ml-2 max-w-[80px] overflow-hidden whitespace-nowrap transition-all duration-200">
            {appDisplayName[app]}
          </span>
        </button>
      ))}
    </div>
  );
}
