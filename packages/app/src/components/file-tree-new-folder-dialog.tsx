import { createSignal } from "solid-js"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"
import type { FileNode } from "@opencode-ai/sdk/v2"

export function FileTreeNewFolderDialog(props: { parent: FileNode; onSuccess?: (path: string) => void }) {
  const language = useLanguage()
  const sdk = useSDK()
  const dialog = useDialog()
  const [name, setName] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  const submit = async () => {
    const trimmed = name().trim()
    if (!trimmed || busy()) return
    setBusy(true)
    const target = props.parent.path ? `${props.parent.path}/${trimmed}` : trimmed
    try {
      const result = await sdk().client.file.mkdir({ directory: sdk().directory, path: target })
      if (result.error) {
        const error = result.error as { data?: { message?: string }; message?: string }
        showToast({ variant: "error", title: error.data?.message || error.message || language.t("common.requestFailed") })
        setBusy(false)
        return
      }
      props.onSuccess?.(target)
      dialog.close()
    } catch {
      showToast({ variant: "error", title: language.t("common.requestFailed") })
      setBusy(false)
    }
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("dialog.directory.newFolder")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="px-4 pb-1">
        <TextInputV2
          value={name()}
          autofocus
          autocomplete="off"
          class="!w-full"
          placeholder={language.t("dialog.directory.folderName")}
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
        <ButtonV2 variant="contrast" disabled={busy() || !name().trim()} onClick={() => void submit()}>
          {language.t("dialog.directory.createFolder")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
