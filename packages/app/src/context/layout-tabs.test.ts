import { describe, expect, test } from "bun:test"
import {
  SESSION_OPEN_FILE_TAB,
  closeSessionTab,
  openSessionTab,
  previewSessionTab,
  type SessionTabState,
} from "./layout-tabs"

const state = (all: string[], active?: string, preview?: string): SessionTabState => ({
  tabs: { all, active },
  preview,
})

describe("previewSessionTab", () => {
  test("appends the Open File placeholder", () => {
    expect(previewSessionTab(state(["file://a.ts"], "file://a.ts"), SESSION_OPEN_FILE_TAB)).toEqual(
      state(["file://a.ts", SESSION_OPEN_FILE_TAB], SESSION_OPEN_FILE_TAB, SESSION_OPEN_FILE_TAB),
    )
  })

  test("replaces the current preview in place", () => {
    expect(
      previewSessionTab(
        state(["context", SESSION_OPEN_FILE_TAB, "file://b.ts"], SESSION_OPEN_FILE_TAB, SESSION_OPEN_FILE_TAB),
        "file://a.ts",
      ),
    ).toEqual(state(["context", "file://a.ts", "file://b.ts"], "file://a.ts", "file://a.ts"))
  })

  test("activates a durable tab without duplicating it", () => {
    expect(
      previewSessionTab(
        state(["file://a.ts", SESSION_OPEN_FILE_TAB, "file://b.ts"], SESSION_OPEN_FILE_TAB, SESSION_OPEN_FILE_TAB),
        "file://b.ts",
      ),
    ).toEqual(state(["file://a.ts", "file://b.ts"], "file://b.ts"))
  })

  test("replaces a restored Open File placeholder", () => {
    expect(
      previewSessionTab(state(["file://a.ts", SESSION_OPEN_FILE_TAB], SESSION_OPEN_FILE_TAB), "file://b.ts"),
    ).toEqual(state(["file://a.ts", "file://b.ts"], "file://b.ts", "file://b.ts"))
  })
})

describe("openSessionTab", () => {
  test("pins the current preview", () => {
    expect(openSessionTab(state(["file://a.ts"], "file://a.ts", "file://a.ts"), "file://a.ts")).toEqual(
      state(["file://a.ts"], "file://a.ts"),
    )
  })

  test("replaces a preview with a directly opened file", () => {
    expect(openSessionTab(state(["file://a.ts"], "file://a.ts", "file://a.ts"), "file://b.ts")).toEqual(
      state(["file://b.ts"], "file://b.ts"),
    )
  })

  test("keeps the preview when switching to Review", () => {
    expect(openSessionTab(state(["file://a.ts"], "file://a.ts", "file://a.ts"), "review")).toEqual(
      state(["file://a.ts"], "review", "file://a.ts"),
    )
  })

  test("replaces a restored Open File placeholder with a direct open", () => {
    expect(openSessionTab(state(["file://a.ts", SESSION_OPEN_FILE_TAB], SESSION_OPEN_FILE_TAB), "file://b.ts")).toEqual(
      state(["file://a.ts", "file://b.ts"], "file://b.ts"),
    )
  })

  test("replaces a permanent file:// sibling with edit:// in place", () => {
    expect(openSessionTab(state(["file://a.ts"], "file://a.ts"), "edit://a.ts")).toEqual(
      state(["edit://a.ts"], "edit://a.ts"),
    )
  })

  test("replaces edit:// sibling with file:// in place (the toggle-off bug)", () => {
    expect(openSessionTab(state(["edit://a.ts"], "edit://a.ts"), "file://a.ts")).toEqual(
      state(["file://a.ts"], "file://a.ts"),
    )
  })

  test("replaces the edit:// sibling in place within multiple tabs", () => {
    expect(openSessionTab(state(["file://a.ts", "file://b.ts"], "file://a.ts"), "edit://b.ts")).toEqual(
      state(["file://a.ts", "edit://b.ts"], "edit://b.ts"),
    )
  })

  test("replaces the edit:// sibling when it is the preview", () => {
    expect(openSessionTab(state(["edit://a.ts"], "edit://a.ts", "edit://a.ts"), "file://a.ts")).toEqual(
      state(["file://a.ts"], "file://a.ts"),
    )
  })

  test("toggling edit on and off keeps exactly one tab", () => {
    const toggled = openSessionTab(
      openSessionTab(state(["file://a.ts"], "file://a.ts"), "edit://a.ts"),
      "file://a.ts",
    )
    expect(toggled).toEqual(state(["file://a.ts"], "file://a.ts"))
  })
})

describe("closeSessionTab", () => {
  test("clears preview metadata and selects the left neighbor", () => {
    expect(
      closeSessionTab(
        state(["file://a.ts", "file://b.ts", "file://c.ts"], "file://b.ts", "file://b.ts"),
        "file://b.ts",
      ),
    ).toEqual(state(["file://a.ts", "file://c.ts"], "file://a.ts"))
  })
})
