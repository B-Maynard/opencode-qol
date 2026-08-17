import { createMemo, createResource, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { Button } from "@opencode-ai/ui/button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { SessionReviewFilePreviewV2 } from "@opencode-ai/session-ui/v2/session-review-file-preview-v2"
import type { VcsFileDiff } from "@opencode-ai/sdk/v2"
import { SortableTabV2 } from "@/components/session/session-sortable-tab-v2"
import { GitPanel } from "@/components/git-panel"
import { normalizeFileTreeV2Path } from "@/components/file-tree-v2-model"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { SessionFileView } from "@/pages/session/file-tabs"
import { createSessionTabs, createSizing } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { TerminalPanelV2 } from "@/pages/session/terminal-panel-v2"
import { createIdeFileSearch, IdeFileBrowserFiles } from "@/pages/session/v2/ide-file-browser"
import { SearchPanel } from "@/pages/session/ide/search-panel"

type IdePanel = "files" | "git" | "search"

function IdeRail(props: { active: IdePanel | undefined; onSelect: (panel: IdePanel) => void }) {
  const language = useLanguage()
  const items = [
    { id: "files", icon: "filetree", label: language.t("session.ide.files") },
    { id: "git", icon: "branch", label: language.t("session.ide.git") },
    { id: "search", icon: "magnifying-glass", label: language.t("session.ide.search") },
  ] as const
  return (
    <div class="flex shrink-0 flex-col items-center gap-1 border-r border-border-weaker-base py-2">
      <For each={items}>
        {(item) => (
          <TooltipV2 value={item.label} placement="right">
            <IconButtonV2
              variant={props.active === item.id ? "neutral" : "ghost-muted"}
              icon={<Icon name={item.icon} />}
              aria-label={item.label}
              aria-pressed={props.active === item.id}
              onClick={() => props.onSelect(item.id)}
            />
          </TooltipV2>
        )}
      </For>
    </div>
  )
}

export function IdeWorkspace(props: {
  chat: () => JSX.Element
  diffs: () => VcsFileDiff[]
  staged: () => string[]
  onStage: (files: string[]) => Promise<void>
  onUnstage: (files: string[]) => void
  onCommitSuccess?: () => void
  onPushSuccess?: () => void
}) {
  const language = useLanguage()
  const layout = useLayout()
  const file = useFile()
  const { workspaceKey, tabs, view } = useSessionLayout()
  const size = createSizing()
  const [leftPanel, setLeftPanel] = createSignal<IdePanel | undefined>("files")
  const [chatOpened, setChatOpened] = createSignal(true)
  const [selectedDiffFile, setSelectedDiffFile] = createSignal<string | undefined>()
  const sdk = useSDK()
  const loadDiff = async (filePath: string) => {
    const diff = props.diffs().find((d) => d.file === filePath)
    if (!diff) return undefined
    return diff
  }
  const search = createIdeFileSearch({
    workspaceKey,
    onSelectPermanent: (path) => openFile(path),
  })
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  })
  const activeFileTab = tabState.activeFileTab
  const openedTabs = tabState.openedTabs
  const temporaryTab = tabs().preview
  const activePath = createMemo(() => file.pathFromTab(activeFileTab() ?? ""))
  const terminalOpen = createMemo(() => view().terminal.opened())
  const leftOpen = () => leftPanel() !== undefined
  const leftWidth = () => (leftOpen() ? layout.ide.leftWidth() : 0)
  const chatWidth = () => (chatOpened() ? layout.ide.chatWidth() : 0)
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }
    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of props.diffs()) {
      const file = normalizeFileTreeV2Path(diff.file)
      const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"
      out.set(file, kind)
      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  let tabList: HTMLDivElement | undefined

  const normalizeTab = (tab: string) => (tab.startsWith("file://") ? file.tab(tab) : tab)

  const activateTab = (value: string) => {
    const next = normalizeTab(value)
    const path = file.pathFromTab(next)
    if (path) void file.load(path)
    tabs().setActive(next)
    // Clear diff view when opening an edit tab
    if (next.startsWith("edit://")) setSelectedDiffFile(undefined)
  }

  const openTab = (tab: string) => {
    const path = file.pathFromTab(tab)
    if (path) void file.load(path)
    tabs().open(tab)
    tabs().setActive(tab)
  }

  const previewFile = (path: string) => {
    const tab = file.tab(path)
    tabs().previewTab(tab)
    tabs().setActive(tab)
    void file.load(path)
  }

  const openFile = (path: string, line?: number) => {
    if (line !== undefined) file.setSelectedLines(path, { start: line, end: line })
    const tab = file.editTab(path)
    tabs().open(tab)
    tabs().setActive(tab)
    void file.load(path)
  }

  const openFileInView = (path: string) => {
    const tab = file.tab(path)
    tabs().open(tab)
    tabs().setActive(tab)
    void file.load(path)
  }

  const togglePanel = (panel: IdePanel) => {
    setLeftPanel((current) => (current === panel ? undefined : panel))
  }

  return (
    <div class="flex h-full min-h-0 overflow-hidden bg-v2-background-bg-base">
      <IdeRail active={leftPanel()} onSelect={togglePanel} />
      <Show when={leftOpen()}>
        <div
          class="flex h-full min-h-0 shrink-0 flex-col border-r border-border-weaker-base"
          style={{ width: `${leftWidth()}px` }}
        >
          <Show when={leftPanel() === "files"}>
            <div class="flex h-full min-h-0 flex-col">
              <div class="shrink-0 p-2">
                <TextInputV2
                  class="!w-full"
                  type="search"
                  value={search.filter()}
                  onInput={(event) => search.setFilter(event.currentTarget.value)}
                  onKeyDown={search.onFilterKeyDown}
                  placeholder={language.t("session.ide.search.placeholder")}
                  aria-label={language.t("session.ide.files")}
                  showClearButton={search.filter().length > 0}
                  clearLabel={language.t("common.clear")}
                  onClearClick={() => search.setFilter("")}
                  leadingIcon={<Icon name="magnifying-glass" />}
                />
              </div>
              <div class="min-h-0 flex-1 overflow-auto">
                <IdeFileBrowserFiles
                  query={search.query}
                  loading={search.loading}
                  files={search.files}
                  highlighted={search.highlighted}
                  optionID={search.optionID}
                  resultsID={search.resultsID}
                  active={activePath()}
                  kinds={kinds()}
                  onSelect={previewFile}
                  onSelectPermanent={openFile}
                  onHighlight={search.setExplicitHighlight}
                />
              </div>
            </div>
          </Show>
          <Show when={leftPanel() === "git"}>
            <GitPanel
              files={props.diffs}
              onSelectFile={(path) => {
                setSelectedDiffFile(path)
                // Also open a file:// tab so the edit button works
                const tab = file.tab(path)
                tabs().open(tab)
                tabs().setActive(tab)
                void file.load(path)
              }}
              staged={props.staged}
              onStage={props.onStage}
              onUnstage={props.onUnstage}
              onCommitSuccess={props.onCommitSuccess}
              onPushSuccess={props.onPushSuccess}
            />
          </Show>
          <Show when={leftPanel() === "search"}>
            <SearchPanel onOpenFile={openFile} />
          </Show>
        </div>
        <div class="relative h-full shrink-0" onPointerDown={() => size.start()}>
          <ResizeHandle
            direction="horizontal"
            edge="end"
            size={layout.ide.leftWidth()}
            min={200}
            max={480}
            collapseThreshold={50}
            onResize={(width) => {
              size.touch()
              layout.ide.resizeLeft(width)
            }}
            onCollapse={() => setLeftPanel(undefined)}
          />
        </div>
      </Show>
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex min-h-0 flex-1 flex-col">
          <DragDropProvider
            sensors={[
              PointerSensor.configure({
                activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
                preventActivation: (event) =>
                  event.target instanceof Element &&
                  !!event.target.closest('[data-slot="tabs-trigger-close-button"], input, [contenteditable="true"]'),
              }),
            ]}
            modifiers={[RestrictToHorizontalAxis, RestrictToElement.configure({ element: () => tabList ?? null })]}
            plugins={(defaults) => [
              ...defaults.filter((plugin) => plugin !== Accessibility),
              AutoScroller.configure({ acceleration: 8, threshold: { x: 0.05, y: 0 } }),
              Feedback.configure({ dropAnimation: null }),
            ]}
            onDragEnd={(event) => {
              const source = event.operation.source
              if (!event.canceled && isSortable(source) && source.initialIndex !== source.index) {
                tabs().move(source.id.toString(), source.index)
              }
            }}
          >
            <Tabs value={activeFileTab() ?? ""} onChange={activateTab} class="!h-[52px] !flex-none">
              <Tabs.List
                ref={(el: HTMLDivElement) => {
                  tabList = el
                  const stop = createFileTabListSync({ el, contextOpen: () => false })
                  onCleanup(stop)
                }}
              >
                <For each={openedTabs()}>
                  {(tab) => (
                    <SortableTabV2
                      tab={tab}
                      index={() => tabs().all().indexOf(tab)}
                      temporary={temporaryTab() === tab}
                      onTabClose={tabs().close}
                      onTabDoubleClick={temporaryTab() === tab ? openTab : undefined}
                    />
                  )}
                </For>
              </Tabs.List>
              <Show when={activeFileTab() && file.pathFromTab(activeFileTab()!)}>
                <div class="ml-auto shrink-0 px-2">
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => {
                      const tab = activeFileTab()
                      if (!tab) return
                      const path = file.pathFromTab(tab)
                      if (!path) return
                      const next = tab.startsWith("file://") ? file.editTab(path) : file.tab(path)
                      tabs().open(next)
                      tabs().setActive(next)
if (next.startsWith("edit://")) setSelectedDiffFile(undefined)
                      else setSelectedDiffFile(path)
                    }}
                  >
                    {activeFileTab()?.startsWith("file://") ? language.t("fileEditor.edit") : language.t("session.tab.review")}
                  </Button>
                </div>
              </Show>
            </Tabs>
          </DragDropProvider>
          <div class="min-h-0 flex-1">
            <Show when={selectedDiffFile()} keyed>
              {(diffFile) => {
                const diff = createMemo(() => props.diffs().find((d) => d.file === diffFile))
                return (
                  <Show when={diff()} keyed>
                    {(d) => (
                      <SessionReviewFilePreviewV2
                        file={diffFile}
                        diff={d}
                        diffStyle="unified"
                        onEditFile={(path) => {
                          const editTab = file.editTab(path)
                          tabs().open(editTab)
                          tabs().setActive(editTab)
                          void file.load(path)
                          setSelectedDiffFile(undefined)
                        }}
                      />
                    )}
                  </Show>
                )
              }}
            </Show>
            <Show when={!selectedDiffFile()}>
              <Show
                when={activeFileTab()}
                keyed
                fallback={
                  <div class="flex h-full flex-col items-center justify-center gap-3 text-center text-text-weak">
                    <Icon name="filetree" size="large" />
                    <div class="text-14-medium text-text-strong">{language.t("session.tab.code")}</div>
                    <div class="text-13-regular">{language.t("session.files.selectToOpen")}</div>
                  </div>
                }
              >
                {(tab) => <SessionFileView tab={tab} />}
              </Show>
            </Show>
          </div>
        </div>
        <Show when={terminalOpen()}>
          <div class="relative h-2 shrink-0" onPointerDown={() => size.start()}>
            <ResizeHandle
              class="!relative !inset-auto !h-full !w-full !transform-none"
              direction="vertical"
              size={layout.terminal.height()}
              min={100}
              max={typeof window === "undefined" ? 600 : window.innerHeight * 0.6}
              collapseThreshold={50}
              onResize={(height) => {
                size.touch()
                layout.terminal.resize(height)
              }}
              onCollapse={() => view().terminal.close()}
            />
          </div>
          <div class="min-h-0 shrink-0">
            <TerminalPanelV2 stacked />
          </div>
        </Show>
      </div>
      <Show when={chatOpened()}>
        <div class="relative h-full shrink-0" onPointerDown={() => size.start()}>
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={layout.ide.chatWidth()}
            min={280}
            max={600}
            collapseThreshold={50}
            onResize={(width) => {
              size.touch()
              layout.ide.resizeChat(width)
            }}
            onCollapse={() => setChatOpened(false)}
          />
        </div>
        <div
          class="flex h-full min-h-0 shrink-0 flex-col border-l border-border-weaker-base"
          style={{ width: `${chatWidth()}px` }}
        >
          <div class="flex shrink-0 items-center justify-between border-b border-border-weaker-base px-2 py-1.5">
            <span class="text-12-medium text-text-muted">{language.t("session.ide.chat")}</span>
            <IconButtonV2
              variant="ghost-muted"
              icon={<Icon name="collapse" />}
              aria-label={language.t("session.ide.chat.collapse")}
              onClick={() => setChatOpened(false)}
            />
          </div>
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">{props.chat()}</div>
        </div>
      </Show>
      <Show when={!chatOpened()}>
        <button
          type="button"
          class="flex h-full w-6 shrink-0 items-center justify-center border-l border-border-weaker-base text-text-muted hover:text-text-base"
          aria-label={language.t("session.ide.chat.expand")}
          onClick={() => setChatOpened(true)}
        >
          <Icon name="expand" />
        </button>
      </Show>
    </div>
  )
}