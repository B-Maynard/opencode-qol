import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { getFilename } from "@opencode-ai/core/util/path"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Select } from "@opencode-ai/ui/select"
import { TextField } from "@opencode-ai/ui/text-field"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"

type Branch = { name: string; current: boolean }
const NEW_BRANCH_OPTION = "\0new-branch"

const showError = (fallback: string, error: unknown) => {
  const message =
    (error as { data?: { message?: string } })?.data?.message ?? fallback
  showToast({ variant: "error", title: message })
}

export function GitPanel(props: {
  files: () => { file: string }[]
  onSelectFile?: (path: string) => void
  staged: () => string[]
  onStage: (files: string[]) => void
  onUnstage: (files: string[]) => void
  onCommitSuccess?: () => void
  onPushSuccess?: () => void
}) {
  const language = useLanguage()
  const sdk = useSDK()
  const dialog = useDialog()
  const [branches, setBranches] = createSignal<Branch[]>([])
  const [message, setMessage] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  const refresh = async () => {
    const result = await sdk().client.vcs.branches()
    setBranches(result.data ?? [])
  }

  onMount(() => void refresh())

  const stagedSet = createMemo(() => new Set(props.staged()))
  const stagedCount = createMemo(() => props.files().filter((file) => stagedSet().has(file.file)).length)
  const unstagedCount = createMemo(() => props.files().length - stagedCount())
  const allStaged = createMemo(() => props.files().length > 0 && unstagedCount() === 0)
  const allUnstagedPaths = createMemo(() =>
    props.files().filter((file) => !stagedSet().has(file.file)).map((file) => file.file),
  )
  const allStagedPaths = () => props.staged()
  const stagedFiles = createMemo(() => props.files().filter((file) => stagedSet().has(file.file)))
  const unstagedFiles = createMemo(() => props.files().filter((file) => !stagedSet().has(file.file)))

  const checkout = async (name: string, create = false, base?: string) => {
    setBusy(true)
    try {
      await sdk().client.vcs.checkout({ branch: name, create, base })
      showToast({ variant: "success", title: language.t("session.git.switchBranch") })
      void refresh()
    } catch {
      showToast({ variant: "error", title: language.t("session.git.checkoutFailed") })
    } finally {
      setBusy(false)
    }
  }

  const createBranch = (name: string, base?: string) => {
    const current = branches().find((branch) => branch.current)?.name
    void checkout(name, true, base ?? current)
  }

  const branchOptions = createMemo<Branch[]>(() => [...branches(), { name: NEW_BRANCH_OPTION, current: false }])

  const commit = async () => {
    const text = message().trim()
    if (!text) return
    setBusy(true)
    try {
      await sdk().client.vcs.commit({ message: text })
      setMessage("")
      showToast({ variant: "success", title: language.t("session.git.committed") })
      props.onCommitSuccess?.()
    } catch (error) {
      showError(language.t("session.git.commitFailed"), error)
    } finally {
      setBusy(false)
    }
  }

  const push = async () => {
    setBusy(true)
    try {
      await sdk().client.vcs.push({})
      showToast({ variant: "success", title: language.t("session.git.pushed") })
      props.onPushSuccess?.()
    } catch (error) {
      showError(language.t("session.git.pushFailed"), error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-3 py-3">
      <div class="flex flex-col gap-1.5">
        <span class="text-12-regular text-text-weak">{language.t("session.git.currentBranch")}</span>
        <Show
          when={branches().length > 0}
          fallback={<span class="text-12-regular text-text-weak">{language.t("session.git.noBranches")}</span>}
        >
          <Select
            options={branchOptions()}
            value={(branch) => branch.name}
            label={(branch) =>
              branch.name === NEW_BRANCH_OPTION ? language.t("session.git.newBranchOption") : branch.name
            }
            current={branches().find((branch) => branch.current)}
            placeholder={language.t("session.git.switchBranch")}
            onSelect={(branch) => {
              if (!branch) return
              if (branch.name === NEW_BRANCH_OPTION) {
                dialog.show(() => <NewBranchDialog branches={branches} onCreate={createBranch} />)
                return
              }
              void checkout(branch.name)
            }}
            size="small"
          />
        </Show>
      </div>

      <Show when={stagedFiles().length > 0}>
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-12-regular text-text-weak">{language.t("session.git.stagedFiles")}</span>
            <Button
              size="small"
              variant="secondary"
              onClick={() => props.onUnstage(allStagedPaths())}
            >
              {language.t("session.git.unstageAll")}
            </Button>
          </div>
          <ul class="flex flex-col gap-0.5">
            <For each={stagedFiles()}>
              {(file) => (
                <li class="flex items-center gap-1">
                  <button
                    type="button"
                    class="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-12-regular text-text-strong hover:bg-surface-raised-base-hover disabled:cursor-default disabled:opacity-60"
                    disabled={!props.onSelectFile}
                    onClick={() => props.onSelectFile?.(file.file)}
                    title={file.file}
                  >
                    {getFilename(file.file)}
                  </button>
                  <Button
                    size="small"
                    variant="ghost"
                    icon="minus-small"
                    title={language.t("session.git.unstage")}
                    aria-label={language.t("session.git.unstage")}
                    onClick={() => props.onUnstage([file.file])}
                  />
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      <Show when={unstagedFiles().length > 0}>
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-12-regular text-text-weak">
              {language.t("session.review.filesChanged", { count: unstagedFiles().length })}
            </span>
            <Button
              size="small"
              variant="secondary"
              onClick={() => props.onStage(allUnstagedPaths())}
            >
              {language.t("session.git.stageAll")}
            </Button>
          </div>
          <ul class="flex flex-col gap-0.5">
            <For each={unstagedFiles()}>
              {(file) => (
                <li class="flex items-center gap-1">
                  <button
                    type="button"
                    class="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-12-regular text-text-strong hover:bg-surface-raised-base-hover disabled:cursor-default disabled:opacity-60"
                    disabled={!props.onSelectFile}
                    onClick={() => props.onSelectFile?.(file.file)}
                    title={file.file}
                  >
                    {getFilename(file.file)}
                  </button>
                  <Button
                    size="small"
                    variant="ghost"
                    icon="plus-small"
                    title={language.t("session.git.stage")}
                    aria-label={language.t("session.git.stage")}
                    onClick={() => props.onStage([file.file])}
                  />
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      <div class="flex flex-col gap-1.5">
        <TextField
          multiline
          value={message()}
          onChange={setMessage}
          placeholder={language.t("session.git.commitMessage")}
        />
        <div class="flex gap-1.5">
          <Button variant="primary" size="small" onClick={commit} disabled={busy() || !message().trim()}>
            {language.t("session.git.commit")}
          </Button>
          <Button variant="secondary" size="small" onClick={push} disabled={busy()}>
            {language.t("session.git.push")}
          </Button>
        </div>
      </div>
    </div>
  )
}

function NewBranchDialog(props: { branches: () => Branch[]; onCreate: (name: string, base?: string) => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const current = createMemo(() => props.branches().find((branch) => branch.current)?.name ?? "")
  const [name, setName] = createSignal("")
  const [base, setBase] = createSignal(current())

  const create = () => {
    const value = name().trim()
    if (!value) return
    props.onCreate(value, base() || undefined)
    dialog.close()
  }

  return (
    <Dialog title={language.t("session.git.newBranch")} transition class="w-80 max-w-[calc(100vw-32px)]">
      <div class="flex flex-col gap-4 p-4 pt-0">
        <div class="flex flex-col gap-1.5">
          <span class="text-12-regular text-text-weak">{language.t("session.git.branchName")}</span>
          <TextField
            value={name()}
            onChange={setName}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === "Enter") create()
            }}
            autofocus
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-12-regular text-text-weak">{language.t("session.git.createFrom")}</span>
          <Select
            options={props.branches()}
            value={(branch) => branch.name}
            label={(branch) => branch.name}
            current={props.branches().find((branch) => branch.name === base())}
            onSelect={(branch) => {
              if (branch) setBase(branch.name)
            }}
            size="small"
          />
        </div>
        <div class="flex justify-end gap-2 pt-1">
          <Button variant="primary" size="small" onClick={create} disabled={!name().trim()}>
            {language.t("session.git.createBranch")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
