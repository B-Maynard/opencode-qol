import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { type Component, For, Show, batch, createEffect, createMemo, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import "./settings-v2.css"

type AgentFile = {
  path: string
  name: string
  kind: "agent" | "mode"
  content: string
}

export const SettingsAgentsV2: Component = () => {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSdk = useServerSDK()
  const [resource, { mutate, refetch }] = createResource(() =>
    serverSdk().client.config.agents({}, { throwOnError: true }),
  )
  const entries = createMemo(() => resource()?.data)
  const [store, setStore] = createStore<{
    selected?: string
    content: string
    loaded: string
    saving: boolean
  }>({ content: "", loaded: "", saving: false })

  const selected = createMemo(() => entries()?.find((entry) => entry.path === store.selected))

  const dirty = createMemo(() => store.selected !== undefined && store.content !== store.loaded)

  // Auto-select the first agent once the list loads so the editor is usable immediately.
  createEffect(() => {
    const first = entries()?.find((entry) => entry.kind === "agent") ?? entries()?.[0]
    if (store.selected === undefined && first) applySelection(first)
  })

  const applySelection = (entry: AgentFile) => {
    batch(() => {
      setStore("selected", entry.path)
      setStore("content", entry.content)
      setStore("loaded", entry.content)
    })
  }

  const select = (entry: AgentFile) => {
    if (entry.path === store.selected) return
    if (dirty()) {
      dialog.push(() => <DiscardDialog onDiscard={() => applySelection(entry)} />)
      return
    }
    applySelection(entry)
  }

  const save = async () => {
    const path = store.selected
    if (path === undefined || !dirty()) return
    setStore("saving", true)
    try {
      await serverSdk().client.config.updateAgents(
        { updateAgentFile: { path, content: store.content } },
        { throwOnError: true },
      )
      batch(() => {
        setStore("loaded", store.content)
        setStore("saving", false)
        mutate((prev) =>
          prev ? { ...prev, data: prev.data.map((entry) => (entry.path === path ? { ...entry, content: store.content } : entry)) } : prev,
        )
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.agents.saved.title"),
        description: language.t("settings.agents.saved.description"),
      })
    } catch (err) {
      setStore("saving", false)
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    }
  }

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-agents-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.tab.agents")}</h2>
        <ButtonV2 size="normal" variant="contrast" disabled={!dirty() || store.saving} onClick={() => void save()}>
          {language.t("common.save")}
        </ButtonV2>
      </div>

      <div class="settings-v2-tab-body settings-v2-agents">
        <Show
          when={!resource.loading}
          fallback={
            <div class="settings-v2-agents-status">
              <span>{language.t("common.loading")}</span>
              <span>{language.t("common.loading.ellipsis")}</span>
            </div>
          }
        >
          <Show
            when={selected()}
            fallback={
              <div class="settings-v2-agents-status">
                <span>{resource.error ? language.t("common.requestFailed") : language.t("settings.agents.empty")}</span>
                <Show when={resource.error}>
                  <ButtonV2 size="small" variant="ghost-muted" onClick={() => refetch()}>
                    {language.t("settings.agents.reload")}
                  </ButtonV2>
                </Show>
              </div>
            }
          >
            <div class="settings-v2-agents-list">
              <For each={entries()}>
                {(entry) => {
                  const isSelected = () => entry.path === store.selected
                  return (
                    <button
                      type="button"
                      class="settings-v2-agents-row"
                      classList={{ "settings-v2-agents-row--active": isSelected() }}
                      data-selected={isSelected() ? "" : undefined}
                      onClick={() => select(entry)}
                    >
                      <span class="settings-v2-agents-row-name">
                        {entry.name}
                        <Show when={entry.kind === "mode"}>
                          <Tag>{language.t("settings.agents.kind.mode")}</Tag>
                        </Show>
                        <Show when={isSelected() && dirty()}>
                          <span class="settings-v2-agents-row-dirty" aria-label={language.t("fileEditor.unsaved")} />
                        </Show>
                      </span>
                    </button>
                  )
                }}
              </For>
            </div>

            <div class="settings-v2-agents-editor">
              <Show when={selected()}>
                {(entry) => (
                  <>
                    <div class="settings-v2-agents-editor-title">
                      <span class="truncate">{entry().name}</span>
                      <Show when={entry().kind === "mode"}>
                        <Tag>{language.t("settings.agents.kind.mode")}</Tag>
                      </Show>
                    </div>
                    <TextareaV2
                      class="settings-v2-agents-editor-area"
                      value={store.content}
                      spellcheck={false}
                      disabled={store.saving}
                      aria-label={entry().name}
                      onInput={(event) => setStore("content", event.currentTarget.value)}
                      style={{ "font-family": "var(--v2-font-family-mono)" }}
                    />
                  </>
                )}
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </>
  )
}

const DiscardDialog: Component<{ onDiscard: () => void }> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("settings.agents.unsaved.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody>
        <p class="settings-v2-agents-unsaved-copy">{language.t("settings.agents.unsaved.description")}</p>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2
          variant="danger"
          onClick={() => {
            dialog.close()
            props.onDiscard()
          }}
        >
          {language.t("settings.agents.unsaved.discard")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}