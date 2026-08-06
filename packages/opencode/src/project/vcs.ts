import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context, Schema, Scope } from "effect"
import { formatPatch, structuredPatch } from "diff"
import { InstanceState } from "@/effect/instance-state"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Git } from "@/git"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { VcsEvent } from "@opencode-ai/schema/vcs-event"

const PATCH_CONTEXT_LINES = 2_147_483_647
const MAX_PATCH_BYTES = 10_000_000
const MAX_TOTAL_PATCH_BYTES = 10_000_000
type DiffOptions = {
  readonly context?: number
}

const emptyPatch = (file: string) => formatPatch(structuredPatch(file, file, "", "", "", "", { context: 0 }))

const nums = (list: Git.Stat[]) =>
  new Map(list.map((item) => [item.file, { additions: item.additions, deletions: item.deletions }] as const))

const merge = (...lists: Git.Item[][]) => {
  const out = new Map<string, Git.Item>()
  lists.flat().forEach((item) => {
    if (!out.has(item.file)) out.set(item.file, item)
  })
  return [...out.values()]
}

const emptyBatch = () => ({ patches: new Map<string, string>(), capped: false })

const parseQuotedPath = (value: string) => {
  let out = ""
  for (let idx = 1; idx < value.length; idx++) {
    const char = value[idx]
    if (char === '"') return { value: out, end: idx + 1 }
    if (char !== "\\") {
      out += char
      continue
    }

    const next = value[++idx]
    if (next === "t") out += "\t"
    else if (next === "n") out += "\n"
    else if (next === "r") out += "\r"
    else if (next === '"' || next === "\\") out += next
    else out += next ?? ""
  }
}

const parsePathToken = (value: string) => {
  if (!value.startsWith('"')) return value.split("\t")[0]
  return parseQuotedPath(value)?.value ?? value
}

const fileFromDiffPath = (value: string | undefined) => {
  if (!value || value === "/dev/null") return
  const file = parsePathToken(value)
  if (file.startsWith("a/") || file.startsWith("b/")) return file.slice(2)
  return file
}

const fileFromGitHeader = (header: string) => {
  if (header.startsWith('"')) {
    const first = parseQuotedPath(header)
    const second = first ? header.slice(first.end).trimStart() : undefined
    if (!second) return
    if (!second.startsWith('"')) return fileFromDiffPath(second)
    return fileFromDiffPath(parseQuotedPath(second)?.value)
  }

  const separator = header.indexOf(" b/")
  if (separator === -1) return
  return fileFromDiffPath(header.slice(separator + 1))
}

const fileFromPatchChunk = (chunk: string) => {
  const next = /^\+\+\+ (.+)$/m.exec(chunk)?.[1]
  const before = /^--- (.+)$/m.exec(chunk)?.[1]
  const file = fileFromDiffPath(next) ?? fileFromDiffPath(before)
  if (file) return file

  const header = /^diff --git (.+)$/m.exec(chunk)?.[1]
  return fileFromGitHeader(header ?? "")
}

const splitGitPatch = (patch: Git.Patch) => {
  const starts = [...patch.text.matchAll(/(?:^|\n)diff --git /g)].map((match) =>
    match[0].startsWith("\n") ? match.index + 1 : match.index,
  )
  const chunks = starts.map((start, index) => patch.text.slice(start, starts[index + 1] ?? patch.text.length))
  if (!patch.truncated) return chunks
  return chunks.slice(0, -1)
}

const batchPatches = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string,
  list: Git.Item[],
  options?: DiffOptions,
) {
  if (list.length === 0) return { patches: new Map<string, string>(), capped: false }

  const result = yield* git.patchAll(cwd, ref, {
    context: options?.context ?? PATCH_CONTEXT_LINES,
    maxOutputBytes: MAX_TOTAL_PATCH_BYTES,
  })

  return {
    patches: splitGitPatch(result).reduce((acc, patch, index) => {
      const file = fileFromPatchChunk(patch) ?? list[index]?.file
      if (!file) return acc
      acc.set(file, (acc.get(file) ?? "") + patch)
      return acc
    }, new Map<string, string>()),
    capped: result.truncated,
  }
})

const nativePatch = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string | undefined,
  item: Git.Item,
  options?: DiffOptions,
) {
  const result =
    item.code === "??" || !ref
      ? yield* git.patchUntracked(cwd, item.file, {
          context: options?.context ?? PATCH_CONTEXT_LINES,
          maxOutputBytes: MAX_PATCH_BYTES,
        })
      : yield* git.patch(cwd, ref, item.file, {
          context: options?.context ?? PATCH_CONTEXT_LINES,
          maxOutputBytes: MAX_PATCH_BYTES,
        })
  if (!result.truncated && result.text) return result.text

  return emptyPatch(item.file)
})

const totalPatch = (file: string, patch: string, total: number) => {
  if (total + Buffer.byteLength(patch) <= MAX_TOTAL_PATCH_BYTES) return { patch, capped: false }
  return { patch: emptyPatch(file), capped: true }
}

const patchForItem = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string | undefined,
  item: Git.Item,
  batch: { patches: Map<string, string>; capped: boolean },
  capped: boolean,
  options?: DiffOptions,
) {
  if (capped) return emptyPatch(item.file)

  const batched = batch.patches.get(item.file)
  if (batched !== undefined) return batched
  if (item.code !== "??" && batch.capped) return emptyPatch(item.file)
  return yield* nativePatch(git, cwd, ref, item, options)
})

const files = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string | undefined,
  list: Git.Item[],
  map: Map<string, { additions: number; deletions: number }>,
  batch: { patches: Map<string, string>; capped: boolean },
  options?: DiffOptions,
) {
  const next: FileDiff[] = []
  let total = 0
  let capped = false

  for (const item of list.toSorted((a, b) => a.file.localeCompare(b.file))) {
    const stat = map.get(item.file) ?? (item.status === "added" ? yield* git.statUntracked(cwd, item.file) : undefined)
    const patch = yield* patchForItem(git, cwd, ref, item, batch, capped, options)
    const result: { patch: string; capped: boolean } = capped
      ? { patch, capped: true }
      : totalPatch(item.file, patch, total)
    capped = capped || result.capped
    if (!capped) {
      total += Buffer.byteLength(result.patch)
      capped = total >= MAX_TOTAL_PATCH_BYTES
    }
    next.push({
      file: item.file,
      patch: result.patch,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
      status: item.status,
    })
  }

  return next
})

const diffAgainstRef = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string,
  options?: DiffOptions,
) {
  const [list, stats, extra] = yield* Effect.all([git.diff(cwd, ref), git.stats(cwd, ref), git.status(cwd)], {
    concurrency: 3,
  })
  return yield* files(
    git,
    cwd,
    ref,
    merge(
      list,
      extra.filter((item) => item.code === "??"),
    ),
    nums(stats),
    yield* batchPatches(git, cwd, ref, list, options),
    options,
  )
})

const track = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  ref: string | undefined,
  options?: DiffOptions,
) {
  if (!ref) return yield* files(git, cwd, ref, yield* git.status(cwd), new Map(), emptyBatch(), options)
  return yield* diffAgainstRef(git, cwd, ref, options)
})

export const Mode = Schema.Literals(["git", "branch"])
export type Mode = Schema.Schema.Type<typeof Mode>

export const Event = VcsEvent

export const Info = Schema.Struct({
  branch: Schema.optional(Schema.String),
  default_branch: Schema.optional(Schema.String),
}).annotate({ identifier: "VcsInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export const FileDiff = Schema.Struct({
  file: Schema.String,
  // Mirrors Snapshot.FileDiff (see #26574). The current producer always
  // populates patch, but loosening matches the sibling schema so a
  // future code path that omits it can't crash /instance/vcs/diff.
  patch: Schema.optional(Schema.String),
  additions: Schema.Finite,
  deletions: Schema.Finite,
  status: Schema.optional(Schema.Literals(["added", "deleted", "modified"])),
}).annotate({ identifier: "VcsFileDiff" })
export type FileDiff = Schema.Schema.Type<typeof FileDiff>

export const FileStatus = Schema.Struct({
  file: Schema.String,
  additions: Schema.Finite,
  deletions: Schema.Finite,
  status: Schema.Literals(["added", "deleted", "modified"]),
}).annotate({ identifier: "VcsFileStatus" })
export type FileStatus = Schema.Schema.Type<typeof FileStatus>

export const ApplyInput = Schema.Struct({
  patch: Schema.String,
})
export type ApplyInput = Schema.Schema.Type<typeof ApplyInput>

export const ApplyResult = Schema.Struct({
  applied: Schema.Boolean,
})
export type ApplyResult = Schema.Schema.Type<typeof ApplyResult>

export class PatchApplyError extends Schema.TaggedErrorClass<PatchApplyError>()("VcsPatchApplyError", {
  message: Schema.String,
  reason: Schema.Literals(["non-git", "not-clean"]),
}) {}

export const CommitInput = Schema.Struct({
  message: Schema.String,
  files: Schema.optional(Schema.Array(Schema.String)),
})
export type CommitInput = Schema.Schema.Type<typeof CommitInput>

export const CommitResult = Schema.Struct({
  committed: Schema.Boolean,
})
export type CommitResult = Schema.Schema.Type<typeof CommitResult>

export class CommitError extends Schema.TaggedErrorClass<CommitError>()("VcsCommitError", {
  message: Schema.String,
  reason: Schema.Literals(["non-git", "nothing-to-commit"]),
}) {}

export const StageInput = Schema.Struct({
  files: Schema.optional(Schema.Array(Schema.String)),
})
export type StageInput = Schema.Schema.Type<typeof StageInput>

export const UnstageInput = StageInput
export type UnstageInput = Schema.Schema.Type<typeof UnstageInput>

export const StageResult = Schema.Struct({
  files: Schema.Array(Schema.String),
})
export type StageResult = Schema.Schema.Type<typeof StageResult>

export const UnstageResult = StageResult
export type UnstageResult = Schema.Schema.Type<typeof UnstageResult>

export class VcsStageError extends Schema.TaggedErrorClass<VcsStageError>()("VcsStageError", {
  message: Schema.String,
}) {}

export class VcsUnstageError extends Schema.TaggedErrorClass<VcsUnstageError>()("VcsUnstageError", {
  message: Schema.String,
}) {}

export const PushInput = Schema.Struct({
  remote: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
})
export type PushInput = Schema.Schema.Type<typeof PushInput>

export const PushResult = Schema.Struct({
  pushed: Schema.Boolean,
})
export type PushResult = Schema.Schema.Type<typeof PushResult>

export class PushError extends Schema.TaggedErrorClass<PushError>()("VcsPushError", {
  message: Schema.String,
  reason: Schema.Literals(["non-git", "push-failed"]),
}) {}

export const CheckoutInput = Schema.Struct({
  branch: Schema.String,
  create: Schema.optional(Schema.Boolean),
  base: Schema.optional(Schema.String),
})
export type CheckoutInput = Schema.Schema.Type<typeof CheckoutInput>

export class CheckoutError extends Schema.TaggedErrorClass<CheckoutError>()("VcsCheckoutError", {
  message: Schema.String,
  reason: Schema.Literals(["non-git", "checkout-failed", "branch-exists"]),
}) {}

export const BranchInfo = Schema.Struct({
  name: Schema.String,
  current: Schema.Boolean,
  remote: Schema.optional(Schema.String),
}).annotate({ identifier: "VcsBranchInfo" })
export type BranchInfo = Schema.Schema.Type<typeof BranchInfo>

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly branch: () => Effect.Effect<string | undefined>
  readonly defaultBranch: () => Effect.Effect<string | undefined>
  readonly status: () => Effect.Effect<FileStatus[]>
  readonly diff: (mode: Mode, options?: DiffOptions) => Effect.Effect<FileDiff[]>
  readonly diffRaw: () => Effect.Effect<string>
  readonly apply: (input: ApplyInput) => Effect.Effect<ApplyResult, PatchApplyError>
  readonly commit: (input: CommitInput) => Effect.Effect<CommitResult, CommitError>
  readonly stage: (input: StageInput) => Effect.Effect<StageResult, VcsStageError>
  readonly unstage: (input: UnstageInput) => Effect.Effect<UnstageResult, VcsUnstageError>
  readonly staged: () => Effect.Effect<string[]>
  readonly push: (input: PushInput) => Effect.Effect<PushResult, PushError>
  readonly branches: () => Effect.Effect<BranchInfo[]>
  readonly checkout: (input: CheckoutInput) => Effect.Effect<Info, CheckoutError>
}

interface State {
  current: string | undefined
  root: Git.Base | undefined
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Vcs") {}

const layer: Layer.Layer<Service, never, Git.Service | EventV2Bridge.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const git = yield* Git.Service
    const events = yield* EventV2Bridge.Service
    const scope = yield* Scope.Scope

    const state = yield* InstanceState.make<State>(
      Effect.fn("Vcs.state")(function* (ctx) {
        if (ctx.project.vcs !== "git") {
          return { current: undefined, root: undefined }
        }

        const get = Effect.fnUntraced(function* () {
          return yield* git.branch(ctx.directory)
        })
        const [current, root] = yield* Effect.all([git.branch(ctx.directory), git.defaultBranch(ctx.directory)], {
          concurrency: 2,
        })
        const value = { current, root }

        const unsubscribe = yield* events.listen((event) => {
          if (event.type !== Watcher.Event.Updated.type || event.location?.directory !== ctx.directory)
            return Effect.void
          const data = event.data as EventV2.Data<typeof Watcher.Event.Updated>
          if (!data.file.endsWith("HEAD")) return Effect.void
          return Effect.gen(function* () {
            const next = yield* get()
            if (next !== value.current) {
              value.current = next
              yield* events.publish(Event.BranchUpdated, { branch: next })
            }
          })
        })
        yield* Effect.addFinalizer(() => unsubscribe)

        return value
      }),
    )

    return Service.of({
      init: Effect.fn("Vcs.init")(function* () {
        yield* InstanceState.get(state).pipe(Effect.forkIn(scope))
      }),
      branch: Effect.fn("Vcs.branch")(function* () {
        return yield* InstanceState.use(state, (x) => x.current)
      }),
      defaultBranch: Effect.fn("Vcs.defaultBranch")(function* () {
        return yield* InstanceState.use(state, (x) => x.root?.name)
      }),
      status: Effect.fn("Vcs.status")(function* () {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return []
        const ref = (yield* git.hasHead(ctx.directory)) ? "HEAD" : undefined
        const [list, stats] = yield* Effect.all(
          [git.status(ctx.directory), ref ? git.stats(ctx.directory, ref) : Effect.succeed([])],
          { concurrency: 2 },
        )
        const map = nums(stats)
        return yield* Effect.forEach(
          list.toSorted((a, b) => a.file.localeCompare(b.file)),
          (item) =>
            Effect.gen(function* () {
              const stat =
                map.get(item.file) ??
                (item.status === "added" ? yield* git.statUntracked(ctx.worktree, item.file) : undefined)
              return {
                file: item.file,
                additions: stat?.additions ?? 0,
                deletions: stat?.deletions ?? 0,
                status: item.status,
              } satisfies FileStatus
            }),
        )
      }),
      diff: Effect.fn("Vcs.diff")(function* (mode: Mode, options?: DiffOptions) {
        const value = yield* InstanceState.get(state)
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return []
        if (mode === "git") {
          return yield* track(git, ctx.directory, (yield* git.hasHead(ctx.directory)) ? "HEAD" : undefined, options)
        }

        if (!value.root) return []
        if (value.current && value.current === value.root.name) return []
        const ref = yield* git.mergeBase(ctx.directory, value.root.ref)
        if (!ref) return []
        return yield* diffAgainstRef(git, ctx.directory, ref, options)
      }),
      diffRaw: Effect.fn("Vcs.diffRaw")(function* () {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return ""
        const [hasHead, status] = yield* Effect.all([git.hasHead(ctx.directory), git.status(ctx.directory)], {
          concurrency: 2,
        })
        const tracked = hasHead ? (yield* git.patchAll(ctx.directory, "HEAD")).text : ""
        const untracked = yield* Effect.forEach(
          status.filter((item) => item.code === "??"),
          (item) => git.patchUntracked(ctx.directory, item.file).pipe(Effect.map((patch) => patch.text)),
        )
        return [tracked, ...untracked].filter(Boolean).join("\n")
      }),
      apply: Effect.fn("Vcs.apply")(function* (input: ApplyInput) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") {
          return yield* new PatchApplyError({
            message: "Patch can't be applied because the project is not git-based",
            reason: "non-git",
          })
        }
        const applied = yield* git.applyPatch(ctx.directory, input.patch)
        if (applied.exitCode !== 0) {
          return yield* new PatchApplyError({
            message: "Patch can't be applied",
            reason: "not-clean",
          })
        }
        return { applied: true }
      }),
      commit: Effect.fn("Vcs.commit")(function* (input: CommitInput) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") {
          return yield* new CommitError({
            message: "Changes can't be committed because the project is not git-based",
            reason: "non-git",
          })
        }
        yield* git.run(input.files ? ["add", "--", ...input.files] : ["add", "-A", "--"], { cwd: ctx.directory })
        const args = (yield* git.hasHead(ctx.directory))
          ? ["commit", "-m", input.message]
          : ["commit", "--allow-empty", "-m", input.message]
        const result = yield* git.run(args, { cwd: ctx.directory })
        if (result.exitCode !== 0) {
          return yield* new CommitError({ message: "There is nothing to commit", reason: "nothing-to-commit" })
        }
        return { committed: true }
      }),
      stage: Effect.fn("Vcs.stage")(function* (input: StageInput) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") {
          return yield* new VcsStageError({
            message: "Changes can't be staged because the project is not git-based",
          })
        }
        // ponytail: paths from `git diff -- .` are repo-root-relative; resolve toplevel
        // so `git add -- <path>` works when ctx.directory is a subdir of the repo.
        const toplevel = (yield* git.run(["rev-parse", "--show-toplevel"], { cwd: ctx.directory })).text().trim()
        const result = yield* git.run(
          input.files && input.files.length > 0 ? ["add", "--", ...input.files] : ["add", "-A", "--"],
          { cwd: toplevel },
        )
        if (result.exitCode !== 0) {
          const stderr = result.stderr.toString().trim()
          return yield* new VcsStageError({
            message: `git add failed (exit ${result.exitCode})${stderr ? `: ${stderr}` : ""}`,
          })
        }
        return { files: input.files ?? [] }
      }),
      unstage: Effect.fn("Vcs.unstage")(function* (input: UnstageInput) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") {
          return yield* new VcsUnstageError({
            message: "Changes can't be unstaged because the project is not git-based",
          })
        }
        // ponytail: paths from `git diff -- .` are repo-root-relative; resolve toplevel
        // so `git add -- <path>` works when ctx.directory is a subdir of the repo.
        const toplevel = (yield* git.run(["rev-parse", "--show-toplevel"], { cwd: ctx.directory })).text().trim()
        const result = yield* git.run(
          input.files && input.files.length > 0 ? ["reset", "--", ...input.files] : ["reset"],
          { cwd: toplevel },
        )
        if (result.exitCode !== 0) {
          const stderr = result.stderr.toString().trim()
          return yield* new VcsUnstageError({
            message: `git reset failed (exit ${result.exitCode})${stderr ? `: ${stderr}` : ""}`,
          })
        }
        return { files: input.files ?? [] }
      }),
      staged: Effect.fn("Vcs.staged")(function* () {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return []
        const result = yield* git.run(["diff", "--cached", "--name-only"], { cwd: ctx.directory })
        return result
          .text()
          .split("\n")
          .filter((line) => line.length > 0)
      }),
      push: Effect.fn("Vcs.push")(function* (input: PushInput) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") {
          return yield* new PushError({
            message: "Changes can't be pushed because the project is not git-based",
            reason: "non-git",
          })
        }
        const current = yield* InstanceState.use(state, (x) => x.current)
        const ref = input.branch ?? current
        const result = yield* git.run(["push", input.remote ?? "origin", ...(ref ? [ref] : [])], {
          cwd: ctx.directory,
        })
        if (result.exitCode !== 0) {
          return yield* new PushError({ message: "Push failed", reason: "push-failed" })
        }
        return { pushed: true }
      }),
      branches: Effect.fn("Vcs.branches")(function* () {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return []
        const result = yield* git.run(
          ["branch", "-a", "--format=%(HEAD)%00%(refname:short)%00%(upstream:short)"],
          { cwd: ctx.directory },
        )
        return result
          .text()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [head, name, remote] = line.split("\0")
            return { name, current: head === "*", remote: remote || undefined } satisfies BranchInfo
          })
      }),
      checkout: Effect.fn("Vcs.checkout")(function* (input: CheckoutInput) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") {
          return yield* new CheckoutError({
            message: "Branch can't be switched because the project is not git-based",
            reason: "non-git",
          })
        }
        const result = yield* git.run(
          input.create
            ? ["checkout", "-b", input.branch, ...(input.base ? [input.base] : [])]
            : ["checkout", input.branch],
          { cwd: ctx.directory },
        )
        if (result.exitCode !== 0) {
          if (input.create) {
            const exists = yield* git.run(["rev-parse", "--verify", `refs/heads/${input.branch}`], {
              cwd: ctx.directory,
            })
            if (exists.exitCode === 0) {
              return yield* new CheckoutError({
                message: `Branch ${input.branch} already exists`,
                reason: "branch-exists",
              })
            }
          }
          return yield* new CheckoutError({ message: "Checkout failed", reason: "checkout-failed" })
        }
        yield* events.publish(Event.BranchUpdated, { branch: input.branch })
        return {
          branch: input.branch,
          default_branch: yield* InstanceState.use(state, (x) => x.root?.name),
        } satisfies Info
      }),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [Git.node, EventV2Bridge.node] })

export * as Vcs from "./vcs"
