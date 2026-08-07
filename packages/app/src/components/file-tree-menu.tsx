import { Show } from "solid-js"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"
import type { FileNode } from "@opencode-ai/sdk/v2"
import { FileTreeDeleteDialog } from "./file-tree-delete-dialog"
import { FileTreeRenameDialog } from "./file-tree-rename-dialog"
import { FileTreeNewFolderDialog } from "./file-tree-new-folder-dialog"

export function FileTreeMenuItems(props: { node: FileNode }) {
  const language = useLanguage()
  const sdk = useSDK()
  const dialog = useDialog()

  const handleCopy = () => {
    void navigator.clipboard.writeText(props.node.absolute).then(
      () => showToast({ variant: "success", title: language.t("common.copied") }),
      () => showToast({ variant: "error", title: language.t("common.requestFailed") }),
    )
  }

  return (
    <>
      <Show when={props.node.type === "directory"}>
        <MenuV2.Item onSelect={() => dialog.show(() => <FileTreeNewFolderDialog parent={props.node} />)}>
          {language.t("dialog.directory.newFolder")}
        </MenuV2.Item>
      </Show>
      <MenuV2.Item onSelect={() => dialog.show(() => <FileTreeRenameDialog node={props.node} />)}>
        {language.t("common.rename")}
      </MenuV2.Item>
      <MenuV2.Item onSelect={() => dialog.show(() => <FileTreeDeleteDialog node={props.node} />)}>
        {language.t("common.delete")}
      </MenuV2.Item>
      <MenuV2.Separator />
      <MenuV2.Item onSelect={handleCopy}>{language.t("common.copy")}</MenuV2.Item>
    </>
  )
}
