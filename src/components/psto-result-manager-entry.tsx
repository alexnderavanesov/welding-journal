import { Pencil, Trash2 } from 'lucide-react'

import {
  JointProjectSubtitleMeta,
  JointSpoolDiameterMeta,
  JointWeldDateMeta,
  MetaSeparator,
  OfficialityBadge,
} from '@/components/joint-meta'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointStatusBadgeClass, getJointStatusLabel } from '@/lib/lnk-status'
import { getPstoResultBadgeClass, getPstoResultLabel } from '@/lib/report-badges'
import { getJointTitle } from '@/lib/report-ui-state'
import { hasText } from '@/lib/report-value-utils'

export type PstoResultManagerEntryProps = {
  row: WeldRow
  diagramDraft: string
  isPending: boolean
  onDiagramDraftChange: (rowId: number, value: string) => void
  onRenameDiagram: (row: WeldRow) => void
  onDeleteResult: (row: WeldRow) => void
}

export function PstoResultManagerEntry({
  row,
  diagramDraft,
  isPending,
  onDiagramDraftChange,
  onRenameDiagram,
  onDeleteResult,
}: PstoResultManagerEntryProps) {
  const requestName = String(row.pstoRequest ?? '').trim()
  const pstoDate = String(row.pstoDate ?? '').trim()
  const diagramName = String(row.heatTreatmentDiagram ?? '').trim()

  return (
    <div className="grid grid-cols-[minmax(420px,1fr)_minmax(230px,0.45fr)] gap-4 px-4 py-3 text-sm">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-medium text-slate-900">{getJointTitle(row)}</span>
          <OfficialityBadge row={row} compact />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>
            <JointProjectSubtitleMeta row={row} />
            <MetaSeparator />
            <JointSpoolDiameterMeta row={row} />
            <MetaSeparator />
            <JointWeldDateMeta row={row} />
          </span>
          <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getJointStatusBadgeClass(row)}`}>
            Стык: {getJointStatusLabel(row)}
          </span>
          <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getPstoResultBadgeClass(row.pstoResult)}`}>
            ПСТО: {getPstoResultLabel(row.pstoResult)}
          </span>
        </div>
        <div className="mt-1 text-xs leading-5 text-slate-500">
          <span className="font-medium text-slate-700">Заявка:</span>{' '}
          <span className="break-words">{requestName || '-'}</span>
          <span className="mx-1 text-slate-300">·</span>
          <span className="font-medium text-slate-700">Дата:</span> {pstoDate || '-'}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={diagramDraft}
            onChange={(event) => onDiagramDraftChange(row.id, event.target.value)}
            placeholder="Наименование диаграммы для этого стыка"
            disabled={isPending}
            className="h-8 min-w-72 max-w-xl flex-1 bg-white text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onRenameDiagram(row)}
            disabled={isPending || !diagramDraft.trim() || diagramDraft.trim() === diagramName}
            className="h-8"
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Переименовать
          </Button>
        </div>
      </div>
      <div className="flex flex-col items-end justify-start gap-2">
        <span className={`rounded border px-2 py-1 text-xs font-semibold ${getPstoResultBadgeClass(row.pstoResult)}`}>
          Сейчас: {getPstoResultLabel(row.pstoResult)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onDeleteResult(row)}
          disabled={isPending || (!hasText(row.pstoResult) && !hasText(row.pstoDate) && !hasText(row.heatTreatmentDiagram))}
          className="border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Удалить результат
        </Button>
      </div>
    </div>
  )
}
