import { Config } from "@/config/config"
import { ConfigAgent } from "@/config/agent"
import { Provider } from "@/provider/provider"
import * as InstanceState from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { AgentFileNotFoundError, UpdateAgentFile } from "../groups/config"
import { markInstanceForDisposal } from "../lifecycle"

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service
    const fs = yield* FSUtil.Service

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return yield* configSvc.get()
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
      yield* configSvc.update(ctx.payload)
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return ctx.payload
    })

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* providerSvc.list()
      return {
        providers: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
      }
    })

    const agents = Effect.fn("ConfigHttpApi.agents")(function* () {
      const directories = yield* configSvc.directories()
      return yield* Effect.promise(() => ConfigAgent.discoverAgentFiles(directories))
    })

    const updateAgents = Effect.fn("ConfigHttpApi.updateAgents")(function* (ctx: {
      payload: typeof UpdateAgentFile.Type
    }) {
      const directories = yield* configSvc.directories()
      const entries = yield* Effect.promise(() => ConfigAgent.discoverAgentFiles(directories))
      const entry = entries.find((item) => item.path === ctx.payload.path)
      if (!entry) {
        return yield* Effect.fail(
          new AgentFileNotFoundError({
            name: "AgentFileNotFound",
            data: { path: ctx.payload.path, message: `Agent config file not found: ${ctx.payload.path}` },
          }),
        )
      }
      yield* fs
        .writeFileString(ctx.payload.path, ctx.payload.content)
        .pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return { ...entry, content: ctx.payload.content }
    })

    return handlers
      .handle("get", get)
      .handle("update", update)
      .handle("providers", providers)
      .handle("agents", agents)
      .handle("updateAgents", updateAgents)
  }),
)
