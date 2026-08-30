import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Dispatch, SetStateAction } from 'react'
import type { RkExposureEditingState } from '@/lib/home-state'
import type { RkExposureLine } from '@/lib/rk-exposure'
import { buildRkExposureEditedRow } from '@/lib/rk-exposure-mutation-updates'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowOrThrow } from '@/lib/weld-save-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { updatePreHeatTreatmentRkExposure } from '@/server/pre-heat-treatment-lnk-workflow'

export function useRkExposureMutation({
  setMessage,
  setEditing,
  highlightChangedRows,
}: {
  setMessage: Dispatch<SetStateAction<string | null>>
  setEditing: Dispatch<SetStateAction<RkExposureEditingState | null>>
  highlightChangedRows: (rows: WeldRow[], fieldKeys: WeldFieldKey[]) => void
}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ record, lines, confirmedDiameter, stage }: {
      record: WeldRow
      lines: RkExposureLine[]
      confirmedDiameter: number | null
      stage?: 'primary' | 'beforeHeatTreatment'
    }) => {
      if (stage === 'beforeHeatTreatment') {
        return await updatePreHeatTreatmentRkExposure({
          data: { rowId: record.id, lines, confirmedDiameter },
        }) as WeldRow
      }
      const updatedRecord = buildRkExposureEditedRow({ record, lines, confirmedDiameter })
      return await updateWeldRowOrThrow(
        updatedRecord,
        'Не удалось обновить снимки и описание дефектов РК',
        { mutationScope: 'lnk' },
      ) as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      const isBeforeHeatTreatment = variables.stage === 'beforeHeatTreatment'
      highlightChangedRows(
        saved ? [saved] : [],
        isBeforeHeatTreatment
          ? ['preRkExposureScheme', 'preRkDefectDescription']
          : ['rkExposureScheme', 'lnkDefectDescription'],
      )
      setEditing(null)
      setMessage(`Снимки и описание дефектов РК${isBeforeHeatTreatment ? ' до ТО' : ''} обновлены`)
      await invalidateWeldJoints(queryClient, { upsertRows: [saved] })
    },
    onError: (error) => setMessage((error as Error).message),
  })
}
