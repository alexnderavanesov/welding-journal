import { expect, it } from 'vitest'
import ts from 'typescript'
import { AUTH_HTTP_ENDPOINTS } from './auth'
import { guestRoutes } from '../../e2e/guest-route-contract'

it('requires an explicit guest contract for every HTTP route and method', () => {
  const sources = import.meta.glob<string>('../routes/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
  const registered: Record<string, string[]> = {}
  for (const [file, source] of Object.entries(sources)) {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    function property(object: ts.Expression | undefined, name: string) {
      if (!object || !ts.isObjectLiteralExpression(object)) throw Error(file + ': review indirect route options')
      if (object.properties.some(ts.isSpreadAssignment)) throw Error(file + ': review spread route options')
      const entry = object.properties.find(p => p.name?.getText(tree).replace(/^['"]|['"]$/g, '') === name)
      if (!entry) return undefined
      if (!ts.isPropertyAssignment(entry)) throw Error(file + ': review indirect ' + name)
      return entry.initializer
    }
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isCallExpression(node.expression) &&
        node.expression.expression.getText(tree) === 'createFileRoute') {
        const route = node.expression.arguments[0]
        if (!ts.isStringLiteral(route)) throw Error(file + ': review computed route path')
        const server = property(node.arguments[0], 'server')
        if (server) {
          const methods = property(server, 'handlers')
          if (!methods || !ts.isObjectLiteralExpression(methods)) throw Error(file + ': review server handlers')
          registered[route.text] = methods.properties.map(p => p.name?.getText(tree).replace(/^['"]|['"]$/g, '') ?? 'unknown').sort()
        } else if (route.text.startsWith('/api/')) throw Error(file + ': API route without a guest contract')
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
  expect(registered).toEqual(Object.fromEntries(Object.entries(guestRoutes).map(([route, methods]) => [route, Object.keys(methods).sort()])))
  expect([...AUTH_HTTP_ENDPOINTS]).toEqual([['/sign-in/email', 'POST'], ['/sign-out', 'POST'], ['/get-session', 'GET']])
})
