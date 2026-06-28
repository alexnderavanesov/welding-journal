import { ClipboardCheck, Plus, ShieldCheck } from 'lucide-react'
import { ReportShowMenu } from '@/components/report-show-menu'
import { Button } from '@/components/ui/button'

type HeatTreatmentHeaderActionsProps = {
  onCreateRequest: () => void
  requestPending: boolean
  onAddResult: () => void
  resultDisabled: boolean
  isShowMenuOpen: boolean
  onToggleShowMenu: () => void
  onOpenWaitingRequestReport: () => void
  onOpenResultsReport: () => void
}

export function HeatTreatmentHeaderActions({
  onCreateRequest,
  requestPending,
  onAddResult,
  resultDisabled,
  isShowMenuOpen,
  onToggleShowMenu,
  onOpenWaitingRequestReport,
  onOpenResultsReport,
}: HeatTreatmentHeaderActionsProps) {
  return (
    <>
      <Button onClick={onCreateRequest} disabled={requestPending}>
        <Plus className="mr-2 h-4 w-4" />
        Заявка
      </Button>
      <Button onClick={onAddResult} disabled={resultDisabled}>
        <ClipboardCheck className="mr-2 h-4 w-4" />
        Результат
      </Button>
      <ReportShowMenu
        isOpen={isShowMenuOpen}
        onToggle={onToggleShowMenu}
        widthClassName="w-56"
        items={[
          { label: 'Ожидает заявку ПСТО', onClick: onOpenWaitingRequestReport },
          { label: 'Результаты ПСТО', onClick: onOpenResultsReport },
        ]}
      />
    </>
  )
}

type LnkHeaderActionsProps = {
  onCreateRequest: () => void
  requestPending: boolean
  onAddResult: () => void
  resultDisabled: boolean
  onOpenOfficiality: () => void
  officialityPending: boolean
  isShowMenuOpen: boolean
  onToggleShowMenu: () => void
  onOpenToRequestReport: () => void
  onOpenWaitingNkReport: () => void
  onOpenConclusionsReport: () => void
}

export function LnkHeaderActions({
  onCreateRequest,
  requestPending,
  onAddResult,
  resultDisabled,
  onOpenOfficiality,
  officialityPending,
  isShowMenuOpen,
  onToggleShowMenu,
  onOpenToRequestReport,
  onOpenWaitingNkReport,
  onOpenConclusionsReport,
}: LnkHeaderActionsProps) {
  return (
    <>
      <Button onClick={onCreateRequest} disabled={requestPending}>
        <Plus className="mr-2 h-4 w-4" />
        Заявка
      </Button>
      <Button onClick={onAddResult} disabled={resultDisabled}>
        <ClipboardCheck className="mr-2 h-4 w-4" />
        Результат
      </Button>
      <Button variant="outline" onClick={onOpenOfficiality} disabled={officialityPending}>
        <ShieldCheck className="mr-2 h-4 w-4" />
        Официальность
      </Button>
      <ReportShowMenu
        isOpen={isShowMenuOpen}
        onToggle={onToggleShowMenu}
        items={[
          { label: 'Ожидание заявки', onClick: onOpenToRequestReport },
          { label: 'Ожидание НК', onClick: onOpenWaitingNkReport },
          { label: 'Показать заключения', onClick: onOpenConclusionsReport },
        ]}
      />
    </>
  )
}
