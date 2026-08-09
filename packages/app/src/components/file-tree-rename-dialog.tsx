import { createSignal } from "solid-js"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"
import { formatServerError } from "@/utils/server-errors"
import type { FileNode } from "@opencode-ai/sdk/v2"

export function FileTreeRenameDialog(props: { node: FileNode; onSuccess?: (newPath: string) => void }) {
  const language = useLanguage()
  const sdk = useSDK()
  const dialog = useDialog()
  const [name, setName] = createSignal(props.node.name)
  const [busy, setBusy] = createSignal(false)

  const submit = async () => {
    const trimmed = name().trim()
    if (!trimmed || trimmed === props.node.name || busy()) return
    setBusy(true)
    try {
      await sdk().client.file.rename({ directory: sdk().directory, path: props.node.path, newName: trimmed })
      // v2 file tree uses "/" as separator for all paths (virtual tree, not FS).
      const separator = props.node.path.lastIndexOf("/")
      const parent = separator === -1 ? "" : props.node.path.slice(0, separator + 1)
      const trailing = props.node.path.endsWith("/") ? "/" : ""
      props.onSuccess?.(`${parent}${trimmed}${trailing}`)
      dialog.close()
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("fileTree.rename.failed"),
        description: formatServerError(err, language.t),
      })
      setBusy(false)
    }
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("common.rename")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="px-4 pb-1">
        <TextInputV2
          value={name()}
          autofocus
          autocomplete="off"
          class="!w-full"
          onInput={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit()
            if (e.key === "Escape") dialog.close()
          }}
        />
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()} disabled={busy()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={busy() || name().trim() === props.node.name} onClick={() => void submit()}>
          {language.t("common.save")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
