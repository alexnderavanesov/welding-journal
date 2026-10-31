import { expect, it, vi } from 'vitest'
import { WorkflowConflictError } from '@/lib/workflow-conflict'
import { accessContext } from './access-store'
import { reportWorkflowConflict } from './workflow-conflict-diagnostics'

it('logs only the reason code and operation reference, without identity, payload or message', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    accessContext.run({ operation: 'updateWeldJoints', operationId: 'reference', area: 'lnk', permissions: ['lnk.edit'],
      identity: { id: 'secret-id', role: 'user', email: 'secret@example.com', name: 'secret-name', title: '', revision: 1, permissions: ['lnk.edit'] } }, () => {
      reportWorkflowConflict(new WorkflowConflictError('ROW_VERSION_STALE', 'Private date and joint name'))
      reportWorkflowConflict(new Error('Private unexpected error'))
    })
    reportWorkflowConflict(new WorkflowConflictError('ROW_MISSING', 'No request context'))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.parse(warn.mock.calls[0][0])).toEqual({ event: 'workflow-conflict', code: 'ROW_VERSION_STALE', operation: 'updateWeldJoints', operationId: 'reference' })
  } finally { warn.mockRestore() }
})
