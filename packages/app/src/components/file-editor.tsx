import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { basicSetup } from "codemirror"
import { EditorState, type Extension } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { oneDark } from "@codemirror/theme-one-dark"
import { javascript } from "@codemirror/lang-javascript"
import { html } from "@codemirror/lang-html"
import { css } from "@codemirror/lang-css"
import { python } from "@codemirror/lang-python"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"

const languageFor = (path: string): Extension => {
  const ext = path.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "ts":
    case "tsx":
      return javascript({ typescript: true })
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return javascript()
    case "html":
    case "htm":
      return html()
    case "css":
    case "scss":
    case "less":
      return css()
    case "py":
      return python()
    case "json":
      return json()
    case "md":
    case "markdown":
      return markdown()
    default:
      return []
  }
}

export function FileEditor(props: { path: string }) {
  const language = useLanguage()
  const sdk = useSDK()
  const [dirty, setDirty] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string>()
  let view: EditorView | undefined
  let host: HTMLDivElement | undefined

  const save = async () => {
    if (!view || !dirty()) return
    setSaving(true)
    try {
      await sdk().client.file.write({ path: props.path, content: view.state.doc.toString() })
      setDirty(false)
      showToast({ variant: "success", title: language.t("fileEditor.saved") })
    } catch {
      showToast({ variant: "error", title: language.t("fileEditor.saveFailed") })
    } finally {
      setSaving(false)
    }
  }

  const revert = async () => {
    if (!view) return
    const result = await sdk().client.file.read({ path: props.path })
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result.data?.content ?? "" } })
    setDirty(false)
  }

  onMount(() => {
    void sdk()
      .client.file.read({ path: props.path })
      .then((result) => {
        const state = EditorState.create({
          doc: result.data?.content ?? "",
          extensions: [
            basicSetup,
            oneDark,
            EditorView.lineWrapping,
            EditorView.theme({
              "&": { height: "100%", fontSize: "13px" },
              ".cm-scroller": {
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
              },
            }),
            languageFor(props.path),
            keymap.of([
              {
                key: "Mod-s",
                run: () => {
                  void save()
                  return true
                },
              },
            ]),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) setDirty(true)
            }),
          ],
        })
        view = new EditorView({ state, parent: host! })
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  })

  onCleanup(() => view?.destroy())

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex shrink-0 items-center gap-1.5 px-2 py-1">
        <Button size="small" variant="primary" onClick={save} disabled={saving() || !dirty()}>
          {language.t("common.save")}
        </Button>
        <Button size="small" variant="ghost" onClick={revert} disabled={saving() || !dirty()}>
          {language.t("fileEditor.revert")}
        </Button>
        <Show when={dirty()}>
          <span class="size-2 rounded-full bg-icon-strong" aria-label={language.t("fileEditor.unsaved")} />
        </Show>
      </div>
      <Show when={error()} fallback={<div ref={host} class="min-h-0 flex-1 overflow-hidden" />}>
        <div class="px-4 py-3 text-13-regular text-text-weak">{error()}</div>
      </Show>
    </div>
  )
}
