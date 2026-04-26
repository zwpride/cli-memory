import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import MarkdownEditor from "@/components/MarkdownEditor";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import type { Prompt, AppId } from "@/lib/api";

interface PromptFormPanelProps {
  appId: AppId;
  editingId?: string;
  initialData?: Prompt;
  onSave: (id: string, prompt: Prompt) => Promise<void>;
  onClose: () => void;
}

const PromptFormPanel: React.FC<PromptFormPanelProps> = ({
  appId,
  editingId,
  initialData,
  onSave,
  onClose,
}) => {
  const { t } = useTranslation();
  const appName = t(`apps.${appId}`);
  const filenameMap: Record<AppId, string> = {
    claude: "CLAUDE.md",
    codex: "AGENTS.md",
    gemini: "GEMINI.md",
    opencode: "AGENTS.md",
  };
  const filename = filenameMap[appId];
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    setIsDarkMode(document.documentElement.classList.contains("dark"));

    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (initialData) {
      setName(initialData.name);
      setDescription(initialData.description || "");
      setContent(initialData.content);
    }
  }, [initialData]);

  const handleSave = async () => {
    if (!name.trim()) {
      return;
    }

    setSaving(true);
    try {
      const id = editingId || `prompt-${Date.now()}`;
      const timestamp = Math.floor(Date.now() / 1000);
      const prompt: Prompt = {
        id,
        name: name.trim(),
        description: description.trim() || undefined,
        content: content.trim(),
        enabled: initialData?.enabled || false,
        createdAt: initialData?.createdAt || timestamp,
        updatedAt: timestamp,
      };
      await onSave(id, prompt);
      onClose();
    } catch (error) {
      // Error handled by hook
    } finally {
      setSaving(false);
    }
  };

  const title = editingId
    ? t("prompts.editTitle", { appName })
    : t("prompts.addTitle", { appName });

  return (
    <FullScreenPanel
      isOpen={true}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </>
      }
    >
      <div className="app-dialog-hint">
        {t("prompts.formHint", {
          defaultValue:
            "提示词会保存到当前 CLI 的本地配置中，保存按钮固定在底部，长内容只滚动编辑区。",
        })}
      </div>

      <div className="app-form-section">
        <div className="app-form-grid">
          <div>
            <Label htmlFor="name" className="text-foreground">
              {t("prompts.name")}
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("prompts.namePlaceholder")}
              className="mt-2"
            />
          </div>

          <div>
            <Label htmlFor="description" className="text-foreground">
              {t("prompts.description")}
            </Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("prompts.descriptionPlaceholder")}
              className="mt-2"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="content" className="block mb-2 text-foreground">
            {t("prompts.content")}
          </Label>
          <MarkdownEditor
            value={content}
            onChange={setContent}
            placeholder={t("prompts.contentPlaceholder", { filename })}
            darkMode={isDarkMode}
            minHeight="260px"
          />
        </div>
      </div>
    </FullScreenPanel>
  );
};

export default PromptFormPanel;
