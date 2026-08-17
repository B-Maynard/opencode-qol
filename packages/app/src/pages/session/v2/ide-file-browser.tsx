import { createMemo, createSignal, createUniqueId, Show } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import FileTreeV2, { type Kind } from "@/components/file-tree-v2"
import { applyFileListKeyDown, SessionFileListV2 } from "@/pages/session/v2/session-file-list-v2"

const emptyFiles: string[] = []

// File-name search model shared by the Code tab sidebar and the IDE Files panel.
export function createIdeFileSearch(input: {
  workspaceKey: () => string
  onSelectPermanent: (path: string) => void
}) {
  const file = useFile()
  const resultsID = `ide-file-browser-results-${createUniqueId()}`
  const [filter, setFilter] = createSignal("")
  const [explicitHighlight, setExplicitHighlight] = createSignal<string>()
  const query = createMemo(() => filter().trim())
  const search = createQuery(() => {
    const value = query()
    return {
      queryKey: ["session-open-file", input.workspaceKey(), value] as const,
      enabled: value.length > 0,
      queryFn: ({ signal }) => file.searchFiles(value, { limit: 200, signal }),
    }
  })
  const files = createMemo(() => {
    if (!query() || search.isPending) return emptyFiles
    return [...new Set(search.data ?? emptyFiles)]
  })
  const highlighted = createMemo(() => {
    const values = files()
    if (values.length === 0) return undefined
    const explicit = explicitHighlight()
    if (explicit && values.includes(explicit)) return explicit
    return values[0]
  })
  const loading = createMemo(() => query().length > 0 && search.isPending)
  const optionID = (path: string) => `${resultsID}-option-${files().indexOf(path)}`

  const onFilterKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "Escape" && query()) {
      event.preventDefault()
      setFilter("")
      return
    }
    if (!query()) return
    applyFileListKeyDown(event, files(), highlighted(), {
      onHighlight: setExplicitHighlight,
      onSelect: input.onSelectPermanent,
    })
  }

  return {
    resultsID,
    filter,
    setFilter,
    query,
    files,
    highlighted,
    loading,
    optionID,
    onFilterKeyDown,
    setExplicitHighlight,
  }
}

// Files panel content: full tree when idle, flat search results while filtering.
export function IdeFileBrowserFiles(props: {
  query: () => string
  loading: () => boolean
  files: () => string[]
  highlighted: () => string | undefined
  optionID: (path: string) => string
  resultsID: string
  active?: string
  kinds: ReadonlyMap<string, Kind>
  onSelect: (path: string) => void
  onSelectPermanent: (path: string) => void
  onHighlight?: (path: string) => void
}) {
  const language = useLanguage()
  return (
    <Show
      when={props.query()}
      fallback={
        <FileTreeV2
          active={props.active}
          kinds={props.kinds}
          onFileClick={(node) => props.onSelect(node.path)}
          onFileDoubleClick={(node) => props.onSelectPermanent(node.path)}
        />
      }
    >
      <Show
        when={!props.loading()}
        fallback={
          <div role="status" class="px-2 py-2 text-12-regular text-text-weak">
            {language.t("common.loading")}
            {language.t("common.loading.ellipsis")}
          </div>
        }
      >
        <Show
          when={props.files().length > 0}
          fallback={
            <div role="status" class="px-2 py-2 text-12-regular text-text-weak">
              {language.t("palette.empty")}
            </div>
          }
        >
          <SessionFileListV2
            id={props.resultsID}
            role="listbox"
            optionID={props.optionID}
            files={props.files()}
            kinds={props.kinds}
            active={props.active}
            highlighted={props.highlighted()}
            onFileClick={(path) => {
              props.onHighlight?.(path)
              props.onSelect(path)
            }}
            onFileDoubleClick={props.onSelectPermanent}
          />
        </Show>
      </Show>
    </Show>
  )
}