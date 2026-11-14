import { createServerFn } from '@tanstack/react-start'
import { normalizeLnkResultRemoval } from '@/lib/lnk-result-removal-plan'

export const removeLnkResults = createServerFn({ method: 'POST' })
  .validator(normalizeLnkResultRemoval)
  .handler(async ({ data }) => {
    const { assertSecurityScope } = await import('./security')
    await assertSecurityScope('delete')
    const { buildLnkResultRemovalBatch } = await import('@/lib/lnk-result-removal-plan')
    const { updateWeldJointRows } = await import('./weld-mutations')
    return updateWeldJointRows(buildLnkResultRemovalBatch(data))
  })
