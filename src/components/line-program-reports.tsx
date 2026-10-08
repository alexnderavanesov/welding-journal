import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getLineProgramReport } from '@/server/line-program-report'
import type { PrintableReport } from '@/lib/printable-report'
import type { ProgramReportRequest } from '@/lib/line-program-report'
import { ReportShowMenu } from './report-show-menu'
import { PrintableReportPreview } from './printable-report-preview'

export type LineProgramReportsHandle = { open: (request: ProgramReportRequest) => void }
export const LineProgramReports = forwardRef<LineProgramReportsHandle, { ids: number[]; context: string; disabled: boolean; children?: ReactNode }>(function LineProgramReports({ ids, context, disabled, children }, ref) {
  const [host, setHost] = useState<Element | null>(null)
  const [menuOpen, setMenuOpen] = useState(false), [previewOpen, setPreviewOpen] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [report, setReport] = useState<PrintableReport | null>(null)
  const menu = useRef<HTMLDivElement>(null), generation = useRef(0)
  const selection = useRef<ProgramReportRequest | null>(null), returnFocus = useRef<HTMLElement | null>(null)
  const pending = useRef(false)
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
    pending.current = false
    setPreviewOpen(false); setBusy(false); setReport(null); setError('')
    const target = returnFocus.current
    requestAnimationFrame(() => (target?.isConnected ? target : menu.current?.querySelector('button'))?.focus({ preventScroll: true }))
  }, [])
  const open = async (data: ProgramReportRequest, retry = false, target: HTMLElement | null = menu.current?.querySelector('button') ?? null) => {
    if (pending.current) return
    pending.current = true
    const request = ++generation.current
    selection.current = { ...data, ids: [...data.ids] }
    if (!retry) returnFocus.current = target
    setMenuOpen(false); setPreviewOpen(true); setReport(null); setBusy(true); setError('')
    try {
      const result = await getLineProgramReport({ data: selection.current })
      if (request === generation.current) setReport(result)
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : 'Не удалось подготовить сводку. Повторите действие.')
    } finally { if (request === generation.current) { pending.current = false; setBusy(false) } }
  }
  useImperativeHandle(ref, () => ({ open: data => { void open(data, false, document.activeElement instanceof HTMLElement ? document.activeElement : null) } }))
  const control = <div className="flex flex-wrap items-center gap-2"><div ref={menu} className="inline-block align-middle" title="Просмотр и печать по всем страницам текущего отбора">
    <ReportShowMenu isOpen={menuOpen} onToggle={() => setMenuOpen(value => !value)} disabled={disabled || busy}
      buttonClassName="h-10 text-sm" items={[
        { label: 'Сводка по линиям', onClick: () => { void open({ ids, mode: 'lines', context }) } },
        { label: 'Сводка по клеймам', onClick: () => { void open({ ids, mode: 'stamps', context }) } },
      ]} />
  </div>{children}</div>
  return <>{host ? createPortal(control, host) : control}{previewOpen ? <PrintableReportPreview report={report} busy={busy} error={error} onClose={close} onRetry={() => { if (selection.current) void open(selection.current, true) }} /> : null}</>
})
