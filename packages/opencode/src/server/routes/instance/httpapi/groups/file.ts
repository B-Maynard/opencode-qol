import { FileSystem } from "@opencode-ai/core/filesystem"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { LSP } from "@/lsp/lsp"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"

export const FileQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

export const FindTextQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  pattern: Schema.String,
})

export const FindFileQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  query: Schema.String,
  dirs: Schema.optional(Schema.Literals(["true", "false"])),
  type: Schema.optional(Schema.Literals(["file", "directory"])),
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)),
  ),
})

export const FindSymbolQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  query: Schema.String,
})

export const LegacyMatch = Schema.Struct({
  path: Schema.Struct({ text: Schema.String }),
  lines: Schema.Struct({ text: Schema.String }),
  line_number: NonNegativeInt,
  absolute_offset: NonNegativeInt,
  submatches: Schema.Array(
    Schema.Struct({
      match: Schema.Struct({ text: Schema.String }),
      start: NonNegativeInt,
      end: NonNegativeInt,
    }),
  ),
})

export const LegacyEntry = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  absolute: Schema.String,
  type: Schema.Literals(["file", "directory"]),
  ignored: Schema.Boolean,
}).annotate({ identifier: "FileNode" })

export const LegacyContent = Schema.Struct({
  type: Schema.Literals(["text", "binary"]),
  content: Schema.String,
  diff: Schema.optional(Schema.String),
  patch: Schema.optional(
    Schema.Struct({
      oldFileName: Schema.String,
      newFileName: Schema.String,
      oldHeader: Schema.optional(Schema.String),
      newHeader: Schema.optional(Schema.String),
      hunks: Schema.Array(
        Schema.Struct({
          oldStart: NonNegativeInt,
          oldLines: NonNegativeInt,
          newStart: NonNegativeInt,
          newLines: NonNegativeInt,
          lines: Schema.Array(Schema.String),
        }),
      ),
      index: Schema.optional(Schema.String),
    }),
  ),
  encoding: Schema.optional(Schema.Literal("base64")),
  mimeType: Schema.optional(Schema.String),
}).annotate({ identifier: "FileContent" })

export const LegacyStatus = Schema.Struct({
  path: Schema.String,
  added: NonNegativeInt,
  removed: NonNegativeInt,
  status: Schema.Literals(["added", "deleted", "modified"]),
}).annotate({ identifier: "File" })

export const FilePaths = {
  findText: "/find",
  findFile: "/find/file",
  findSymbol: "/find/symbol",
  list: "/file",
  content: "/file/content",
  status: "/file/status",
  write: "/file/write",
  mkdir: "/file/mkdir",
  rename: "/file/rename",
  remove: "/file/remove",
} as const

export const WriteInput = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
})

export const WriteResult = Schema.Struct({
  written: Schema.Boolean,
}).annotate({ identifier: "FileWriteResult" })

export const MkdirInput = Schema.Struct({
  path: Schema.String,
})

export const MkdirResult = Schema.Struct({
  created: Schema.Boolean,
}).annotate({ identifier: "FileMkdirResult" })

export const RenameInput = Schema.Struct({
  path: Schema.String,
  newName: Schema.String,
})

export const RenameResult = Schema.Struct({
  renamed: Schema.Boolean,
}).annotate({ identifier: "FileRenameResult" })

export const RemoveInput = Schema.Struct({
  path: Schema.String,
})

export const RemoveResult = Schema.Struct({
  removed: Schema.Boolean,
}).annotate({ identifier: "FileRemoveResult" })

export class FileWriteError extends Schema.ErrorClass<FileWriteError>("FileWriteError")(
  {
    name: Schema.Literal("FileWriteError"),
    data: Schema.Struct({
      message: Schema.String,
      reason: Schema.Literals(["path-out-of-scope", "not-a-file", "binary", "too-large"]),
    }),
  },
  { httpApiStatus: 400 },
) {}

export const FileApi = HttpApi.make("file")
  .add(
    HttpApiGroup.make("file")
      .add(
        HttpApiEndpoint.get("findText", FilePaths.findText, {
          query: FindTextQuery,
          success: described(Schema.Array(LegacyMatch), "Matches"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "find.text",
            summary: "Find text",
            description: "Search for text patterns across files in the project using ripgrep.",
          }),
        ),
        HttpApiEndpoint.get("findFile", FilePaths.findFile, {
          query: FindFileQuery,
          success: described(Schema.Array(Schema.String), "File paths"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "find.files",
            summary: "Find files",
            description: "Search for files or directories by name or pattern in the project directory.",
          }),
        ),
        HttpApiEndpoint.get("findSymbol", FilePaths.findSymbol, {
          query: FindSymbolQuery,
          success: described(Schema.Array(LSP.Symbol), "Symbols"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "find.symbols",
            summary: "Find symbols",
            description: "Search for workspace symbols like functions, classes, and variables using LSP.",
          }),
        ),
        HttpApiEndpoint.get("list", FilePaths.list, {
          query: FileQuery,
          success: described(Schema.Array(LegacyEntry), "Files and directories"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.list",
            summary: "List files",
            description: "List files and directories in a specified path.",
          }),
        ),
        HttpApiEndpoint.get("content", FilePaths.content, {
          query: FileQuery,
          success: described(LegacyContent, "File content"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.read",
            summary: "Read file",
            description: "Read the content of a specified file.",
          }),
        ),
        HttpApiEndpoint.get("status", FilePaths.status, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(LegacyStatus), "File status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.status",
            summary: "Get file status",
            description: "Get the git status of all files in the project.",
          }),
        ),
        HttpApiEndpoint.post("write", FilePaths.write, {
          query: WorkspaceRoutingQuery,
          payload: WriteInput,
          success: described(WriteResult, "File written"),
          error: FileWriteError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.write",
            summary: "Write file",
            description: "Write text content to a file inside the project directory.",
          }),
        ),
        HttpApiEndpoint.post("mkdir", FilePaths.mkdir, {
          query: WorkspaceRoutingQuery,
          payload: MkdirInput,
          success: described(MkdirResult, "Directory created"),
          error: FileWriteError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.mkdir",
            summary: "Create directory",
            description: "Create a directory inside the project directory.",
          }),
        ),
        HttpApiEndpoint.post("rename", FilePaths.rename, {
          query: WorkspaceRoutingQuery,
          payload: RenameInput,
          success: described(RenameResult, "File renamed"),
          error: FileWriteError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.rename",
            summary: "Rename file or directory",
            description: "Rename a file or directory inside the project directory.",
          }),
        ),
        HttpApiEndpoint.post("remove", FilePaths.remove, {
          query: WorkspaceRoutingQuery,
          payload: RemoveInput,
          success: described(RemoveResult, "File removed"),
          error: FileWriteError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.remove",
            summary: "Remove file or directory",
            description: "Remove a file or directory (and its contents) inside the project directory.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "file",
          description: "Experimental HttpApi file routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
