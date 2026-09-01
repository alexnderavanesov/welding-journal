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
      officiality,
    }: {
      records: RowWithId[]
      officiality: 'official' | 'unofficial'
    }) => {
      const updatedRecords = buildLnkOfficialityRows({ records, officiality })

      if (updatedRecords.length === 0) throw new Error('Выбранные стыки уже имеют такую официальность')

      const savedRows = await updateWeldRowsOrThrow(
        updatedRecords,
        'Не удалось изменить официальность результата ЛНК',
        { mutationScope: 'lnk' },
      )
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, ['officiality'])
      resetDismissedRepeatedJointTasks()
      setMessage(
        variables.officiality === 'unofficial'
          ? `Официальность "неофициальный" установлена для стыков: ${savedRows.length}`
          : `Официальность "официальный" установлена для стыков: ${savedRows.length}`,
      )
      setLnkOfficialityDraft(createDefaultLnkOfficialityDraft())
      setIsLnkOfficialityModalOpen(false)
      await invalidateWeldJoints(queryClient, { upsertRows: savedRows })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return { lnkOfficialityMutation }
}
