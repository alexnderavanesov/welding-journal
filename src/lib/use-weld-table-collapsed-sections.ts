import { useCallback, useEffect, useState } from 'react'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldTableSection } from '@/lib/weld-table-sections'
import { canCollapseSection, readCollapsedSections, writeCollapsedSections } from '@/lib/weld-table-utils'

const EMPTY_SECTION_SET = new Set<string>()

type UseWeldTableCollapsedSectionsParams = {
  storageKey: string
  availableSections: WeldTableSection[]
  alwaysVisibleFieldKeys: ReadonlySet<WeldFieldKey>
  collapsibleExtraSections?: ReadonlySet<string>
  defaultCollapsedSections?: ReadonlySet<string>
}

export function useWeldTableCollapsedSections({
  storageKey,
  availableSections,
  alwaysVisibleFieldKeys,
  collapsibleExtraSections = EMPTY_SECTION_SET,
  defaultCollapsedSections = EMPTY_SECTION_SET,
}: UseWeldTableCollapsedSectionsParams) {
  const [collapsedState, setCollapsedState] = useState(() => ({
    storageKey,
    sections: new Set<string>(),
    hydrated: false,
  }))
  const collapsedSections = collapsedState.storageKey === storageKey ? collapsedState.sections : new Set<string>()

  useEffect(() => {
    setCollapsedState({
      storageKey,
      sections: readCollapsedSections(storageKey, defaultCollapsedSections),
      hydrated: true,
    })
  }, [defaultCollapsedSections, storageKey])

  useEffect(() => {
    if (collapsedState.storageKey !== storageKey) return
    if (!collapsedState.hydrated) return
    writeCollapsedSections(storageKey, collapsedState.sections)
  }, [storageKey, collapsedState])

  const toggleSection = useCallback(
    (section: string) => {
      setCollapsedState((current) => {
        const currentSections =
          current.storageKey === storageKey && current.hydrated
            ? current.sections
            : readCollapsedSections(storageKey, defaultCollapsedSections)
        const next = new Set(currentSections)
        const targetSection = availableSections.find((group) => group.section === section)
        const canCollapse = targetSection
          ? canCollapseSection(targetSection.fields, alwaysVisibleFieldKeys)
          : collapsibleExtraSections.has(section)
        if (!canCollapse) {
          next.delete(section)
          return { storageKey, sections: next, hydrated: true }
        }
        if (next.has(section)) {
          next.delete(section)
        } else {
          next.add(section)
        }
        return { storageKey, sections: next, hydrated: true }
      })
    },
    [alwaysVisibleFieldKeys, availableSections, collapsibleExtraSections, defaultCollapsedSections, storageKey],
  )

  return { collapsedSections, toggleSection }
}
