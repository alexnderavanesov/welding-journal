import { describe, expect, it } from 'vitest'
import { normalizeLnkWorkflowRowsRequest, normalizePstoWorkflowRowsRequest } from '@/server/weld-contracts'
import { WORKFLOW_SELECTION_LIMIT_MESSAGE } from '@/lib/workflow-selection-limit'

describe('workflow selection server boundary', () => {
  it.each([normalizeLnkWorkflowRowsRequest, normalizePstoWorkflowRowsRequest])(
    'validates the entire selection instead of silently truncating it', (normalize) => {
      const ids = Array.from({ length: 5000 }, (_, index) => index + 1)
      expect(normalize({ scope: 'requestCandidates', includeRowIds: [...ids, 1] }).includeRowIds).toEqual(ids)
      expect(() => normalize({ scope: 'requestCandidates', includeRowIds: [...ids, 5001] }))
        .toThrow(WORKFLOW_SELECTION_LIMIT_MESSAGE)
      expect(() => normalize({ scope: 'requestCandidates', includeRowIds: [...ids, Infinity] }))
        .toThrow('некорректный список выбранных стыков')
    },
  )
})
