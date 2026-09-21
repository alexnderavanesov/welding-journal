import { ChevronDown, ChevronLeft, ChevronRight, Columns3 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import type { WeldField } from '@/lib/weld-fields'
import { getReportViewportWidth } from '@/lib/report-layout'
import { canCollapseSection } from '@/lib/weld-table-section-state'

type WeldTableSectionToolbarProps = {
  sections: Array<{ section: string; fields: WeldField[] }>
  extraColumns: WeldTableExtraColumn[]
  collapsedSections: ReadonlySet<string>
  alwaysVisibleFieldKeys: ReadonlySet<string>
  stickyLeft: number
  onToggleSection: (section: string) => void
  viewControls?: ReactNode
}

export function WeldTableSectionToolbar({
  sections,
  extraColumns,
  collapsedSections,
  alwaysVisibleFieldKeys,
  stickyLeft,
  onToggleSection,
  viewControls,
}: WeldTableSectionToolbarProps) {
  const controls = getSectionControls(sections, extraColumns)
  const toolbarWidth = getReportViewportWidth(stickyLeft)
  const sectionStripRef = useRef<HTMLDivElement | null>(null)
  const [sectionScrollState, setSectionScrollState] = useState({ canScrollLeft: false, canScrollRight: false })
  const sectionStripMask = getSectionStripMask(sectionScrollState)
  const updateSectionScrollState = useCallback(() => {
    const strip = sectionStripRef.current
    if (!strip) return
    const maxScrollLeft = Math.max(0, strip.scrollWidth - strip.clientWidth)
    const nextState = {
      canScrollLeft: strip.scrollLeft > 4,
      canScrollRight: strip.scrollLeft < maxScrollLeft - 4,
    }
    setSectionScrollState((current) =>
      current.canScrollLeft === nextState.canScrollLeft && current.canScrollRight === nextState.canScrollRight
        ? current
        : nextState,
    )
  }, [])

  useEffect(() => {
    const strip = sectionStripRef.current
    if (!strip) return undefined
    updateSectionScrollState()
    strip.addEventListener('scroll', updateSectionScrollState, { passive: true })
    window.addEventListener('resize', updateSectionScrollState)
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateSectionScrollState)
    resizeObserver?.observe(strip)
    return () => {
      strip.removeEventListener('scroll', updateSectionScrollState)
      window.removeEventListener('resize', updateSectionScrollState)
      resizeObserver?.disconnect()
    }
  }, [controls.length, updateSectionScrollState])

  const scrollSections = (direction: -1 | 1) => {
    const strip = sectionStripRef.current
    if (!strip) return
    strip.scrollBy({
      left: direction * Math.max(240, strip.clientWidth * 0.72),
      behavior: 'smooth',
    })
  }

  return (
    <div
      data-report-section-toolbar
      className="sticky z-20 grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 overflow-hidden rounded-md border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-sm shadow-slate-200/30 backdrop-blur"
      style={{ left: stickyLeft, width: toolbarWidth, maxWidth: toolbarWidth }}
    >
      <span className="inline-flex h-7 items-center gap-1.5 text-xs font-semibold text-slate-600">
        <Columns3 className="h-3.5 w-3.5 text-slate-400" />
        Разделы
      </span>
      <div className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center gap-1">
        <button
          type="button"
          onClick={() => scrollSections(-1)}
          disabled={!sectionScrollState.canScrollLeft}
          aria-label="Показать предыдущие разделы"
          title="Показать предыдущие разделы"
          className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:pointer-events-none disabled:opacity-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div
          ref={sectionStripRef}
          data-report-section-strip
          className="min-w-0 snap-x snap-proximity overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={sectionStripMask
            ? { maskImage: sectionStripMask, WebkitMaskImage: sectionStripMask }
            : undefined}
        >
          <div className="flex w-max items-center gap-1.5 px-0.5">
          {controls.map((group) => {
            const isExtra = group.kind === 'extra'
            const canCollapse = isExtra
              ? group.columns.some((column) => column.collapsible)
              : canCollapseSection(group.fields, alwaysVisibleFieldKeys)
            const collapsed = canCollapse && collapsedSections.has(group.section)
            const fieldCount = isExtra ? group.columns.length : group.fields.length
            const visibleCount = collapsed
              ? isExtra
                ? 0
                : group.fields.filter((field) => alwaysVisibleFieldKeys.has(field.key)).length
              : fieldCount

            return (
              <button
                key={group.section}
                type="button"
                onClick={() => onToggleSection(group.section)}
                disabled={!canCollapse}
                className={`inline-flex h-7 shrink-0 snap-start items-center gap-1.5 rounded border px-2 text-xs font-medium transition-colors ${
                  !canCollapse
                    ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400'
                    : collapsed
                      ? 'border-transparent bg-transparent text-slate-400 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-600'
                      : 'border-sky-200 bg-sky-50/60 text-slate-800 hover:bg-sky-50'
                }`}
                title={!canCollapse ? 'Обязательные поля всегда показаны' : collapsed ? 'Раскрыть раздел' : 'Скрыть раздел'}
              >
                {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {getSectionTitle(group.section)}
                <span className={`rounded px-1 py-0.5 text-[10px] leading-none ${collapsed ? 'bg-slate-100 text-slate-400' : 'bg-white text-sky-700'}`}>
                  {visibleCount}/{fieldCount}
                </span>
              </button>
            )
          })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => scrollSections(1)}
          disabled={!sectionScrollState.canScrollRight}
          aria-label="Показать следующие разделы"
          title="Показать следующие разделы"
          className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:pointer-events-none disabled:opacity-0"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      {viewControls ? (
        <div data-report-view-controls-slot className="shrink-0 border-l border-slate-200 pl-2">
          {viewControls}
        </div>
      ) : null}
    </div>
  )
}

function getSectionStripMask({
  canScrollLeft,
  canScrollRight,
}: {
  canScrollLeft: boolean
  canScrollRight: boolean
}) {
  if (canScrollLeft && canScrollRight) {
    return 'linear-gradient(to right, transparent, black 2.25rem, black calc(100% - 2.25rem), transparent)'
  }
  if (canScrollLeft) {
    return 'linear-gradient(to right, transparent, black 2.25rem)'
  }
  if (canScrollRight) {
    return 'linear-gradient(to right, black calc(100% - 2.25rem), transparent)'
  }
  return undefined
}

type SectionControl =
  | { kind: 'fields'; section: string; fields: WeldField[] }
  | { kind: 'extra'; section: string; columns: WeldTableExtraColumn[] }

function getSectionControls(
  sections: Array<{ section: string; fields: WeldField[] }>,
  extraColumns: WeldTableExtraColumn[],
): SectionControl[] {
  const extraGroups = groupCollapsibleExtraColumns(extraColumns)
  const sectionNames = new Set(sections.map((section) => section.section))
  const controls: SectionControl[] = []

  for (const section of sections) {
    controls.push(
      ...extraGroups.filter((group) => group.insertBeforeSection === section.section),
      { kind: 'fields', ...section },
      ...extraGroups.filter((group) => group.insertAfterSection === section.section),
    )
  }
  controls.push(
    ...extraGroups.filter((group) => {
      const anchorSection = group.insertBeforeSection ?? group.insertAfterSection
      return !anchorSection || !sectionNames.has(anchorSection)
    }),
  )
  return controls
}

function groupCollapsibleExtraColumns(columns: WeldTableExtraColumn[]) {
  const groups = new Map<string, Extract<SectionControl, { kind: 'extra' }> & {
    insertBeforeSection?: string
    insertAfterSection?: string
  }>()
  for (const column of columns) {
    if (!column.collapsible) continue
    const group = groups.get(column.section)
    if (group) {
      group.columns.push(column)
    } else {
      groups.set(column.section, {
        kind: 'extra',
        section: column.section,
        columns: [column],
        insertBeforeSection: column.insertBeforeSection,
        insertAfterSection: column.insertAfterSection,
      })
    }
  }
  return [...groups.values()]
}

function getSectionTitle(section: string) {
  return section === 'Контроль' ? 'Назначение' : section
}
