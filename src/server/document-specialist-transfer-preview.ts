import { createServerFn } from '@tanstack/react-start'
import { requireDb } from '@/db'
import { assertSecurityScope } from './security-functions'
import { planTransferredSpecialists } from './document-specialist-transfers'

export const previewSpecialistTransfer = createServerFn({ method: 'POST' })
  .validator((value: { rowIds: number[]; target: 'primary' | 'beforeHeatTreatment' }) => {
    if (!Array.isArray(value?.rowIds) || !value.rowIds.length || value.rowIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
      !['primary', 'beforeHeatTreatment'].includes(value.target)) throw new Error('Некорректный состав переноса.')
    return { rowIds: [...new Set(value.rowIds)].sort((a, b) => a - b), target: value.target }
  })
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    const { conflicts, confirmation } = await planTransferredSpecialists(requireDb(), data.rowIds, data.target)
    return { conflicts, confirmation }
  })
