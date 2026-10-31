import { createServerOnlyFn } from '@tanstack/react-start'
import { canViewWeldField } from '@/lib/weld-field-access'
import type { ValidationMessageFormatter } from '@/lib/validation-message'
import { accessContext } from './access-store'

// This module is also reached through RPC modules imported by the client.
// Strip the request-local Node context before evaluating the browser graph.
export const formatAccessValidationMessage: ValidationMessageFormatter = createServerOnlyFn(({ message, publicMessage, fields }) => {
  const identity = accessContext.getStore()?.identity
  return identity && fields.some(field => !canViewWeldField(identity, field)) ? publicMessage : message
})
