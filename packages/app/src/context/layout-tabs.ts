export const SESSION_OPEN_FILE_TAB = "open-file"

export type SessionTabs = {
  active?: string
  all: string[]
}

export type SessionTabState = {
  tabs: SessionTabs
  preview?: string
}

const sessionTabPreview = (current: SessionTabState) =>
  current.preview ?? (current.tabs.all.includes(SESSION_OPEN_FILE_TAB) ? SESSION_OPEN_FILE_TAB : undefined)

export function previewSessionTab(current: SessionTabState, tab: string): SessionTabState {
  const preview = sessionTabPreview(current)
  const previewIndex = preview ? current.tabs.all.indexOf(preview) : -1
  const existingIndex = current.tabs.all.indexOf(tab)

  if (existingIndex !== -1) {
    if (previewIndex === -1 || preview === tab) {
      return { tabs: { all: current.tabs.all, active: tab }, preview: preview === tab ? tab : undefined }
    }
    return {
      tabs: { all: current.tabs.all.filter((item) => item !== preview), active: tab },
    }
  }

  if (previewIndex === -1) {
    return { tabs: { all: [...current.tabs.all, tab], active: tab }, preview: tab }
  }

  return {
    tabs: {
      all: current.tabs.all.map((item, index) => (index === previewIndex ? tab : item)),
      active: tab,
    },
    preview: tab,
  }
}

// ponytail: file:// and edit:// share a path suffix, so string suffix match replaces sibling
const siblingIndexOf = (all: string[], tab: string): number => {
  if (!tab.startsWith("file://") && !tab.startsWith("edit://")) return -1
  const op = tab.startsWith("file://") ? "edit://" : "file://"
  return all.indexOf(op + tab.slice(tab.indexOf("://") + 3))
}

export function openSessionTab(current: SessionTabState, tab: string): SessionTabState {
  const preview = sessionTabPreview(current)
  if (tab === "review") {
    return {
      tabs: { all: current.tabs.all.filter((item) => item !== tab), active: tab },
      preview,
    }
  }

  if (tab === "context") {
    return {
      tabs: { all: [tab, ...current.tabs.all.filter((item) => item !== tab)], active: tab },
      preview,
    }
  }

  const previewIndex = preview ? current.tabs.all.indexOf(preview) : -1
  const existingIndex = current.tabs.all.indexOf(tab)
  if (existingIndex !== -1) {
    if (previewIndex === -1 || preview === tab) {
      return { tabs: { all: current.tabs.all, active: tab } }
    }
    return {
      tabs: { all: current.tabs.all.filter((item) => item !== preview), active: tab },
    }
  }

  const siblingIndex = existingIndex === -1 ? siblingIndexOf(current.tabs.all, tab) : -1
  if (siblingIndex !== -1) {
    const sibling = current.tabs.all[siblingIndex]
    return {
      tabs: { all: current.tabs.all.map((item, index) => (index === siblingIndex ? tab : item)), active: tab },
      preview: preview === sibling ? undefined : preview,
    }
  }

  if (previewIndex === -1) {
    return { tabs: { all: [...current.tabs.all, tab], active: tab } }
  }

  return {
    tabs: {
      all: current.tabs.all.map((item, index) => (index === previewIndex ? tab : item)),
      active: tab,
    },
  }
}

export function closeSessionTab(current: SessionTabState, tab: string): SessionTabState {
  if (tab === "review") {
    if (current.tabs.active !== tab) return current
    return {
      tabs: { all: current.tabs.all, active: current.tabs.all[0] },
      preview: current.preview,
    }
  }

  const all = current.tabs.all.filter((item) => item !== tab)
  const preview = current.preview === tab ? undefined : current.preview
  if (current.tabs.active !== tab) return { tabs: { ...current.tabs, all }, preview }

  const index = current.tabs.all.indexOf(tab)
  return {
    tabs: {
      all,
      active: current.tabs.all[index - 1] ?? current.tabs.all[index + 1] ?? all[0],
    },
    preview,
  }
}
