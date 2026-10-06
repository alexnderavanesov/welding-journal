import {
  BarChart3,
  BookOpenText,
  ClipboardCheck,
  FileText,
  Flame,
  ClipboardList,
  PanelLeftClose,
  PanelLeftOpen,
  ListTree,
  Settings,
  Stamp,
} from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import type { ActiveReport } from '@/lib/home-state'

type AppSidebarProps = {
  activeReport: ActiveReport
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onReportChange: (report: ActiveReport) => void
}

const sidebarItems: Array<{
  report: ActiveReport
  label: string
  icon: typeof ClipboardList
}> = [
  { report: 'weldingJournal', label: 'Сварочный журнал', icon: ClipboardList },
  { report: 'percentageLines', label: 'Программа линий', icon: ListTree },
  { report: 'heatTreatment', label: 'ПСТО и ТВМТ', icon: Flame },
  { report: 'lnk', label: 'ЛНК', icon: ClipboardCheck },
  { report: 'welderStamps', label: 'Клейма', icon: Stamp },
  { report: 'statistics', label: 'Статистика', icon: BarChart3 },
  { report: 'documents', label: 'Документы', icon: FileText },
]

export function AppSidebar({ activeReport, collapsed, onCollapsedChange, onReportChange }: AppSidebarProps) {
  const sidebarRef = useRef<HTMLElement>(null)
  const [isHorizontallyScrolled, setIsHorizontallyScrolled] = useState(false)
  const settingsItem = { report: 'settings' as const, label: 'Настройки', icon: Settings }
  const guideItem = { report: 'userGuide' as const, label: 'Руководство пользователя', icon: BookOpenText }
  const itemClassName = (isActive: boolean, muted = false) =>
    `flex items-center gap-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${
      isActive
        ? 'bg-sky-50 text-sky-700'
        : muted
          ? 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'
          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
    } ${collapsed ? 'mx-auto h-10 w-10 shrink-0 justify-center rounded-xl p-0' : 'w-full rounded-lg px-3 py-2.5'}`

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current
    if (!sidebar) return

    let correction = Number.parseFloat(sidebar.style.getPropertyValue('--sidebar-viewport-x')) || 0
    let frameId: number | null = null
    let delayedAlignmentId: number | null = null

    const alignToViewport = () => {
      frameId = null
      setIsHorizontallyScrolled(getHorizontalPageOffset() > 1)
      if (sidebar.scrollLeft !== 0) sidebar.scrollLeft = 0
      const nextCorrection = getSidebarViewportCorrection(correction, sidebar.getBoundingClientRect().left)
      if (Math.abs(nextCorrection - correction) < 0.5) return
      correction = nextCorrection
      sidebar.style.setProperty('--sidebar-viewport-x', `${correction}px`)
    }

    const scheduleAlignment = () => {
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(alignToViewport)
    }

    alignToViewport()
    window.addEventListener('scroll', scheduleAlignment, { passive: true })
    window.addEventListener('resize', scheduleAlignment)
    window.visualViewport?.addEventListener('scroll', scheduleAlignment, { passive: true })
    window.visualViewport?.addEventListener('resize', scheduleAlignment)
    sidebar.addEventListener('scroll', scheduleAlignment, { passive: true })
    delayedAlignmentId = window.setTimeout(scheduleAlignment, 300)
    return () => {
      window.removeEventListener('scroll', scheduleAlignment)
      window.removeEventListener('resize', scheduleAlignment)
      window.visualViewport?.removeEventListener('scroll', scheduleAlignment)
      window.visualViewport?.removeEventListener('resize', scheduleAlignment)
      sidebar.removeEventListener('scroll', scheduleAlignment)
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      if (delayedAlignmentId !== null) window.clearTimeout(delayedAlignmentId)
    }
  }, [activeReport, collapsed])

  const sidebar = (
    <aside
      ref={sidebarRef}
      className={`fixed inset-y-0 left-0 z-30 flex h-screen flex-col overflow-x-clip border-r border-slate-100 bg-white px-3 py-5 transition-[width,box-shadow] duration-200 [backface-visibility:hidden] ${
        isHorizontallyScrolled ? 'shadow-[10px_0_24px_-20px_rgba(15,23,42,0.7)]' : ''
      } ${
        collapsed ? 'w-16' : 'w-48 lg:w-64 lg:px-4'
      }`}
      data-app-sidebar="true"
      style={{ transform: 'translate3d(var(--sidebar-viewport-x, 0px), 0, 0)' }}
    >
      <div className={`mb-3 flex shrink-0 items-start ${collapsed ? 'justify-center [&>div]:sr-only' : 'justify-between gap-3'}`}>
        <div className="text-lg font-semibold tracking-tight">Сварка</div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCollapsedChange(!collapsed)}
          aria-label={collapsed ? 'Раскрыть меню' : 'Скрыть меню'}
          title={collapsed ? 'Раскрыть меню' : 'Скрыть меню'}
          className="h-9 w-9 shrink-0"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>
      <nav className="min-h-0 space-y-2 overflow-y-auto py-1" aria-label="Разделы программы">
        {sidebarItems.map((item) => {
          const Icon = item.icon
          const isActive = activeReport === item.report
          return (
            <button
              key={item.report}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              className={itemClassName(isActive)}
              onClick={() => onReportChange(item.report)}
              title={item.label}
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span className={collapsed ? 'sr-only' : ''}>{item.label}</span>
            </button>
          )
        })}
      </nav>
      <nav className="mt-auto shrink-0 space-y-2 border-t border-slate-100 pb-7 pt-3 lg:pb-10" aria-label="Настройки и помощь">
        {(() => {
          const Icon = settingsItem.icon
          const isActive = activeReport === settingsItem.report
          return (
            <button
              key={settingsItem.report}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              className={itemClassName(isActive)}
              onClick={() => onReportChange(settingsItem.report)}
              title={settingsItem.label}
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span className={collapsed ? 'sr-only' : ''}>{settingsItem.label}</span>
            </button>
          )
        })()}
        {(() => {
          const Icon = guideItem.icon
          const isActive = activeReport === guideItem.report
          return (
            <button
              key={guideItem.report}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              className={itemClassName(isActive, true)}
              onClick={() => onReportChange(guideItem.report)}
              title={guideItem.label}
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span className={collapsed ? 'sr-only' : ''}>{guideItem.label}</span>
            </button>
          )
        })()}
      </nav>
    </aside>
  )

  return typeof document === 'undefined' ? sidebar : createPortal(sidebar, document.body)
}

export function getSidebarViewportCorrection(currentCorrection: number, renderedLeft: number) {
  return currentCorrection - renderedLeft
}

function getHorizontalPageOffset() {
  return Math.max(
    Math.abs(window.scrollX),
    Math.abs(document.documentElement.scrollLeft),
    Math.abs(document.body.scrollLeft),
  )
}
