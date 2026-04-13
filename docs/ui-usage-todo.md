# CC-Switch Web UX Status

Last updated: `2026-04-13`

This file is no longer a speculative TODO list. The Web-first cleanup has been implemented and verified locally.

## Completed

### 1. Top-level navigation

- `主页 / 统计与会话 / 设置` is now the only primary navigation layer in the Web UI.
- Secondary tools no longer live in the header as pseudo-pages.
- `主页` keeps provider management as the primary job and moves `Skills / Prompts / MCP` into page-local navigation.

Files:

- `src/App.tsx`

### 2. Home page structure

- The home page is now full-width instead of a permanent left/right split.
- Provider management remains the main workspace.
- Secondary tools open inside the home page instead of pretending to be top-level pages.
- The page now reads as:
  - summary / CTA
  - provider workspace
  - workflow tools

Files:

- `src/App.tsx`

### 3. Activity hub

- `统计与会话` is now one full page shell.
- The page has one title and one sub-navigation only.
- `Usage` and `Sessions` are no longer duplicated as repeated headers/buttons in multiple places.
- `UsageDashboard` now supports headerless embedded rendering so the page shell owns the hierarchy.

Files:

- `src/App.tsx`
- `src/components/usage/UsageDashboard.tsx`

### 4. Session manager usability

- Search is always visible instead of being hidden behind a toggle.
- Search, provider filter, refresh, and batch mode are now separate controls.
- Batch actions live in a dedicated toolbar.
- Provider labels are explicit (`Codex`, `Claude Code`, `Gemini CLI`, etc.).
- Empty states distinguish:
  - no sessions at all
  - no sessions in current app
  - no results under current search/filter
- Web mode no longer pretends cross-app continuation is a native terminal action.

Files:

- `src/components/sessions/SessionManagerPage.tsx`
- `src/components/sessions/SessionItem.tsx`
- `src/components/sessions/utils.ts`

### 5. Web-appropriate cross-app handoff

- Native terminal continuation is now only shown in native-capable contexts.
- Web/Linux mode now uses an explicit manual handoff flow:
  - copy handoff prompt
  - copy target command separately
  - clear explanation that this is a new conversation seeded from prior context
- The odd macOS-first behavior is no longer the default Web experience.

Files:

- `src/components/sessions/SessionManagerPage.tsx`

### 6. Settings architecture

- Settings remains configuration-only.
- Usage/statistics content is no longer embedded as a settings page concern.
- The embedded settings view stays single-layer and scrollable.

Files:

- `src/components/settings/SettingsPage.tsx`

### 7. Auth center

- `Claude Code` now has a first-class status section.
- The UI separates:
  - official/local CLI auth path
  - provider credential path
  - routed endpoint mode
- The page now has a top-level refresh action for auth/status state.

Files:

- `src/components/settings/AuthCenterPanel.tsx`

### 8. Skills workflow

- Skills are managed through a multi-app matrix, not only the current app context.
- Users can enable skills across multiple apps without switching the whole page.
- Bulk row actions now support:
  - current app only
  - enable all
  - disable all

Files:

- `src/components/skills/UnifiedSkillsPanel.tsx`

### 9. Transport consistency

- High-risk Web-facing API modules now route through `@/lib/transport` instead of importing Tauri directly.
- This reduces future “desktop works, web breaks” regressions.

Files:

- `src/lib/api/proxy.ts`
- `src/lib/api/failover.ts`
- `src/lib/api/model-test.ts`
- `src/lib/api/subscription.ts`
- `src/lib/api/openclaw.ts`
- `src/lib/api/workspace.ts`
- `src/lib/api/model-fetch.ts`
- `src/lib/api/globalProxy.ts`
- `src/lib/api/copilot.ts`
- `src/lib/api/omo.ts`
- `src/hooks/useProxyConfig.ts`
- `src/components/theme-provider.tsx`

### 10. Regression coverage added

- Web session hydration regression coverage
- Manual handoff regression coverage
- Auth center regression coverage
- Skills matrix regression coverage
- Request log visibility regression coverage
- Shared transport API regression coverage

Files:

- `tests/components/SessionManagerPage.test.tsx`
- `tests/components/AuthCenterPanel.test.tsx`
- `tests/components/UnifiedSkillsPanel.test.tsx`
- `tests/components/RequestLogTable.test.tsx`
- `tests/lib/sessionsApi.test.ts`
- `tests/lib/transportApis.test.ts`

## Verified

The current Web-first state was verified with:

- `pnpm exec vitest run tests/components/SessionManagerPage.test.tsx tests/components/AuthCenterPanel.test.tsx tests/components/UnifiedSkillsPanel.test.tsx tests/components/RequestLogTable.test.tsx tests/lib/sessionsApi.test.ts tests/lib/transportApis.test.ts`
- `pnpm typecheck`
- `pnpm build:web`
- `pnpm smoke:web-local`

## Remaining Backlog

These are intentionally **not** part of the Web TODO completion bar:

- native `Claude Code` official auth command flow beyond status/visibility
- true cross-tool native session continuation instead of seeded handoff
- bundle/code-splitting work for the large web chunk warning
- deeper desktop-only window UX refinements
- provider/protocol compatibility redesign beyond Web presentation
