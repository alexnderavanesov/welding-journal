import {
  BarChart3,
  ClipboardCheck,
  FileText,
  Thermometer,
  ClipboardList,
  PanelLeftClose,
  PanelLeftOpen,
  ListTree,
  Settings,
  BookUser,
} from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { ScrollToTopButton } from '@/components/scroll-to-top-button'
import type { ActiveReport } from '@/lib/home-state'
import { useAccess } from '@/lib/security-context'
import { REPORT_ACCESS_AREAS, type Permission } from '@/lib/access-permissions'
import './app-sidebar.css'

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
  { report: 'heatTreatment', label: 'ПСТО и ТВМТ', icon: Thermometer },
  { report: 'lnk', label: 'ЛНК', icon: ClipboardCheck },
  { report: 'welderStamps', label: 'Справочники', icon: BookUser },
  { report: 'statistics', label: 'Статистика', icon: BarChart3 },
  { report: 'documents', label: 'Документы', icon: FileText },
]

export function AppSidebar({ activeReport, collapsed, onCollapsedChange, onReportChange }: AppSidebarProps) {
  const { can, identity } = useAccess()
  const settingsVisible = ['templates', 'checks', 'dispatcher', 'exceptions', 'numbering', 'data', 'wdi', 'processes', 'indexes'].some(area => can(`${area}.view` as Permission))
  const sidebarRef = useRef<HTMLElement>(null)
  const [isHorizontallyScrolled, setIsHorizontallyScrolled] = useState(false)
  const settingsItem = { report: 'settings' as const, label: 'Настройки', icon: Settings }
  const itemClassName = (isActive: boolean, muted = false) =>
    `app-sidebar-item flex items-center text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${
      isActive
        ? 'bg-sky-50 text-sky-700'
        : muted
          ? 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'
          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
    } ${collapsed ? 'rounded-xl' : 'rounded-lg'}`

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current
    if (!sidebar) return

    let correction = Number.parseFloat(sidebar.style.getPropertyValue('--sidebar-viewport-x')) || 0
    let frameId: number | null = null
    let delayedAlignmentId: number | null = null
    let lastPageX = window.scrollX, lastViewportX = window.visualViewport?.offsetLeft ?? 0

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
    const onPageScroll = () => {
      if (!['weldingJournal', 'lnk', 'heatTreatment', 'documents'].includes(activeReport)) { scheduleAlignment(); return }
      // The journal contains horizontal table scrolling. A vertical page scroll
      // does not change the sidebar's horizontal position.
      // Avoid forcing layout after AG has just committed new virtual rows.
      const pageX = window.scrollX, viewportX = window.visualViewport?.offsetLeft ?? 0
      if (pageX === lastPageX && viewportX === lastViewportX) return
      lastPageX = pageX; lastViewportX = viewportX
      scheduleAlignment()
    }

    alignToViewport()
    window.addEventListener('scroll', onPageScroll, { passive: true })
    window.addEventListener('resize', scheduleAlignment)
    window.visualViewport?.addEventListener('scroll', onPageScroll, { passive: true })
    window.visualViewport?.addEventListener('resize', scheduleAlignment)
    sidebar.addEventListener('scroll', scheduleAlignment, { passive: true })
    delayedAlignmentId = window.setTimeout(scheduleAlignment, 300)
    return () => {
      window.removeEventListener('scroll', onPageScroll)
      window.removeEventListener('resize', scheduleAlignment)
      window.visualViewport?.removeEventListener('scroll', onPageScroll)
      window.visualViewport?.removeEventListener('resize', scheduleAlignment)
      sidebar.removeEventListener('scroll', scheduleAlignment)
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      if (delayedAlignmentId !== null) window.clearTimeout(delayedAlignmentId)
    }
  }, [activeReport, collapsed])

  const sidebar = (
    <aside
      ref={sidebarRef}
      className={`app-sidebar fixed inset-y-0 left-0 z-30 flex h-screen flex-col overflow-x-clip border-r border-slate-100 bg-white py-5 [backface-visibility:hidden] ${
        isHorizontallyScrolled ? 'shadow-[10px_0_24px_-20px_rgba(15,23,42,0.7)]' : ''
      } ${
        collapsed ? 'w-16' : 'w-48 lg:w-64'
      }`}
      data-app-sidebar="true"
      data-collapsed={collapsed}
      style={{ transform: 'translate3d(var(--sidebar-viewport-x, 0px), 0, 0)' }}
    >
      <div className="app-sidebar-header mb-3 shrink-0">
        <div className="app-sidebar-brand text-lg font-semibold tracking-tight">Сварка</div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCollapsedChange(!collapsed)}
          aria-label={collapsed ? 'Раскрыть меню' : 'Скрыть меню'}
          title={collapsed ? 'Раскрыть меню' : 'Скрыть меню'}
          className="app-sidebar-toggle h-9 w-9 shrink-0"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>
      <nav className="min-h-0 space-y-2 overflow-y-auto py-1" aria-label="Разделы программы">
        {sidebarItems.filter(item => can(`${REPORT_ACCESS_AREAS[item.report]}.view` as Permission)).map((item) => {
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
              <Icon className="app-sidebar-icon h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span className="app-sidebar-label"><span>{item.label}</span></span>
            </button>
          )
        })}
      </nav>
      <div className="mb-3 mt-auto h-10 shrink-0">
        <ScrollToTopButton resetKey={activeReport} />
      </div>
      <nav className="shrink-0 space-y-2 border-t border-slate-100 pb-7 pt-3 lg:pb-10" aria-label="Настройки и профиль">
        {(() => {
          if (!settingsVisible) return null
          const Icon = settingsItem.icon
          const isActive = activeReport === settingsItem.report && (typeof window === 'undefined' || !['/account', '/activity'].includes(window.location.pathname))
          return (
            <button
              key={settingsItem.report}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              className={itemClassName(isActive)}
              onClick={() => onReportChange(settingsItem.report)}
              title={settingsItem.label}
            >
              <Icon className="app-sidebar-icon h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span className="app-sidebar-label"><span>{settingsItem.label}</span></span>
            </button>
          )
        })()}
        <a href="/account" title="Мой профиль" className={itemClassName(typeof window !== 'undefined' && ['/account', '/activity', '/user-guide'].includes(window.location.pathname))}>
          <BookUser className="app-sidebar-icon h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" /><span className="app-sidebar-label"><span><span className="block">{identity?.name ?? 'Мой профиль'}</span>{identity?.title ? <span className="block text-[11px] font-normal opacity-70">{identity.title}</span> : null}<span className="block text-[11px] font-normal">Мой профиль</span></span></span>
        </a>
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
