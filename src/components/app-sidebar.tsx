import {
  BarChart3,
  BookOpenText,
  ClipboardCheck,
  FileText,
  Flame,
  NotebookTabs,
  PanelLeftClose,
  PanelLeftOpen,
  Percent,
  Settings,
  Stamp,
} from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
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
  icon: typeof NotebookTabs
}> = [
  { report: 'weldingJournal', label: 'Сварочный журнал', icon: NotebookTabs },
  { report: 'heatTreatment', label: 'Термообработка', icon: Flame },
  { report: 'lnk', label: 'ЛНК', icon: ClipboardCheck },
  { report: 'welderStamps', label: 'Клейма', icon: Stamp },
  { report: 'percentageLines', label: 'Процентные линии', icon: Percent },
  { report: 'statistics', label: 'Статистика', icon: BarChart3 },
  { report: 'documents', label: 'Документы', icon: FileText },
]

export function AppSidebar({ activeReport, collapsed, onCollapsedChange, onReportChange }: AppSidebarProps) {
  const sidebarRef = useRef<HTMLElement>(null)
  const settingsItem = { report: 'settings' as const, label: 'Настройки', icon: Settings }
  const guideItem = { report: 'userGuide' as const, label: 'Руководство пользователя', icon: BookOpenText }
  const itemClassName = (isActive: boolean, muted = false) =>
    `flex items-center gap-2 rounded-md text-left text-sm font-medium transition-colors ${
      isActive
        ? muted
          ? 'bg-slate-100 text-slate-950'
          : 'bg-primary text-primary-foreground'
        : muted
          ? 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
    } ${collapsed ? 'mx-auto h-10 w-10 shrink-0 justify-center p-0' : 'w-full px-3 py-2'}`

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current
    if (!sidebar) return

    let correction = Number.parseFloat(sidebar.style.getPropertyValue('--sidebar-viewport-x')) || 0
    let frameId: number | null = null
    let delayedAlignmentId: number | null = null

    const alignToViewport = () => {
      frameId = null
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
      className={`fixed inset-y-0 left-0 z-30 flex h-screen flex-col overflow-x-clip border-r border-slate-100 bg-white px-3 py-5 transition-[width] duration-200 [backface-visibility:hidden] ${
        collapsed ? 'w-16' : 'w-48 lg:w-64 lg:px-4'
      }`}
      data-app-sidebar="true"
      style={{ transform: 'translate3d(var(--sidebar-viewport-x, 0px), 0, 0)' }}
    >
      <div className={`mb-3 flex items-start ${collapsed ? 'justify-center [&>div]:sr-only' : 'justify-between gap-3'}`}>
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
      <nav className="space-y-1">
        {sidebarItems.map((item) => {
          const Icon = item.icon
          const isActive = activeReport === item.report
          return (
            <button
              key={item.report}
              className={itemClassName(isActive)}
              onClick={() => onReportChange(item.report)}
              title={item.label}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className={collapsed ? 'sr-only' : ''}>{item.label}</span>
            </button>
          )
        })}
      </nav>
      <nav className="mt-auto space-y-1 border-t border-slate-100 pb-7 pt-3 lg:pb-10">
        {(() => {
          const Icon = settingsItem.icon
          const isActive = activeReport === settingsItem.report
          return (
            <button
              key={settingsItem.report}
              className={itemClassName(isActive)}
              onClick={() => onReportChange(settingsItem.report)}
              title={settingsItem.label}
            >
              <Icon className="h-4 w-4 shrink-0" />
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
              className={itemClassName(isActive, true)}
              onClick={() => onReportChange(guideItem.report)}
              title={guideItem.label}
            >
              <Icon className="h-4 w-4 shrink-0" />
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
