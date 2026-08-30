// This module is intentionally domain-scoped. Keep cross-domain rules in weld-server-shared.

import { requireDb } from '@/db'
import {
weldJoints
} from '@/db/schema'
import {
type WeldFieldKey,
type WeldInput
} from '@/lib/weld-fields'
import { getWeldLineAutofillState,LINE_AUTOFILL_FIELD_KEYS,type WeldLineAutofillState } from '@/lib/weld-line-autofill'
import { assertSecurityScope } from '@/server/security-functions'
import {
type WeldLineAutofillRequest
} from '@/server/weld-contracts'
import { createServerFn } from '@tanstack/react-start'

import {
getWeldColumn,
normalizedTextEquals,
} from '@/server/weld-server-shared'

export const getWeldLineAutofill = createServerFn({ method: 'POST' })
  .validator((data: WeldLineAutofillRequest) => ({ draft: data?.draft ?? {} }))
  .handler(async ({ data }): Promise<WeldLineAutofillState> => {
    await assertSecurityScope('entry')
    const line = String(data.draft.line ?? '').trim()
    if (!line) return getWeldLineAutofillState(data.draft, [])
    const selectedFieldKeys = [
      'id',
      'line',
      'projectTitle',
      'subtitleCode',
      ...LINE_AUTOFILL_FIELD_KEYS,
    ] as const
    const selectedColumns = Object.fromEntries(
      [...new Set(selectedFieldKeys)]
        .map((fieldKey) => [fieldKey, getWeldColumn(fieldKey)] as const)
        .filter((entry): entry is [WeldFieldKey, NonNullable<ReturnType<typeof getWeldColumn>>] => Boolean(entry[1])),
    )
    const rows = await requireDb()
      .select(selectedColumns)
      .from(weldJoints)
      .where(normalizedTextEquals(weldJoints.line, line))
    return getWeldLineAutofillState(data.draft, rows as WeldInput[])
  })

export {
getPstoLineRemovalPreview,getPstoWeldLineMovePreview,listPstoLineAssignments,
savePstoLineAssignment
} from '@/server/psto-line-assignment'
