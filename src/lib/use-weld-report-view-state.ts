import { useCallback, useEffect, useMemo, useState } from 'react'

import { isHiddenReportFilterKey } from '@/lib/report-hidden-filters'
import { isVirtualWeldField, type WeldFieldKey } from '@/lib/weld-fields'
import type { WeldTableSection } from '@/lib/weld-table-sections'
import {
  createSavedWeldReportView,
  getPresetHiddenFieldKeys,
  readWeldReportViewStorage,
  writeWeldReportViewStorage,
  type SavedWeldReportView,
  type WeldReportColumnPreset,
  type WeldReportViewSnapshot,
  type WeldReportViewStorage,
} from '@/lib/weld-report-view'
import type { WeldSort } from '@/server/weld-contracts'

type UseWeldReportViewStateOptions = {
  storageKey: string
  sections: readonly WeldTableSection[]
  alwaysVisibleFieldKeys: ReadonlySet<string>
  defaultCollapsedSections: ReadonlySet<string>
  columnFilters: Record<string, string>
  sort: WeldSort | null
  onColumnFiltersChange: (filters: Record<string, string>) => void
  onSortChange: (sort: WeldSort | null) => void
}

export function useWeldReportViewState({
  storageKey,
  sections,
  alwaysVisibleFieldKeys,
  defaultCollapsedSections,
  columnFilters,
  sort,
  onColumnFiltersChange,
  onSortChange,
}: UseWeldReportViewStateOptions) {
  const defaultCollapsedSectionsSignature = [...defaultCollapsedSections].sort().join('|')
  const stableDefaultCollapsedSections = useMemo(
    () => new Set(defaultCollapsedSections),
    // The signature makes equivalent Set instances safe for callers that create them during render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultCollapsedSectionsSignature],
  )
  const [state, setState] = useState<{ storageKey: string; value: WeldReportViewStorage }>(() => ({
    storageKey,
    value: readWeldReportViewStorage(storageKey, stableDefaultCollapsedSections),
  }))
  const value = state.storageKey === storageKey
    ? state.value
    : readWeldReportViewStorage(storageKey, stableDefaultCollapsedSections)
  const allowedFieldKeys = useMemo(
    () => new Set(sections.flatMap((section) => section.fields.map((field) => field.key))),
    [sections],
  )
  const allowedSortFieldKeys = useMemo(
    () => new Set(
      sections.flatMap((section) => section.fields)
        .filter((field) => !isVirtualWeldField(field))
        .map((field) => field.key),
    ),
    [sections],
  )
  const allowedSectionNames = useMemo(
    () => new Set(sections.map((section) => section.section)),
    [sections],
  )

  useEffect(() => {
    setState({
      storageKey,
      value: readWeldReportViewStorage(storageKey, stableDefaultCollapsedSections),
    })
  }, [stableDefaultCollapsedSections, storageKey])

  useEffect(() => {
    if (state.storageKey !== storageKey) return
    writeWeldReportViewStorage(storageKey, state.value)
  }, [state, storageKey])

  const updateValue = useCallback((updater: (current: WeldReportViewStorage) => WeldReportViewStorage) => {
    setState((current) => {
      const currentValue = current.storageKey === storageKey
        ? current.value
        : readWeldReportViewStorage(storageKey, stableDefaultCollapsedSections)
      return { storageKey, value: updater(currentValue) }
    })
  }, [stableDefaultCollapsedSections, storageKey])

  const applyPreset = useCallback((preset: WeldReportColumnPreset) => {
    updateValue((current) => {
      const hiddenFieldKeys = [...getPresetHiddenFieldKeys({
        preset,
        sections,
        alwaysVisibleFieldKeys,
        customHiddenFieldKeys: new Set(current.customHiddenFieldKeys),
      })]
      return {
        ...current,
        activePreset: preset,
        hiddenFieldKeys,
        collapsedSections: [],
      }
    })
  }, [alwaysVisibleFieldKeys, sections, updateValue])

  const toggleField = useCallback((fieldKey: WeldFieldKey) => {
    if (alwaysVisibleFieldKeys.has(fieldKey) || !allowedFieldKeys.has(fieldKey)) return
    updateValue((current) => {
      const hidden = new Set(current.hiddenFieldKeys)
      if (hidden.has(fieldKey)) hidden.delete(fieldKey)
      else hidden.add(fieldKey)
      const hiddenFieldKeys = [...hidden]
      return {
        ...current,
        activePreset: 'custom',
        hiddenFieldKeys,
        customHiddenFieldKeys: hiddenFieldKeys,
      }
    })
  }, [allowedFieldKeys, alwaysVisibleFieldKeys, updateValue])

  const showAllFields = useCallback(() => {
    updateValue((current) => ({
      ...current,
      activePreset: 'custom',
      hiddenFieldKeys: [],
      customHiddenFieldKeys: [],
    }))
  }, [updateValue])

  const toggleSection = useCallback((section: string) => {
    updateValue((current) => {
      const collapsed = new Set(current.collapsedSections)
      if (collapsed.has(section)) collapsed.delete(section)
      else collapsed.add(section)
      return {
        ...current,
        activePreset: 'custom',
        customHiddenFieldKeys: current.hiddenFieldKeys,
        collapsedSections: [...collapsed],
      }
    })
  }, [updateValue])

  const saveView = useCallback((name: string) => {
    const trimmedName = name.trim()
    if (!trimmedName) return false
    const snapshot: WeldReportViewSnapshot = {
      hiddenFieldKeys: value.hiddenFieldKeys,
      collapsedSections: value.collapsedSections,
      columnFilters,
      sort,
    }
    updateValue((current) => {
      const existing = current.savedViews.find((view) => view.name.toLocaleLowerCase('ru') === trimmedName.toLocaleLowerCase('ru'))
      const saved = createSavedWeldReportView(trimmedName, snapshot, existing?.id)
      return {
        ...current,
        savedViews: existing
          ? current.savedViews.map((view) => view.id === existing.id ? saved : view)
          : [...current.savedViews, saved],
      }
    })
    return true
  }, [columnFilters, sort, updateValue, value.collapsedSections, value.hiddenFieldKeys])

  const applySavedView = useCallback((savedView: SavedWeldReportView) => {
    const hiddenFieldKeys = savedView.snapshot.hiddenFieldKeys.filter((fieldKey) => allowedFieldKeys.has(fieldKey))
    const columnFilters = Object.fromEntries(
      Object.entries(savedView.snapshot.columnFilters)
        .filter(([fieldKey]) => allowedFieldKeys.has(fieldKey as WeldFieldKey) || isHiddenReportFilterKey(fieldKey)),
    )
    const nextSort = savedView.snapshot.sort && allowedSortFieldKeys.has(savedView.snapshot.sort.fieldKey)
      ? savedView.snapshot.sort
      : null
    updateValue((current) => ({
      ...current,
      activePreset: 'custom',
      hiddenFieldKeys,
      customHiddenFieldKeys: hiddenFieldKeys,
      collapsedSections: savedView.snapshot.collapsedSections.filter((section) => allowedSectionNames.has(section)),
    }))
    onColumnFiltersChange(columnFilters)
    onSortChange(nextSort)
  }, [allowedFieldKeys, allowedSectionNames, allowedSortFieldKeys, onColumnFiltersChange, onSortChange, updateValue])

  const deleteSavedView = useCallback((id: string) => {
    updateValue((current) => ({
      ...current,
      savedViews: current.savedViews.filter((view) => view.id !== id),
    }))
  }, [updateValue])

  const hiddenFieldKeys = useMemo(
    () => new Set(value.hiddenFieldKeys.filter((fieldKey) => allowedFieldKeys.has(fieldKey))),
    [allowedFieldKeys, value.hiddenFieldKeys],
  )
  const collapsedSections = useMemo(() => new Set(value.collapsedSections), [value.collapsedSections])

  return {
    activePreset: value.activePreset,
    hiddenFieldKeys,
    collapsedSections,
    savedViews: value.savedViews,
    applyPreset,
    toggleField,
    showAllFields,
    toggleSection,
    saveView,
    applySavedView,
    deleteSavedView,
  }
}
