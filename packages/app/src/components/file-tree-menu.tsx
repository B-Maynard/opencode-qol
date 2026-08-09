import { Show } from "solid-js"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { SDKProvider, useSDK } from "@/context/sdk"
import type { FileNode } from "@opencode-ai/sdk/v2"
import { FileTreeDeleteDialog } from "./file-tree-delete-dialog"
import { FileTreeRenameDialog } from "./file-tree-rename-dialog"
import { FileTreeNewFolderDialog } from "./file-tree-new-folder-dialog"

export type FileTreeMutation = { type: "add" | "remove" | "move"; path: string; newPath?: string }

export function FileTreeMenuItems(props: { node: FileNode; onMutation?: (mutation: FileTreeMutation) => void }) {
  const language = useLanguage()
  const sdk = useSDK()
  const dialog = useDialog()

  return (
    <>
      <Show when={props.node.type === "directory"}>
        <MenuV2.Item
          onSelect={() =>
            dialog.push(() => (
              <SDKProvider directory={sdk().directory}>
                <FileTreeNewFolderDialog
                  parent={props.node}
                  onSuccess={(path) => props.onMutation?.({ type: "add", path })}
                />
              </SDKProvider>
            ))
          }
        >
          {language.t("dialog.directory.newFolder")}
        </MenuV2.Item>
      </Show>
      <MenuV2.Item
        onSelect={() =>
          dialog.push(() => (
            <SDKProvider directory={sdk().directory}>
              <FileTreeRenameDialog
                node={props.node}
                onSuccess={(newPath) => props.onMutation?.({ type: "move", path: props.node.path, newPath })}
              />
            </SDKProvider>
          ))
        }
      >
        {language.t("common.rename")}
      </MenuV2.Item>
      <MenuV2.Item
        onSelect={() =>
          dialog.push(() => (
            <SDKProvider directory={sdk().directory}>
              <FileTreeDeleteDialog
                node={props.node}
                onSuccess={() => props.onMutation?.({ type: "remove", path: props.node.path })}
              />
            </SDKProvider>
          ))
        }
      >
        {language.t("common.delete")}
      </MenuV2.Item>
    </>
  )
}
