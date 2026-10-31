import { createMiddleware } from '@tanstack/react-start'

export const accessMiddleware = createMiddleware({ type: 'function' }).server(async ({ next, data, serverFnMeta }) => {
  const { setResponseHeader } = await import('@tanstack/react-start/server')
  setResponseHeader('Cache-Control', 'no-store')
  const { getOperationPolicy, getOperationPermissions } = await import('./access-operation-policy')
  const policy = getOperationPolicy(serverFnMeta.filename, serverFnMeta.name)
  const accountApi = serverFnMeta.filename.replaceAll('\\', '/').endsWith('/account-api.ts')
  if (accountApi && ['getCurrentAccount', 'refreshAccountActivity', 'completeAccountLink'].includes(serverFnMeta.name)) return next()
  const { requireIdentity, runWithAccess } = await import('./access-context')
  const identity = await requireIdentity().catch(async error => {
    setResponseHeader('X-Access-Expired', 'true'); throw error
  })
  const permissions = getOperationPermissions(policy, data)
  const { extendOperationPermissions } = await import('./access-document-policy')
  await extendOperationPermissions(identity, serverFnMeta.name, policy, data, permissions)
  const { assertReadableQuery, getOperationSearchArea } = await import('./access-payload')
  const { redactOperationResult } = await import('./access-response')
  // Line-program search selects line/stamp registry metadata, not arbitrary
  // weld fields. Its joint reads take IDs and retain response-field redaction.
  const weldQuery = /(?:weld-read-api|journal-grid-api|dispatcher-task)(?:\.|-)/.test(serverFnMeta.filename)
  if (weldQuery && permissions.some(permission => permission.endsWith('.view') || permission.endsWith('.export'))) assertReadableQuery(identity, data, getOperationSearchArea(serverFnMeta.filename, serverFnMeta.name))
  return runWithAccess(identity, serverFnMeta.name, permissions, async () => {
    const { getRequestHeader } = await import('@tanstack/react-start/server')
    const { DOCUMENT_SAVE_ID_HEADER, DOCUMENT_SAVE_OPERATIONS } = await import('@/lib/document-save-recovery')
    const { accessContext } = await import('./access-store')
    const saveId = getRequestHeader(DOCUMENT_SAVE_ID_HEADER)
    if (saveId && DOCUMENT_SAVE_OPERATIONS.some(operation => operation === serverFnMeta.name)) {
      const { documentSaveReceiptKey } = await import('./document-save-receipt')
      documentSaveReceiptKey(identity.id, serverFnMeta.name as typeof DOCUMENT_SAVE_OPERATIONS[number], saveId)
      accessContext.getStore()!.documentSaveId = saveId
    }
    const { reportWorkflowConflict } = await import('./workflow-conflict-diagnostics')
    const result = await next().catch(error => {
      reportWorkflowConflict(error)
      throw error
    })
    // Start's public middleware type hides the transport payload; preserve the returned context object.
    const payload = result as unknown as { result?: unknown }
    payload.result = redactOperationResult(identity, serverFnMeta.filename, serverFnMeta.name, payload.result)
    return result
  })
})
