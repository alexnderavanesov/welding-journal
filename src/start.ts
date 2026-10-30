import { createCsrfMiddleware, createStart } from '@tanstack/react-start'
import { serverFunctionFetch } from '@/lib/server-function-fetch'
import { accessMiddleware } from '@/server/access-middleware'

// Providing a custom Start entry replaces the framework's default middleware.
// Retain its same-origin RPC protection alongside the custom fetch transport.
const csrfMiddleware = createCsrfMiddleware({ filter: context => context.handlerType === 'serverFn' })

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
  functionMiddleware: [accessMiddleware],
  serverFns: { fetch: serverFunctionFetch },
}))
