import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Dispatch, SetStateAction } from 'react'
import type { RkExposureEditingState } from '@/lib/home-state'
import type { RkExposureLine } from '@/lib/rk-exposure'
import { buildRkExposureEditedRow } from '@/lib/rk-exposure-mutation-updates'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowOrThrow } from '@/lib/weld-save-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

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
    mutationFn: async ({ record, lines, confirmedDiameter }: {
      record: WeldRow
      lines: RkExposureLine[]
      confirmedDiameter: number | null
    }) => {
      const updatedRecord = buildRkExposureEditedRow({ record, lines, confirmedDiameter })
      return await updateWeldRowOrThrow(updatedRecord) as unknown as WeldRow
    },
    onSuccess: async (saved) => {
      highlightChangedRows(saved ? [saved] : [], ['rkExposureScheme', 'lnkDefectDescription'])
      setEditing(null)
      setMessage('Снимки и описание дефектов РК обновлены')
      await invalidateWeldJoints(queryClient, { upsertRows: [saved] })
    },
    onError: (error) => setMessage((error as Error).message),
  })
}
