import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { debounce } from "@solid-primitives/scheduled"
import { createQuery } from "@tanstack/solid-query"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"

type FindMatch = {
  path: { text: string }
  lines: { text: string }
  line_number: number
  submatches: Array<{ match: { text: string }; start: number; end: number }>
}

function renderLine(match: FindMatch) {
  const text = match.lines.text
  const parts: JSX.Element[] = []
  let cursor = 0
  for (const submatch of match.submatches) {
    if (submatch.start > cursor) parts.push(text.slice(cursor, submatch.start))
    parts.push(<mark class="bg-[color-mix(in_oklch,var(--v2-text-text-base)_20%,transparent)]">{text.slice(submatch.start, submatch.end)}</mark>)
    cursor = submatch.end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

export function SearchPanel(props: { onOpenFile: (path: string, line: number) => void }) {
  const language = useLanguage()
  const sdk = useSDK()
  const { workspaceKey } = useSessionLayout()
  const [query, setQuery] = createSignal("")
  const [debouncedQuery, setDebouncedQuery] = createSignal("")
  const updateDebounced = debounce((value: string) => setDebouncedQuery(value), 300)
  const pattern = createMemo(() => debouncedQuery().trim())
  const search = createQuery(() => {
    const value = pattern()
    return {
      queryKey: ["session-find-text", workspaceKey(), value] as const,
      enabled: value.length > 0,
      queryFn: () => sdk().client.find.text({ directory: sdk().directory, pattern: value }).then((x) => x.data),
    }
  })
  const groups = createMemo(() => {
    const matches = search.data ?? []
    const map = new Map<string, FindMatch[]>()
    for (const match of matches) {
      const path = match.path.text
      const list = map.get(path)
      if (list) list.push(match)
      else map.set(path, [match])
    }
    return [...map.entries()]
  })

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="shrink-0 p-2">
        <TextInputV2
          class="!w-full"
          type="search"
          value={query()}
          onInput={(event) => {
            setQuery(event.currentTarget.value)
            updateDebounced(event.currentTarget.value)
          }}
          placeholder={language.t("session.ide.search.placeholder")}
          aria-label={language.t("session.ide.search")}
          showClearButton={query().length > 0}
          clearLabel={language.t("common.clear")}
          onClearClick={() => {
            setQuery("")
            setDebouncedQuery("")
          }}
          leadingIcon={<Icon name="magnifying-glass" />}
        />
      </div>
      <div class="min-h-0 flex-1 overflow-auto">
        <Show
          when={pattern()}
          fallback={
            <div class="px-3 py-2 text-12-regular text-text-weak">{language.t("session.ide.search.noQuery")}</div>
          }
        >
          <Show
            when={!search.isPending}
            fallback={
              <div class="px-3 py-2 text-12-regular text-text-weak">
                {language.t("common.loading")}
                {language.t("common.loading.ellipsis")}
              </div>
            }
          >
            <Show
              when={groups().length > 0}
              fallback={
                <div class="px-3 py-2 text-12-regular text-text-weak">{language.t("session.ide.search.empty")}</div>
              }
            >
              <div class="px-3 py-2 text-11-regular text-text-faint">
                {language.t("session.ide.search.results")} ({search.data?.length ?? 0})
              </div>
              <For each={groups()}>
                {([path, matches]) => (
                  <div class="mb-2">
                    <div class="px-3 py-1 text-12-medium text-text-muted truncate" title={path}>
                      {path}
                    </div>
                    <For each={matches}>
                      {(match) => (
                        <button
                          type="button"
                          class="flex w-full items-start gap-2 px-3 py-1 text-start hover:bg-surface-base"
                          onClick={() => props.onOpenFile(path, match.line_number)}
                        >
                          <span class="shrink-0 text-11-regular text-text-faint tabular-nums">{match.line_number}</span>
                          <span class="min-w-0 flex-1 truncate font-mono text-12-regular text-text-base">
                            {renderLine(match)}
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  )
}