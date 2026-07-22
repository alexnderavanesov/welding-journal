const collapsedSectionsStoragePrefix = 'welding-tracker-collapsed-sections'

export function canCollapseSection(fields: Array<{ key: string }>, alwaysVisibleFieldKeys: ReadonlySet<string>) {
  return fields.some((field) => !alwaysVisibleFieldKeys.has(field.key))
}

export function readCollapsedSections(storageKey: string) {
  if (typeof window === 'undefined') return new Set<string>()

  try {
    const stored = window.localStorage.getItem(getCollapsedSectionsStorageKey(storageKey))
    if (!stored) return new Set<string>()
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? new Set(parsed.filter((value): value is string => typeof value === 'string')) : new Set<string>()
  } catch {
    return new Set<string>()
  }
}

export function writeCollapsedSections(storageKey: string, sections: ReadonlySet<string>) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(getCollapsedSectionsStorageKey(storageKey), JSON.stringify([...sections]))
}

function getCollapsedSectionsStorageKey(storageKey: string) {
  return `${collapsedSectionsStoragePrefix}:${storageKey}`
}
