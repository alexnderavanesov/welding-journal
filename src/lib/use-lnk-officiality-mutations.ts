import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createDefaultLnkOfficialityDraft } from '@/lib/report-draft-state'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'
import type { LnkOfficialityChainPlan } from '@/lib/lnk-officiality-chain-plan'
import {
  applyLnkOfficialityChange,
  previewLnkOfficialityChange,
} from '@/server/weld-mutations-api'
import { DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY } from '@/lib/dispatcher-accepted-warning-query'

export function useLnkOfficialityMutations({
  setMessage,
  highlightChangedRows,
  setLnkOfficialityDraft,
  setIsLnkOfficialityModalOpen,
  resetDismissedRepeatedJointTasks,
}: UseLnkReportMutationsOptions) {
  const queryClient = useQueryClient()

  const lnkOfficialityPreviewMutation = useMutation({
    mutationFn: async ({
      records,
      officiality,
    }: {
      records: RowWithId[]
      officiality: 'official' | 'unofficial'
    }) => previewLnkOfficialityChange({
      data: {
        targets: records.map((record) => ({
          id: record.id,
          version: String(record.rowVersion ?? '').trim(),
        })),
        officiality,
      },
    }),
  })

  const lnkOfficialityMutation = useMutation({
    mutationFn: async ({
      records,
      officiality,
      plan,
    }: {
      records: RowWithId[]
      officiality: 'official' | 'unofficial'
      plan: LnkOfficialityChainPlan
    }) => {
      return applyLnkOfficialityChange({
        data: {
          targets: records.map((record) => ({
            id: record.id,
            version: String(record.rowVersion ?? '').trim(),
          })),
          officiality,
          expectedPlanKey: plan.planKey,
        },
      })
    },
    onSuccess: async (result, variables) => {
      const savedRows = result.savedRows as WeldRow[]
      const fieldKeys = result.plan.renames.length > 0
        ? ['officiality', 'joint'] as const
        : ['officiality'] as const
      highlightChangedRows(savedRows, [...fieldKeys])
      resetDismissedRepeatedJointTasks()
      const messages = [
        variables.officiality === 'unofficial'
          ? `Официальность «неофициальный» установлена: ${result.plan.officialityChanges.length}`
          : `Официальность «официальный» установлена: ${result.plan.officialityChanges.length}`,
      ]
      if (result.plan.renames.length > 0) {
        messages.push(`переименовано стыков в продолжении: ${result.plan.renames.length}`)
      }
      if (result.plan.earlyCoilDecisions.length > 0) {
        messages.push(`сохранено досрочных катушек: ${result.plan.earlyCoilDecisions.length}`)
      }
      setMessage(messages.join('; '))
      setLnkOfficialityDraft(createDefaultLnkOfficialityDraft())
      setIsLnkOfficialityModalOpen(false)
      await Promise.all([
        invalidateWeldJoints(queryClient, { upsertRows: savedRows }),
        queryClient.invalidateQueries({ queryKey: ['weld-joint-chain'] }),
        ...(result.plan.earlyCoilDecisions.length > 0
          ? [queryClient.invalidateQueries({ queryKey: DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY })]
          : []),
      ])
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return { lnkOfficialityMutation, lnkOfficialityPreviewMutation }
}
