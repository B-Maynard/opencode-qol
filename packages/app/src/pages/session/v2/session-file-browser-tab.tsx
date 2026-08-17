import { createMemo, createSignal, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { SessionFilePanelV2, SessionFilePanelV2Empty } from "@opencode-ai/session-ui/v2/session-file-panel-v2"
import { SessionReviewV2Sidebar } from "@opencode-ai/session-ui/v2/session-review-v2"
import type { Kind } from "@/components/file-tree-v2"
import { GitPanel } from "@/components/git-panel"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { displayName } from "@/pages/layout/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { SessionFileView } from "@/pages/session/file-tabs"
import { createIdeFileSearch, IdeFileBrowserFiles } from "@/pages/session/v2/ide-file-browser"
import { pathKey } from "@/utils/path-key"

export type SessionFileBrowserState = {
  sidebarOpened: () => boolean
  sidebarWidth: () => number
  sidebarTransition: () => boolean
  resizeSidebar: (width: number) => void
  toggleSidebar: () => void
}

export function SessionFileBrowserTab(props: {
  tab: string
  placeholder: boolean
  active?: string
  kinds: ReadonlyMap<string, Kind>
  state: SessionFileBrowserState
  onSelect: (path: string) => void
  onSelectPermanent: (path: string) => void
  onEdit?: (path: string) => void
  onSelectFile?: (path: string) => void
  diffs?: () => { file: string }[]
  filterRef?: (element: HTMLInputElement) => void
  staged?: () => string[]
  onStage?: (files: string[]) => Promise<void>
  onUnstage?: (files: string[]) => void
  onCommitSuccess?: () => void
  onPushSuccess?: () => void
}) {
  const language = useLanguage()
  const layout = useLayout()
  const sdk = useSDK()
  const settings = useSettings()
  const { workspaceKey } = useSessionLayout()
  const [mode, setMode] = createSignal<"files" | "git">("files")
  const sidebarOpened = () => props.placeholder || props.state.sidebarOpened()
  const search = createIdeFileSearch({
    workspaceKey,
    onSelectPermanent: props.onSelectPermanent,
  })
  const project = createMemo(() => {
    const directory = pathKey(sdk().directory)
    return layout.projects
      .list()
      .find(
        (item) =>
          pathKey(item.worktree) === directory || item.sandboxes?.some((sandbox) => pathKey(sandbox) === directory),
      )
  })
  const title = createMemo(() => displayName(project() ?? { worktree: sdk().directory }))

  // Keep the sidebar outside Kobalte Tabs.Content: a morphing content value
  // unmounts the whole panel on every file-tab switch and resets sidebar scroll.
  return (
    <SessionFilePanelV2
      toolbar={false}
      sidebar={
        <SessionReviewV2Sidebar
          open={sidebarOpened()}
          transition={props.state.sidebarTransition()}
          title={<span class="truncate">{title()}</span>}
          stats={
            <div class="flex gap-1">
              <Button
                size="small"
                variant={mode() === "files" ? "primary" : "secondary"}
                onClick={() => setMode("files")}
              >
                {language.t("session.files.all")}
              </Button>
              <Button
                size="small"
                variant={mode() === "git" ? "primary" : "secondary"}
                onClick={() => setMode("git")}
              >
                {language.t("session.git.tab")}
              </Button>
            </div>
          }
          filter={search.filter()}
          onFilterChange={search.setFilter}
          onFilterKeyDown={search.onFilterKeyDown}
          filterAutofocus={props.placeholder}
          filterRef={props.filterRef}
          filterControls={search.resultsID}
          filterActiveDescendant={search.highlighted() ? search.optionID(search.highlighted()!) : undefined}
          filterExpanded={search.query().length > 0 && search.files().length > 0}
          width={props.state.sidebarWidth()}
          onWidthChange={props.state.resizeSidebar}
        >
          <Show
            when={mode() === "files"}
            fallback={
              <GitPanel
                files={() => props.diffs?.() ?? []}
                onSelectFile={props.onSelectFile}
                staged={() => props.staged?.() ?? []}
                onStage={(files) => props.onStage?.(files) ?? Promise.resolve()}
                onUnstage={(files) => props.onUnstage?.(files)}
                onCommitSuccess={props.onCommitSuccess}
                onPushSuccess={props.onPushSuccess}
              />
            }
          >
            <IdeFileBrowserFiles
              query={search.query}
              loading={search.loading}
              files={search.files}
              highlighted={search.highlighted}
              optionID={search.optionID}
              resultsID={search.resultsID}
              active={props.active}
              kinds={props.kinds}
              onSelect={props.onSelect}
              onSelectPermanent={props.onSelectPermanent}
              onHighlight={search.setExplicitHighlight}
            />
          </Show>
        </SessionReviewV2Sidebar>
      }
    >
      <Show
        when={!props.placeholder}
        fallback={
          <SessionFilePanelV2Empty>
            <div class="flex flex-col items-center gap-3 text-center text-text-weak">
              <Icon name="file-tree" size="large" />
              <div class="text-14-medium text-text-strong">{language.t("session.tab.code")}</div>
              <div class="text-13-regular">{language.t("session.files.selectToOpen")}</div>
            </div>
          </SessionFilePanelV2Empty>
        }
      >
        <div class="min-h-0 flex-1 flex flex-col">
          <Show when={props.active}>
            {(active) => (
              <div class="flex justify-end px-3 pt-2">
                <Button size="small" variant="secondary" onClick={() => props.onEdit?.(active())}>
                  {language.t("fileEditor.edit")}
                </Button>
              </div>
            )}
          </Show>
          <div class="min-h-0 flex-1">
            <Show when={props.tab} keyed>
              {(tab) => <SessionFileView tab={tab} />}
            </Show>
          </div>
        </div>
      </Show>
    </SessionFilePanelV2>
  )
}