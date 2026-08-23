import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Config } from "@/config/config"
import * as InstanceState from "@/effect/instance-state"
import { Format } from "@/format"
import { Global } from "@opencode-ai/core/global"
import { LSP } from "@/lsp/lsp"
import { Provider } from "@/provider/provider"
import { Vcs } from "@/project/vcs"
import { LLM } from "@/session/llm"
import { MessageID, SessionID } from "@/session/schema"
import { Skill } from "@/skill"
import { LLMEvent } from "@opencode-ai/llm"
import { Effect, Stream } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  ApiVcsApplyError,
  ApiVcsCheckoutError,
  ApiVcsCommitError,
  ApiVcsCommitMessageError,
  ApiVcsPushError,
} from "../groups/instance"
import { markInstanceForDisposal } from "../lifecycle"

export const instanceHandlers = HttpApiBuilder.group(InstanceHttpApi, "instance", (handlers) =>
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const command = yield* Command.Service
    const cfg = yield* Config.Service
    const format = yield* Format.Service
    const llm = yield* LLM.Service
    const lsp = yield* LSP.Service
    const provider = yield* Provider.Service
    const skill = yield* Skill.Service
    const vcs = yield* Vcs.Service

    const dispose = Effect.fn("InstanceHttpApi.dispose")(function* () {
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return true
    })

    const getPath = Effect.fn("InstanceHttpApi.path")(function* () {
      const ctx = yield* InstanceState.context
      return {
        home: Global.Path.home,
        state: Global.Path.state,
        config: Global.Path.config,
        worktree: ctx.worktree,
        directory: ctx.directory,
      }
    })

    const getVcs = Effect.fn("InstanceHttpApi.vcs")(function* () {
      const [branch, default_branch] = yield* Effect.all([vcs.branch(), vcs.defaultBranch()], {
        concurrency: "unbounded",
      })
      return { branch, default_branch }
    })

    const getVcsStatus = Effect.fn("InstanceHttpApi.vcsStatus")(function* () {
      return yield* vcs.status()
    })

    const getVcsDiff = Effect.fn("InstanceHttpApi.vcsDiff")(function* (ctx: {
      query: { mode: Vcs.Mode; context?: number }
    }) {
      return yield* vcs.diff(ctx.query.mode, { context: ctx.query.context })
    })

    const getVcsDiffRaw = Effect.fn("InstanceHttpApi.vcsDiffRaw")(function* () {
      return yield* vcs.diffRaw()
    })

    const applyVcs = Effect.fn("InstanceHttpApi.vcsApply")(function* (ctx: { payload: Vcs.ApplyInput }) {
      return yield* vcs.apply(ctx.payload).pipe(
        Effect.mapError(
          (error) =>
            new ApiVcsApplyError({
              name: "VcsApplyError",
              data: {
                message: error.message,
                reason: error.reason,
              },
            }),
        ),
      )
    })

    const commitVcs = Effect.fn("InstanceHttpApi.vcsCommit")(function* (ctx: { payload: Vcs.CommitInput }) {
      return yield* vcs.commit(ctx.payload).pipe(
        Effect.mapError(
          (error) =>
            new ApiVcsCommitError({
              name: "VcsCommitError",
              data: {
                message: error.message,
                reason: error.reason,
              },
            }),
        ),
      )
    })

    const generateCommitMessage = Effect.fn("InstanceHttpApi.vcsCommitMessage")(function* () {
      return yield* Effect.gen(function* () {
        const [allDiffs, stagedNames] = yield* Effect.all([vcs.diff("git"), vcs.staged()], {
          concurrency: "unbounded",
        })
        const stagedSet = new Set(stagedNames)
        const patch = allDiffs
          .filter((diff) => stagedSet.has(diff.file))
          .map((diff) => diff.patch)
          .filter(Boolean)
          .join("\n\n")
        if (!patch.trim()) {
          return yield* new ApiVcsCommitMessageError({
            name: "VcsCommitMessageError",
            data: { message: "No staged changes to summarize", reason: "nothing-to-commit" },
          })
        }
        // Prefer explicitly configured commit_model, fall back to existing chain
        const commitModelRef = yield* cfg.get().pipe(
          Effect.map((config) => config.commit_model),
          Effect.catch(() => Effect.succeed(undefined)),
        )
        const parsedCommitModel = commitModelRef ? Provider.parseModel(commitModelRef) : undefined
        const explicitModel = parsedCommitModel
          ? yield* provider.getModel(parsedCommitModel.providerID, parsedCommitModel.modelID).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            )
          : undefined

        const defaultAgent = yield* agent.defaultInfo()
        const fallback = yield* provider.defaultModel().pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!explicitModel && !fallback) {
          return yield* new ApiVcsCommitMessageError({
            name: "VcsCommitMessageError",
            data: { message: "No LLM provider configured", reason: "no-model" },
          })
        }
        const model = explicitModel ?? (defaultAgent.model
          ? yield* provider.getModel(defaultAgent.model.providerID, defaultAgent.model.modelID)
          : (yield* provider.getSmallModel(fallback!.providerID)) ??
            (yield* provider.getModel(fallback!.providerID, fallback!.modelID)))
        const sessionID = SessionID.descending()
        const result = yield* llm
          .stream({
            agent: defaultAgent,
            user: {
              id: MessageID.ascending(),
              sessionID,
              role: "user",
              time: { created: Date.now() },
              agent: defaultAgent.name,
              model: { providerID: model.providerID, modelID: model.id },
            },
            system: [],
            small: true,
            tools: {},
            model,
            sessionID,
            retries: 2,
            messages: [{ role: "user", content: COMMIT_PROMPT(patch) }],
          })
          .pipe(
            Stream.filter(LLMEvent.is.textDelta),
            Stream.map((event) => event.text),
            Stream.mkString,
          )
        const cleaned = sanitizeCommitMessage(result)
        if (!cleaned) {
          return yield* new ApiVcsCommitMessageError({
            name: "VcsCommitMessageError",
            data: { message: "Model produced no commit message", reason: "generation-failed" },
          })
        }
        return cleaned
      }).pipe(
        Effect.catch((error) =>
          error instanceof ApiVcsCommitMessageError
            ? Effect.fail(error)
            : Effect.fail(
                new ApiVcsCommitMessageError({
                  name: "VcsCommitMessageError",
                  data: { message: error instanceof Error ? error.message : String(error), reason: "generation-failed" },
                }),
              ),
        ),
      )
    })

    const stageVcs = Effect.fn("InstanceHttpApi.vcsStage")(function* (ctx: { payload: Vcs.StageInput }) {
      return yield* vcs.stage(ctx.payload)
    })

    const unstageVcs = Effect.fn("InstanceHttpApi.vcsUnstage")(function* (ctx: { payload: Vcs.UnstageInput }) {
      return yield* vcs.unstage(ctx.payload)
    })

    const getVcsStaged = Effect.fn("InstanceHttpApi.vcsStaged")(function* () {
      return yield* vcs.staged()
    })

    const pushVcs = Effect.fn("InstanceHttpApi.vcsPush")(function* (ctx: { payload: Vcs.PushInput | void }) {
      return yield* vcs.push(ctx.payload ?? undefined).pipe(
        Effect.mapError(
          (error) =>
            new ApiVcsPushError({
              name: "VcsPushError",
              data: {
                message: error.message,
                reason: error.reason,
              },
            }),
        ),
      )
    })

    const getVcsBranches = Effect.fn("InstanceHttpApi.vcsBranches")(function* () {
      return yield* vcs.branches()
    })

    const checkoutVcs = Effect.fn("InstanceHttpApi.vcsCheckout")(function* (ctx: { payload: Vcs.CheckoutInput }) {
      return yield* vcs.checkout(ctx.payload).pipe(
        Effect.mapError(
          (error) =>
            new ApiVcsCheckoutError({
              name: "VcsCheckoutError",
              data: {
                message: error.message,
                reason: error.reason,
              },
            }),
        ),
      )
    })

    const getCommand = Effect.fn("InstanceHttpApi.command")(function* () {
      return yield* command.list()
    })

    const getAgent = Effect.fn("InstanceHttpApi.agent")(function* () {
      return yield* agent.list()
    })

    const getSkill = Effect.fn("InstanceHttpApi.skill")(function* () {
      return yield* skill.all()
    })

    const getLsp = Effect.fn("InstanceHttpApi.lsp")(function* () {
      return yield* lsp.status()
    })

    const getFormatter = Effect.fn("InstanceHttpApi.formatter")(function* () {
      return yield* format.status()
    })

    return handlers
      .handle("dispose", dispose)
      .handle("path", getPath)
      .handle("vcs", getVcs)
      .handle("vcsStatus", getVcsStatus)
      .handle("vcsDiff", getVcsDiff)
      .handle("vcsDiffRaw", getVcsDiffRaw)
      .handle("vcsApply", applyVcs)
      .handle("vcsCommit", commitVcs)
      .handle("vcsCommitMessage", generateCommitMessage)
      .handle("vcsStage", stageVcs)
      .handle("vcsUnstage", unstageVcs)
      .handle("vcsStaged", getVcsStaged)
      .handle("vcsPush", pushVcs)
      .handle("vcsBranches", getVcsBranches)
      .handle("vcsCheckout", checkoutVcs)
      .handle("command", getCommand)
      .handle("agent", getAgent)
      .handle("skill", getSkill)
      .handle("lsp", getLsp)
      .handle("formatter", getFormatter)
  }),
)

// ponytail: char-slice cap ~50KB; full staged diffs can exceed small-model context windows.
const COMMIT_PROMPT_BYTES = 50_000

function COMMIT_PROMPT(diff: string) {
  const truncated =
    Buffer.byteLength(diff) > COMMIT_PROMPT_BYTES ? `${diff.slice(0, COMMIT_PROMPT_BYTES)}... (truncated)` : diff
  return `Write a concise git commit message for the following staged changes.
Follow Conventional Commits format (type(scope): summary) when appropriate.
Output ONLY the commit message — no preamble, no explanation, no code fences.

${truncated}`
}

function sanitizeCommitMessage(input: string) {
  let lines = input.trim().split("\n")
  if (lines.length >= 2 && /^```/.test(lines[0].trim()) && /^```/.test(lines.at(-1)!.trim())) {
    lines = lines.slice(1, -1)
  }
  while (lines.length && /^(here is|here's|your commit message|sure,? here|of course|the commit message)/i.test(lines[0].trim())) {
    lines = lines.slice(1)
  }
  return lines.join("\n").trim()
}
