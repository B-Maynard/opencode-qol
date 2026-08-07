import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"
import type { FileNode } from "@opencode-ai/sdk/v2"

export function FileTreeDeleteDialog(props: { node: FileNode }) {
  const language = useLanguage()
  const sdk = useSDK()
  const dialog = useDialog()

  const handleDelete = async () => {
    try {
      const result = await sdk().client.file.remove({ directory: sdk().directory, path: props.node.path })
      if (result.error) {
        const error = result.error as { data?: { message?: string }; message?: string }
        showToast({ variant: "error", title: language.t("fileTree.delete.failed"), description: error.data?.message || error.message })
        return
      }
      dialog.close()
    } catch {
      showToast({ variant: "error", title: language.t("fileTree.delete.failed") })
    }
  }

  const isDir = props.node.type === "directory"

  return (
    <Dialog>
      <DialogHeader>
        <DialogTitle>{language.t("fileTree.delete.title", { name: props.node.name })}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <p class="text-sm text-v2-text-text-muted">
          {language.t(
            isDir ? "fileTree.delete.folderDescription" : "fileTree.delete.description",
            { name: props.node.name },
          )}
        </p>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="danger" onClick={() => void handleDelete()}>
          {language.t("common.delete")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
