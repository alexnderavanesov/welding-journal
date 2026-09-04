import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const modules = {
  facade: read('welds.ts'),
  readApi: read('weld-read-api.ts'),
  read: read('weld-read.ts'),
  line: read('weld-line-operations.ts'),
  mutationsApi: read('weld-mutations-api.ts'),
  mutations: read('weld-mutations.ts'),
  importApi: read('weld-import-api.ts'),
  imports: read('weld-import.ts'),
  persistence: read('weld-persistence.ts'),
  shared: read('weld-server-shared.ts'),
}

describe('weld server module boundaries', () => {
  it('keeps the compatibility facade free of database and server-function implementations', () => {
    expect(modules.facade).not.toContain('createServerFn')
    expect(modules.facade).not.toContain('requireDb')
    expect(modules.facade).not.toContain('.handler(')
    expect(modules.facade.split('\n').length).toBeLessThan(100)
  })

  it('keeps dependencies directed from shared persistence to mutations and import', () => {
    expect(moduleImports(modules.shared)).toEqual([])
    expect(moduleImports(modules.read)).toEqual(['weld-server-shared'])
    expect(moduleImports(modules.line)).toEqual(['weld-server-shared'])
    expect(moduleImports(modules.persistence)).toEqual(['weld-server-shared'])
    expect(moduleImports(modules.mutations)).toEqual(['weld-persistence'])
    expect(moduleImports(modules.imports)).toEqual([
      'weld-mutations',
      'weld-persistence',
      'weld-server-shared',
    ])
  })

  it('keeps browser API modules free of static implementation and database imports', () => {
    for (const source of [modules.readApi, modules.mutationsApi, modules.importApi]) {
      expect(source).not.toContain("from '@/db'")
      expect(source).not.toMatch(/from '@\/server\/weld-(?:read|mutations|import)'/)
      expect(source).toMatch(/await import\('@\/server\/weld-(?:read|mutations|import)'\)/)
    }
  })

  it('keeps client code on the browser-safe weld API boundary', () => {
    const clientSources = collectTypeScriptSources(resolve(process.cwd(), 'src'))
      .filter((filePath) => !filePath.includes(`${resolve(process.cwd(), 'src/server')}/`))
      .filter((filePath) => !filePath.endsWith('.test.ts'))
      .filter((filePath) => !filePath.endsWith('.test.tsx'))
      .map((filePath) => readFileSync(filePath, 'utf8'))

    expect(clientSources.join('\n')).not.toMatch(
      /from '@\/server\/weld-(?:read|mutations|import)'/,
    )
  })

  it('includes the optimistic-lock version in every full weld-row read sent to the client', () => {
    expect(modules.read).not.toMatch(/\.select\(\)\s*\.from\(weldJoints\)/)
    expect(modules.read).toContain('.select(WELD_TABLE_SELECT)')
  })

  it('places public workflows in their owning modules', () => {
    expect(modules.read).toContain('export const listWeldingJournalPage')
    expect(modules.mutations).toContain('export const updateWeldJoint')
    expect(modules.imports).toContain('export const importWeldJoints')
    expect(modules.line).toContain('export const getWeldLineAutofill')
    expect(modules.persistence).toContain('export async function updateWeldJointsInBatches')
  })

  it('keeps repeat-cycle writes behind the cycle-state service', () => {
    const serverDirectory = resolve(process.cwd(), 'src/server')
    const directWriters = readdirSync(serverDirectory)
      .filter((fileName) => fileName.endsWith('.ts'))
      .filter((fileName) => !fileName.endsWith('.test.ts'))
      .filter((fileName) => fileName !== 'psto-cycle-state.ts')
      .filter((fileName) =>
        /\.(?:insert|update|delete)\(\s*pstoRepeatCycles\s*\)/s.test(
          readFileSync(resolve(serverDirectory, fileName), 'utf8'),
        ),
      )

    expect(directWriters).toEqual([])
  })

  it('coordinates every weld-line membership workflow with PSTO line assignment', () => {
    for (const fileName of [
      'early-coil-workflow.ts',
      'psto-line-assignment.ts',
      'weld-import.ts',
      'weld-mutations.ts',
    ]) {
      expect(read(fileName), fileName).toContain('lockWeldLineMemberships')
    }
  })

  it('revalidates dispatcher-driven writes inside line-scoped server workflows', () => {
    const percentageWorkflow = read('percentage-line-control-workflow.ts')
    const repeatedJointDeleteWorkflow = read('repeated-joint-delete-workflow.ts')

    for (const source of [percentageWorkflow, repeatedJointDeleteWorkflow]) {
      expect(source).toContain('lockWeldLineMemberships')
      expect(source).toContain(".for('update')")
    }
    expect(percentageWorkflow).toContain('buildPercentageLineControlUpdateRows')
    expect(percentageWorkflow).toContain('new Map(hydratedRows.map')
    expect(repeatedJointDeleteWorkflow).toContain('findCurrentObsoleteRepeatedJointDeleteTask')
    expect(repeatedJointDeleteWorkflow.indexOf('findCurrentObsoleteRepeatedJointDeleteTask({'))
      .toBeLessThan(repeatedJointDeleteWorkflow.indexOf('deleteLockedWeldRowsInTransaction(tx'))
  })

  it('uses the shared LNK chronology barrier in every line move that changes a stage', () => {
    const pstoLineAssignment = read('psto-line-assignment.ts')

    expect(pstoLineAssignment).toContain('assertPstoLineActivationTransferAllowed(rows, previewRows)')
    expect(pstoLineAssignment).toContain('assertPstoLineCancellationPromotionAllowed(rows, nextRows)')
    expect(modules.mutations).toContain('assertChainLineMoveLnkStageTransfersAllowed(records, previousRows, decisions)')
    expect(pstoLineAssignment).toContain('findBlockingLnkStageTransferChronologyIssue')
    expect(modules.mutations).toContain('findBlockingLnkStageTransferChronologyIssue')
  })
})

function read(fileName: string) {
  return readFileSync(resolve(process.cwd(), 'src/server', fileName), 'utf8')
}

function moduleImports(source: string) {
  const boundaryModules = new Set([
    'weld-import',
    'weld-line-operations',
    'weld-mutations',
    'weld-persistence',
    'weld-read',
    'weld-server-shared',
  ])
  return [...source.matchAll(/from '@\/server\/(weld-[^']+)'/g)]
    .map((match) => match[1])
    .filter((name) => boundaryModules.has(name))
    .sort()
}

function collectTypeScriptSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return collectTypeScriptSources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}
