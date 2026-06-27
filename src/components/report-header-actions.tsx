import type { RefObject } from 'react'
import { ChevronDown, ClipboardCheck, FileSpreadsheet, Plus, ShieldCheck, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ActiveReport } from '@/lib/home-state'

export type ReportHeaderActionsProps = {
  activeReport: ActiveReport
  fileInputRef: RefObject<HTMLInputElement | null>
  onImportFile: (file: File) => void
  onExportXlsx: () => void
  onCreateWeldJoint: () => void
  importDisabled: boolean
  onCreatePstoRequest: () => void
  pstoRequestPending: boolean
  onAddPstoResult: () => void
  pstoResultDisabled: boolean
  isPstoShowMenuOpen: boolean
  onTogglePstoShowMenu: () => void
  onOpenPstoWaitingRequestReport: () => void
  onOpenPstoResultsReport: () => void
  onCreateLnkRequest: () => void
  lnkRequestPending: boolean
  onAddLnkResult: () => void
  lnkResultDisabled: boolean
  onOpenLnkOfficiality: () => void
  lnkOfficialityPending: boolean
  isLnkShowMenuOpen: boolean
  onToggleLnkShowMenu: () => void
  onOpenLnkToRequestReport: () => void
  onOpenLnkWaitingNkReport: () => void
  onOpenLnkConclusionsReport: () => void
}

export function ReportHeaderActions({
  activeReport,
  fileInputRef,
  onImportFile,
  onExportXlsx,
  onCreateWeldJoint,
  importDisabled,
  onCreatePstoRequest,
  pstoRequestPending,
  onAddPstoResult,
  pstoResultDisabled,
  isPstoShowMenuOpen,
  onTogglePstoShowMenu,
  onOpenPstoWaitingRequestReport,
  onOpenPstoResultsReport,
  onCreateLnkRequest,
  lnkRequestPending,
  onAddLnkResult,
  lnkResultDisabled,
  onOpenLnkOfficiality,
  lnkOfficialityPending,
  isLnkShowMenuOpen,
  onToggleLnkShowMenu,
  onOpenLnkToRequestReport,
  onOpenLnkWaitingNkReport,
  onOpenLnkConclusionsReport,
}: ReportHeaderActionsProps) {
  return (
    <div className="flex flex-wrap gap-2 lg:pt-0.5">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onImportFile(file)
          event.currentTarget.value = ''
        }}
      />
      {activeReport === 'heatTreatment' ? (
        <>
          <Button onClick={onCreatePstoRequest} disabled={pstoRequestPending}>
            <Plus className="mr-2 h-4 w-4" />
            Заявка
          </Button>
          <Button onClick={onAddPstoResult} disabled={pstoResultDisabled}>
            <ClipboardCheck className="mr-2 h-4 w-4" />
            Результат
          </Button>
          <div className="relative">
            <Button variant="outline" onClick={onTogglePstoShowMenu}>
              Показать
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
            {isPstoShowMenuOpen ? (
              <div className="absolute right-0 z-50 mt-2 w-56 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
                <button
                  type="button"
                  onClick={onOpenPstoWaitingRequestReport}
                  className="flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm font-semibold leading-5 text-slate-900 hover:bg-sky-50 hover:text-sky-900"
                >
                  Ожидает заявку ПСТО
                </button>
                <button
                  type="button"
                  onClick={onOpenPstoResultsReport}
                  className="flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm font-semibold leading-5 text-slate-900 hover:bg-sky-50 hover:text-sky-900"
                >
                  Результаты ПСТО
                </button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
      {activeReport === 'lnk' ? (
        <>
          <Button onClick={onCreateLnkRequest} disabled={lnkRequestPending}>
            <Plus className="mr-2 h-4 w-4" />
            Заявка
          </Button>
          <Button onClick={onAddLnkResult} disabled={lnkResultDisabled}>
            <ClipboardCheck className="mr-2 h-4 w-4" />
            Результат
          </Button>
          <Button variant="outline" onClick={onOpenLnkOfficiality} disabled={lnkOfficialityPending}>
            <ShieldCheck className="mr-2 h-4 w-4" />
            Официальность
          </Button>
          <div className="relative">
            <Button variant="outline" onClick={onToggleLnkShowMenu}>
              Показать
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
            {isLnkShowMenuOpen ? (
              <div className="absolute right-0 z-50 mt-2 w-52 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
                <button
                  type="button"
                  onClick={onOpenLnkToRequestReport}
                  className="flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm font-semibold leading-5 text-slate-900 hover:bg-sky-50 hover:text-sky-900"
                >
                  Ожидание заявки
                </button>
                <button
                  type="button"
                  onClick={onOpenLnkWaitingNkReport}
                  className="flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm font-semibold leading-5 text-slate-900 hover:bg-sky-50 hover:text-sky-900"
                >
                  Ожидание НК
                </button>
                <button
                  type="button"
                  onClick={onOpenLnkConclusionsReport}
                  className="flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm font-semibold leading-5 text-slate-900 hover:bg-sky-50 hover:text-sky-900"
                >
                  Показать заключения
                </button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
      {activeReport === 'weldingJournal' ? (
        <Button onClick={onCreateWeldJoint}>
          <Plus className="mr-2 h-4 w-4" />
          Новый стык
        </Button>
      ) : null}
      {activeReport === 'weldingJournal' ? (
        <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importDisabled}>
          <Upload className="mr-2 h-4 w-4" />
          Импорт
        </Button>
      ) : null}
      {activeReport !== 'welderStamps' ? (
        <Button variant="outline" onClick={onExportXlsx}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Excel
        </Button>
      ) : null}
    </div>
  )
}
