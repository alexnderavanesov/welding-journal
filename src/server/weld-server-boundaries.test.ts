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
  chainMove: read('weld-chain-line-move.ts'),
  lineMoveStage: read('weld-line-move-stage.ts'),
  importApi: read('weld-import-api.ts'),
  imports: read('weld-import.ts'),
  lnkOfficiality: read('lnk-officiality-workflow.ts'),
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
    expect(moduleImports(modules.line)).toEqual([])
    expect(moduleImports(modules.persistence)).toEqual(['weld-server-shared'])
    expect(moduleImports(modules.mutations)).toEqual(['weld-line-move-stage', 'weld-persistence'])
    expect(moduleImports(modules.chainMove)).toEqual(['weld-line-move-stage', 'weld-persistence'])
    expect(moduleImports(modules.lineMoveStage)).toEqual([])
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

  it('keeps dynamically loaded API implementations free of nested server functions', () => {
    const serverDirectory = resolve(process.cwd(), 'src/server')
    const apiFiles = readdirSync(serverDirectory)
      .filter((fileName) => fileName.endsWith('-api.ts') || fileName === 'security-functions.ts')

    for (const apiFile of apiFiles) {
      const apiSource = read(apiFile)
      const implementationModules = Array.from(
        apiSource.matchAll(/await import\('@\/server\/([^']+)'\)/g),
        (match) => match[1],
      )

      for (const implementationModule of implementationModules) {
        expect(
          read(`${implementationModule}.ts`),
          `${apiFile} dynamically loads ${implementationModule}.ts`,
        ).not.toContain('createServerFn')
      }
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
    expect(modules.read).toContain('export async function listWeldingJournalPage')
    expect(modules.mutations).toContain('export async function updateWeldJoint')
    expect(modules.imports).toContain('export async function importWeldJoints')
    expect(modules.line).not.toContain('getWeldLineAutofill')
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
      'lnk-officiality-workflow.ts',
      'psto-line-assignment.ts',
      'weld-import.ts',
      'weld-mutations.ts',
      'weld-chain-line-move.ts',
    ]) {
      expect(read(fileName), fileName).toContain('lockWeldLineMemberships')
    }
  })

  it('revalidates dispatcher-driven writes inside line-scoped server workflows', () => {
    const percentageWorkflow = read('line-program-control.ts')
    const repeatedJointDeleteWorkflow = read('repeated-joint-delete-workflow.ts')

    for (const source of [percentageWorkflow, repeatedJointDeleteWorkflow, modules.lnkOfficiality]) {
      expect(source).toContain('lockWeldLineMemberships')
      expect(source).toContain(".for('update')")
    }
    expect(percentageWorkflow).toContain('previewProgramChanges(allRows')
    expect(percentageWorkflow).toContain('assertExpectedInteractiveWeldVersions(ids, data.targets, storedRows)')
    expect(percentageWorkflow.indexOf('data.previewToken !== token')).toBeLessThan(percentageWorkflow.indexOf('result.rows = await saveAssignedRows'))
    expect(percentageWorkflow.indexOf('!data.confirmedExcess')).toBeLessThan(percentageWorkflow.indexOf('result.rows = await saveAssignedRows'))
    expect(repeatedJointDeleteWorkflow).toContain('findCurrentObsoleteRepeatedJointDeleteTask')
    expect(repeatedJointDeleteWorkflow.indexOf('findCurrentObsoleteRepeatedJointDeleteTask({'))
      .toBeLessThan(repeatedJointDeleteWorkflow.indexOf('deleteLockedWeldRowsInTransaction(tx'))
    expect(modules.lnkOfficiality).toContain('buildLnkOfficialityChainPlan')
    expect(modules.lnkOfficiality.indexOf('plan.planKey !== data.expectedPlanKey'))
      .toBeLessThan(modules.lnkOfficiality.indexOf('updateWeldJointsInBatches(tx'))
  })

  it('uses only guarded contextual stage correction, not the removed general stage-transfer helpers', () => {
    const assignment = read('psto-line-assignment.ts')
    for (const source of [read('psto-line-assignment.ts'), modules.chainMove, modules.mutations, modules.lineMoveStage]) {
      expect(source).not.toMatch(/buildPrimaryToPreHeatTreatmentTransfer|buildPreHeatTreatmentToPrimaryTransfer/)
    }
    const transition = read('psto-assignment-transition.ts')
    expect(transition).toContain('buildPstoContextualStageCorrection(row, target, processSettings, systemIndexSettings)')
    for (const source of [assignment, read('psto-chain-exceptions.ts')]) {
      expect(source.indexOf('assertExpectedInteractiveWeldVersions(')).toBeLessThan(source.indexOf('await applyPstoAssignmentRows('))
    }
    expect(transition).toContain('required === wasRequired')
    expect(modules.lineMoveStage).toContain("buildPstoContextualStageCorrection(record, 'primary'")
    expect(modules.lineMoveStage).toContain('!actuallyChanged || targetLineAssigned')
    for (const source of [modules.chainMove, modules.mutations]) {
      expect(source).toContain('preparePstoLineMoveRecordInTransaction({')
      expect(source.indexOf('validateServerWeldRecords(')).toBeLessThan(source.indexOf('await removeTransferredPreControlsInTransaction('))
    }
    expect(modules.mutations).toContain('preserveRecordedControlHistory: preparedMove.preserveRecordedControlHistory')
    expect(modules.chainMove).toContain('preserveRecordedControlHistoryRowIds: allowedLineMoveRowIds')
  })

  it('keeps the chain move atomic and behind the edit/row-version guards', () => {
    expect(modules.mutationsApi).toContain("await import('@/server/weld-chain-line-move')")
    expect(modules.mutations).not.toContain('export async function moveWeldJointChain')
    expect(modules.chainMove).toContain("await assertSecurityScope('edit')")
    expect(modules.chainMove.match(/\.transaction\(/g)).toHaveLength(1)
    expect(modules.chainMove.indexOf('lockWeldLineMemberships(tx')).toBeLessThan(modules.chainMove.indexOf(".for('update')"))
    expect(modules.chainMove.indexOf('assertExpectedInteractiveWeldVersions(')).toBeLessThan(modules.chainMove.indexOf('updateWeldJointsInBatches(tx'))
    expect(modules.chainMove.indexOf('validateServerWeldRecords(')).toBeLessThan(modules.chainMove.indexOf('updateWeldJointsInBatches(tx'))
    expect(modules.chainMove).toContain('scopes: getDispatcherDirtyScopes(records, previousRows)')
  })
})

function read(fileName: string) {
  return readFileSync(resolve(process.cwd(), 'src/server', fileName), 'utf8')
}

function moduleImports(source: string) {
  const boundaryModules = new Set([
    'weld-chain-line-move',
    'weld-line-move-stage',
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
