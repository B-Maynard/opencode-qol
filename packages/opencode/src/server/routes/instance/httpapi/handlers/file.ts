import * as InstanceState from "@/effect/instance-state"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { Effect, Layer, Option } from "effect"
import ignore from "ignore"
import path from "path"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { FileWriteError } from "../groups/file"

export const fileHandlers = HttpApiBuilder.group(InstanceHttpApi, "file", (handlers) =>
  Effect.gen(function* () {
    const ripgrep = yield* Ripgrep.Service
    const locations = yield* LocationServiceMap.Service

    const filesystem = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* effect.pipe(
        Effect.provide(
          locations.get(Location.Ref.make({ directory: AbsolutePath.make((yield* InstanceState.context).directory) })),
        ),
      )
    })

    const findText = Effect.fn("FileHttpApi.findText")(function* (ctx: { query: { pattern: string } }) {
      return (yield* ripgrep
        .grep({ cwd: (yield* InstanceState.context).directory, pattern: ctx.query.pattern, limit: 10 })
        .pipe(Effect.orDie)).map((match) => ({
        path: { text: match.entry.path },
        lines: { text: match.text },
        line_number: match.line,
        absolute_offset: match.offset,
        submatches: match.submatches.map((submatch) => ({
          match: { text: submatch.text },
          start: submatch.start,
          end: submatch.end,
        })),
      }))
    })

    const findFile = Effect.fn("FileHttpApi.findFile")(function* (ctx: {
      query: { query: string; dirs?: "true" | "false"; type?: "file" | "directory"; limit?: number }
    }) {
      const directory = (yield* InstanceState.context).directory
      const limit = ctx.query.limit ?? 10
      const type = ctx.query.type ?? (ctx.query.dirs === "false" ? "file" : undefined)
      const started = performance.now()
      const found = yield* filesystem(FileSystem.Service.use((fs) => fs.find({ query: ctx.query.query, limit, type })))
      yield* Effect.logInfo("find file", {
        query: ctx.query.query,
        type,
        directory,
        limit,
        results: found.length,
        duration: Math.round(performance.now() - started),
      })
      return found.map((item) => item.path)
    })

    const findSymbol = Effect.fn("FileHttpApi.findSymbol")(function* () {
      return []
    })

    const list = Effect.fn("FileHttpApi.list")(function* (ctx: { query: { path: string } }) {
      const directory = (yield* InstanceState.context).directory
      return yield* filesystem(
        Effect.gen(function* () {
          const fs = yield* FileSystem.Service
          const raw = yield* FSUtil.Service
          const location = yield* Location.Service
          const ignored = ignore()
          const gitignore = yield* raw
            .readFileString(path.join(location.project.directory, ".gitignore"))
            .pipe(Effect.catch(() => Effect.succeed("")))
          if (gitignore) ignored.add(gitignore)
          const ignorefile = yield* raw
            .readFileString(path.join(location.project.directory, ".ignore"))
            .pipe(Effect.catch(() => Effect.succeed("")))
          if (ignorefile) ignored.add(ignorefile)
          return (yield* fs.list({ path: RelativePath.make(ctx.query.path) })).map((item) => ({
            name: path.basename(item.path),
            path: item.path,
            absolute: path.resolve(location.directory, item.path),
            type: item.type,
            ignored: ignored.ignores(
              path.relative(location.project.directory, path.resolve(location.directory, item.path)) +
                (item.type === "directory" ? "/" : ""),
            ),
          }))
        }),
      )
    })

    const content = Effect.fn("FileHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const directory = (yield* InstanceState.context).directory
      const file = path.resolve(directory, ctx.query.path)
      if (!FSUtil.contains(directory, file)) return yield* Effect.die(new Error("Path escapes the location"))
      if (!(yield* FSUtil.Service.use((fs) => fs.existsSafe(file)))) return { type: "text" as const, content: "" }
      return yield* filesystem(
        FileSystem.Service.use((fs) => fs.read({ path: RelativePath.make(ctx.query.path) })),
      ).pipe(
        Effect.flatMap((item) =>
          Effect.gen(function* () {
            const text = item.content.includes(0)
              ? Option.none<string>()
              : yield* Effect.sync(() => new TextDecoder("utf-8", { fatal: true }).decode(item.content)).pipe(
                  Effect.option,
                )
            return { item, text }
          }),
        ),
        Effect.map(({ item, text }) =>
          Option.isSome(text)
            ? { type: "text" as const, content: text.value.trim() }
            : {
                type: "binary" as const,
                content: Buffer.from(item.content).toString("base64"),
                encoding: "base64" as const,
                mimeType: item.mime,
              },
        ),
      )
    })

    const status = Effect.fn("FileHttpApi.status")(function* () {
      return []
    })

    const write = Effect.fn("FileHttpApi.write")(function* (ctx: { payload: { path: string; content: string } }) {
      const directory = (yield* InstanceState.context).directory
      const file = path.resolve(directory, ctx.payload.path)
      if (!FSUtil.contains(directory, file)) {
        return yield* new FileWriteError({
          name: "FileWriteError",
          data: { reason: "path-out-of-scope", message: "Path escapes the project directory" },
        })
      }
      const realpath = yield* FSUtil.resolveRealpath(file)
      if (!FSUtil.contains(directory, realpath)) {
        return yield* new FileWriteError({
          name: "FileWriteError",
          data: { reason: "path-out-of-scope", message: "Path escapes the project directory" },
        })
      }
      if (Buffer.byteLength(ctx.payload.content) > 5 * 1024 * 1024) {
        return yield* new FileWriteError({
          name: "FileWriteError",
          data: { reason: "too-large", message: "File content exceeds 5 MB" },
        })
      }
      if (ctx.payload.content.slice(0, 8192).includes("\0")) {
        return yield* new FileWriteError({
          name: "FileWriteError",
          data: { reason: "binary", message: "Binary content is not supported" },
        })
      }
      if (yield* FSUtil.Service.use((fs) => fs.isDir(file))) {
        return yield* new FileWriteError({
          name: "FileWriteError",
          data: { reason: "not-a-file", message: "Path is a directory, not a file" },
        })
      }
      // The location-scoped file watcher publishes an update event for the
      // write, which refreshes the file tree in the app automatically.
      yield* FSUtil.Service.use((fs) => fs.writeFileString(file, ctx.payload.content)).pipe(
        Effect.catch((cause) =>
          Effect.fail(
            new FileWriteError({
              name: "FileWriteError",
              data: { reason: "io-error", message: `Failed to write file: ${cause.message}` },
            }),
          ),
        ),
      )
      return { written: true }
    })

    // mkdir creates a new directory inside the project. The lexical
    // `path.resolve` confines the target lexically; we additionally
    // realpath-check the longest existing ancestor to catch symlink
    // escapes via existing parent components.
    const mkdir = Effect.fn("FileHttpApi.mkdir")(function* (ctx: { payload: { path: string } }) {
      const directory = (yield* InstanceState.context).directory
      const target = path.resolve(directory, ctx.payload.path)
      if (!FSUtil.contains(directory, target)) {
        return yield* new FileWriteError({
          name: "FileWriteError",
          data: { reason: "path-out-of-scope", message: "Path escapes the project directory" },
        })
      }
      const realpath = yield* FSUtil.resolveRealpath(target)
      if (!FSUtil.contains(directory, realpath)) {
        return yield* new FileWriteError({
          name: "FileWriteError",
          data: { reason: "path-out-of-scope", message: "Path escapes the project directory" },
        })
      }
      const exists = yield* FSUtil.Service.use((fs) => fs.existsSafe(target))
      if (!exists) {
        yield* FSUtil.Service.use((fs) => fs.makeDirectory(target, { recursive: true })).pipe(
          Effect.catch((cause) =>
            new FileWriteError({
              name: "FileWriteError",
              data: { reason: "io-error", message: `Failed to create directory: ${cause.message}` },
            }),
          ),
        )
      }
      // Idempotent: returns { created: false } if target already exists.
      return { created: !exists }
    })

    const rename = Effect.fn("FileHttpApi.rename")(function* (ctx: { payload: { path: string; newName: string } }) {
      const directory = (yield* InstanceState.context).directory
      const source = path.resolve(directory, ctx.payload.path)
      if (!FSUtil.contains(directory, source)) {
        return yield* new FileWriteError({
          name: "FileWriteError",
          data: { reason: "path-out-of-scope", message: "Path escapes the project directory" },
        })
      }
      const sourceRealpath = yield* FSUtil.resolveRealpath(source)
      if (!FSUtil.contains(directory, sourceRealpath)) {
        return yield* new FileWriteError({
          name: "FileWriteError",
          data: { reason: "path-out-of-scope", message: "Path escapes the project directory" },
        })
      }
      const target = path.resolve(path.dirname(source), ctx.payload.newName)
      if (!FSUtil.contains(directory, target) || target === source) {
        return yield* new FileWriteError({
          name: "FileWriteError",
          data: { reason: "path-out-of-scope", message: "Invalid rename target" },
        })
      }
      const targetRealpath = yield* FSUtil.resolveRealpath(target)
      if (!FSUtil.contains(directory, targetRealpath)) {
        return yield* new FileWriteError({
          name: "FileWriteError",
          data: { reason: "path-out-of-scope", message: "Path escapes the project directory" },
        })
      }
      const exists = yield* FSUtil.Service.use((fs) => fs.existsSafe(target))
      if (exists) {
        return yield* new FileWriteError({
          name: "FileWriteError",
          data: { reason: "not-a-file", message: "A file or directory with that name already exists" },
        })
      }
      yield* FSUtil.Service.use((fs) => fs.rename(source, target)).pipe(
        Effect.catch((cause) =>
          Effect.fail(
            new FileWriteError({
              name: "FileWriteError",
              data: { reason: "io-error", message: `Failed to rename: ${cause.message}` },
            }),
          ),
        ),
      )
      return { renamed: true }
    })

    const remove = Effect.fn("FileHttpApi.remove")(function* (ctx: { payload: { path: string } }) {
      const directory = (yield* InstanceState.context).directory
      const target = path.resolve(directory, ctx.payload.path)
      if (!FSUtil.containsStrict(directory, target)) {
        return yield* new FileWriteError({
          name: "FileWriteError",
          data: { reason: "path-out-of-scope", message: "Path escapes the project directory" },
        })
      }
      const realpath = yield* FSUtil.resolveRealpath(target)
      if (!FSUtil.containsStrict(directory, realpath)) {
        return yield* new FileWriteError({
          name: "FileWriteError",
          data: { reason: "path-out-of-scope", message: "Path escapes the project directory" },
        })
      }
      yield* FSUtil.Service.use((fs) => fs.remove(target, { recursive: true })).pipe(
        Effect.catch((cause) =>
          Effect.fail(
            new FileWriteError({
              name: "FileWriteError",
              data: { reason: "io-error", message: `Failed to remove: ${cause.message}` },
            }),
          ),
        ),
      )
      return { removed: true }
    })

    return handlers
      .handle("findText", findText)
      .handle("findFile", findFile)
      .handle("findSymbol", findSymbol)
      .handle("list", list)
      .handle("content", content)
      .handle("status", status)
      .handle("write", write)
      .handle("mkdir", mkdir)
      .handle("rename", rename)
      .handle("remove", remove)
  }),
).pipe(Layer.provide(locationServiceMapLayer))
