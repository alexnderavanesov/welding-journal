import { createServerFn } from '@tanstack/react-start'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { assertSecurityScope } from './security-functions'
import { loadLineProgramOverviews } from './line-program'

const RETIRED_PROGRAM_APPROVAL_MESSAGE = 'Отдельное согласование контроля больше не используется. Выберите «Дополнительный» и укажите основание.'

export type ProgramApprovalRequest = {
  lineId: number; lineVersion: string; action: 'approve' | 'revoke'; confirmed: boolean
  targets: (WeldRowVersionTarget & { approvalVersion: string })[]; keys: string[]
}
export const changeLineProgramApprovals = createServerFn({ method: 'POST' })
  .validator((data: ProgramApprovalRequest) => data)
  .handler(async () => {
    await assertSecurityScope('edit')
    throw new Error(RETIRED_PROGRAM_APPROVAL_MESSAGE)
  })

/** Stale clients must not revive retired approvals or write exception records. */
export async function changeProgramApprovalsInTransaction(_tx: SystemDocumentSequenceTransaction, _data: ProgramApprovalRequest): Promise<{ changed: number; lineSummary: Awaited<ReturnType<typeof loadLineProgramOverviews>>[number] }> {
  throw new Error(RETIRED_PROGRAM_APPROVAL_MESSAGE)
}
