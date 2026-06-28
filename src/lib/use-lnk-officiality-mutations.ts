import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getLnkResultHighlightFields } from '@/lib/lnk-report-mutation-highlight-fields'
import { buildLnkOfficialityRows } from '@/lib/lnk-report-mutation-updates'
import { createDefaultLnkOfficialityDraft } from '@/lib/report-draft-state'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'

export function useLnkOfficialityMutations({
  setMessage,
  highlightChangedRows,
  setLnkOfficialityDraft,
  setIsLnkOfficialityModalOpen,
  resetDismissedRepeatedJointTasks,
}: UseLnkReportMutationsOptions) {
  const queryClient = useQueryClient()

  const lnkOfficialityMutation = useMutation({
    mutationFn: async ({
      records,
      status,
    }: {
      records: RowWithId[]
      status: 'official' | 'unofficial'
    }) => {
      const updatedRecords = buildLnkOfficialityRows({ records, status })

      if (updatedRecords.length === 0) throw new Error('Выбранные стыки уже имеют такой статус')

      const savedRows = await updateWeldRowsOrThrow(updatedRecords)
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, ['status'])
      resetDismissedRepeatedJointTasks()
      setMessage(
        variables.status === 'unofficial'
          ? `Статус "неофициальный" установлен для стыков: ${savedRows.length}`
          : `Статус "официальный" установлен для стыков: ${savedRows.length}`,
      )
      setLnkOfficialityDraft(createDefaultLnkOfficialityDraft())
      setIsLnkOfficialityModalOpen(false)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return { lnkOfficialityMutation }
}
