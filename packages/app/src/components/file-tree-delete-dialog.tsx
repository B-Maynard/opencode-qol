import { createSignal } from "solid-js"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"
import { formatServerError } from "@/utils/server-errors"
import type { FileNode } from "@opencode-ai/sdk/v2"

export function FileTreeDeleteDialog(props: { node: FileNode; onSuccess?: () => void }) {
  const language = useLanguage()
  const sdk = useSDK()
  const dialog = useDialog()
  const [busy, setBusy] = createSignal(false)

  const handleDelete = async () => {
    if (busy()) return
    setBusy(true)
    try {
      await sdk().client.file.remove({ directory: sdk().directory, path: props.node.path })
      props.onSuccess?.()
      dialog.close()
    } catch (err) {
      showToast({ variant: "error", title: language.t("fileTree.delete.failed"), description: formatServerError(err, language.t) })
      setBusy(false)
    }
  }

  const isDir = props.node.type === "directory"

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("fileTree.delete.title", { name: props.node.name })}
          description={language.t(
            isDir ? "fileTree.delete.folderDescription" : "fileTree.delete.description",
            { name: props.node.name },
          )}
        />
      </DialogHeader>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()} disabled={busy()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="danger" disabled={busy()} onClick={() => void handleDelete()}>
          {language.t("common.delete")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
