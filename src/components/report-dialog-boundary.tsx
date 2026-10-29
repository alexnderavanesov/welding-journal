import { Component, type ReactNode } from 'react'
import { LargeDialogShell } from './large-dialog-shell'
import { DialogHeader } from './dialog-header'
import { Button } from './ui/button'
import { retryAppModules } from '@/lib/app-module-retry'

/** A lazy dialog can fail after deployment or a network interruption. Keep
 * that failure local: the route's recovery would reload the whole journal. */
export class ReportDialogBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <LargeDialogShell ariaLabel="Не удалось открыть окно" maxWidthClassName="max-w-xl">
      <DialogHeader title="Не удалось открыть окно" onClose={this.props.onClose} />
      <p className="px-6 py-4 text-sm text-slate-600" role="alert">Таблица остаётся открытой. Проверьте соединение. Если окно не открывается повторно, обновите страницу. При обновлении страницы несохранённые изменения будут потеряны.</p>
      <div className="flex justify-end gap-3 px-6 pb-5">
        <Button variant="outline" onClick={this.props.onClose}>Закрыть</Button>
        <Button onClick={event => { event.currentTarget.disabled = true; void retryAppModules() }}>Обновить страницу</Button>
      </div>
    </LargeDialogShell>
  }
}
