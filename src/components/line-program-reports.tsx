import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getLineProgramReport } from '@/server/line-program-report'
import type { PrintableReport } from '@/lib/printable-report'
import { ReportShowMenu } from './report-show-menu'
import { PrintableReportPreview } from './printable-report-preview'

export function LineProgramReports({ ids, context, disabled, children }: { ids: number[]; context: string; disabled: boolean; children?: ReactNode }) {
  const [host, setHost] = useState<Element | null>(null)
  const [menuOpen, setMenuOpen] = useState(false), [previewOpen, setPreviewOpen] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [report, setReport] = useState<PrintableReport | null>(null)
  const menu = useRef<HTMLDivElement>(null), generation = useRef(0)
  const mode = useRef<'lines' | 'stamps'>('lines')
  useEffect(() => { setHost(document.querySelector('[data-line-program-report-actions]')); return () => { generation.current += 1 } }, [])
  useEffect(() => {
    if (!menuOpen) return
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setMenuOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); menu.current?.querySelector('button')?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [menuOpen])
  const close = useCallback(() => {
    generation.current += 1
    setPreviewOpen(false); setBusy(false); setReport(null); setError('')
    requestAnimationFrame(() => menu.current?.querySelector('button')?.focus())
  }, [])
  const open = async (nextMode: 'lines' | 'stamps') => {
    if (busy) return
    const request = ++generation.current
    mode.current = nextMode
    setMenuOpen(false); setPreviewOpen(true); setReport(null); setBusy(true); setError('')
    try {
      const result = await getLineProgramReport({ data: { ids, mode: nextMode, context } })
      if (request === generation.current) setReport(result)
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : 'Не удалось подготовить сводку. Повторите действие.')
    } finally { if (request === generation.current) setBusy(false) }
  }
  const control = <div className="flex flex-wrap items-center gap-2"><div ref={menu} className="inline-block align-middle" title="Просмотр и печать по всем страницам текущего отбора">
    <ReportShowMenu isOpen={menuOpen} onToggle={() => setMenuOpen(value => !value)} disabled={disabled || busy}
      buttonClassName="h-10 text-sm" items={[
        { label: 'Сводка по линиям', onClick: () => { void open('lines') } },
        { label: 'Сводка по клеймам', onClick: () => { void open('stamps') } },
      ]} />
  </div>{children}</div>
  return <>{host ? createPortal(control, host) : control}{previewOpen ? <PrintableReportPreview report={report} busy={busy} error={error} onClose={close} onRetry={() => { void open(mode.current) }} /> : null}</>
}
