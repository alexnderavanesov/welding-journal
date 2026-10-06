import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('does not treat the background refresh notification as an awaited operation', () => {
  const violations: string[] = []
  for (const file of sourceFiles(resolve('src'))) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes('scheduleWeldDataRefresh')) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
          node.expression.text === 'scheduleWeldDataRefresh') {
        for (let parent = node.parent; parent && !ts.isStatement(parent); parent = parent.parent) {
          const promiseCollection = ts.isCallExpression(parent) &&
            ts.isPropertyAccessExpression(parent.expression) &&
            ts.isIdentifier(parent.expression.expression) &&
            parent.expression.expression.text === 'Promise'
          if (ts.isAwaitExpression(parent) || promiseCollection) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
            violations.push(`${file}:${line + 1}`)
            break
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  expect(violations).toEqual([])
})

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : []
  })
}
