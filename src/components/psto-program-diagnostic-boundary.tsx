import { Component, useEffect, type ReactNode } from 'react'
import { LargeDialogShell } from './large-dialog-shell'
import { DialogHeader } from './dialog-header'
import { readPstoProgramDiagnostics, tracePstoProgram } from '@/lib/psto-program-diagnostics'

export function PstoProgramDiagnostics() {
  return <details className="m-4 text-xs text-slate-600">
    <summary>Техническая диагностика открытия ПСТО</summary>
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{JSON.stringify(readPstoProgramDiagnostics(), null, 2)}</pre>
  </details>
}

export function PstoProgramLoading({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return <LargeDialogShell ariaLabel="Загрузка программы ПСТО">
    <DialogHeader title="Загрузка программы ПСТО" onClose={onClose} />
    <p className="p-4" role="status">Загружается окно. Его можно закрыть без изменения данных.</p>
  </LargeDialogShell>
}

function OpeningTrace({ open }: { open: boolean }) {
  useEffect(() => {
    if (!open) return
    tracePstoProgram('open')
    return () => tracePstoProgram('close')
  }, [open])
  return null
}

type BoundaryProps = {
  open: boolean; onClose: () => void; children: ReactNode
}

export function PstoProgramDiagnosticBoundary(props: BoundaryProps) {
  // Keep the lifecycle recorder outside the subtree replaced on an error.
  // A visible error view is still open, not a user closing the dialog.
  return <><OpeningTrace open={props.open} /><PstoProgramErrorBoundary {...props} /></>
}

class PstoProgramErrorBoundary extends Component<BoundaryProps, { error: unknown }> {
  state: { error: unknown } = { error: null }
  static getDerivedStateFromError(error: unknown) { return { error } }
  componentDidCatch(error: unknown) {
    if (this.props.open) {
      tracePstoProgram('render-error', error)
      this.setState({ error }) // Include the just-recorded failure in the visible snapshot.
    }
  }
  render() {
    if (this.state.error) {
      if (!this.props.open) throw this.state.error // This boundary is only for opening the line program.
      return <LargeDialogShell ariaLabel="Не удалось открыть программу ПСТО">
        <DialogHeader title="Не удалось открыть программу ПСТО" onClose={this.props.onClose} />
        <p className="px-4" role="alert">Закройте окно. Если повторное открытие не помогает, сохраните диагностику ниже и обновите страницу. Автоматических изменений данных или перезагрузки не было.</p>
        <PstoProgramDiagnostics />
      </LargeDialogShell>
    }
    return this.props.children
  }
}
