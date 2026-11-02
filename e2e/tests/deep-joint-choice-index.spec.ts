import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import type { JournalGridRequest, JournalGridResult, JournalRevision } from '../../src/lib/journal-server-grid'
import type { JournalFilterPage } from '../../src/lib/journal-filter-options'
import type { WeldReportKind, WeldReportSummaryResult } from '../../src/server/weld-contracts'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import { splitReportQuickSearch } from '../../src/lib/report-quick-search'
import { withE2eDatabase } from '../database'
import { auditSqlCount, auditSqlDetails } from '../audit-sql'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import {
  cleanupJointChoiceFixture, inspectJointChoiceFixture, jointChoiceIndex, jointChoiceMarker, jointChoiceNumber,
  jointChoiceProjects, jointChoiceSelectedProject, jointChoiceSignature, jointChoiceTotal, normalizedJointChoice,
  removeJointChoiceIndex, seedJointChoiceFixture, setJointChoiceIndex,
  type JointChoiceFact, type JointChoicePhase, type JointChoiceProfile,
} from '../deep-joint-choice-index-fixture'

const enabled = process.env.DEEP_JOINT_CHOICE_INDEX === '1'
test.skip(!enabled, 'Opt-in serial HTTP comparison of one joint-choice index on the owned disposable database')
test.use({ trace: 'off', video: 'off' })
test.describe.configure({ mode: 'serial' })
const profiles: JointChoiceProfile[] = ([4, 40] as const).flatMap(projects => (['repeated', 'unique'] as const)
  .map(distribution => ({ projects, distribution })))
const profileName = (profile: JointChoiceProfile) => `200000-${profile.projects}-${profile.distribution}`
const requested = process.env.DEEP_JOINT_CHOICE_PROFILES?.split(',').map(value => value.trim())
const reports: WeldReportKind[] = ['weldingJournal', 'lnk', 'heatTreatment']
const phaseOrders: JointChoicePhase[][] = [
  ['baseline', 'joint-choice-btree'], ['joint-choice-btree', 'baseline'], ['baseline', 'joint-choice-btree'],
]
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
type Case = { name: string; values: string[]; grouped: boolean }
type Sample = { phase: JointChoicePhase; round: number; report: WeldReportKind; name: string; rpc?: string;
  milliseconds?: number; responseBytes?: number; request?: unknown; transport?: string; values?: number }

function ordered(facts: JointChoiceFact[], report: WeldReportKind) {
  // All creation timestamps and spool values are identical. The independent
  // plain-fixture order uses date only for WJ, then padded line/joint text.
  return facts.slice().sort((a, b) => (report === 'weldingJournal' ? b.weldDate.localeCompare(a.weldDate) : 0)
    || a.line.localeCompare(b.line) || (a.joint ?? '').localeCompare(b.joint ?? '') || a.id - b.id)
}

test.beforeAll(() => {
  if (!enabled) return
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  if (requested) {
    expect(requested.length).toBeGreaterThan(0)
    expect(new Set(requested).size).toBe(requested.length)
    expect(requested.every(name => profiles.some(profile => profileName(profile) === name)), 'Explicit known profile names').toBe(true)
  }
})

for (const profile of profiles) {
  test(`${profileName(profile)}: only normalized joint choice index, three alternating pairs`, async ({ page }, info) => {
    test.skip(Boolean(requested && !requested.includes(profileName(profile))), 'Another explicitly selected fixture profile')
    test.setTimeout(1_800_000)
    const samples: Sample[] = [], phases: object[] = [], chains: object[] = [], businessHashes = new Map<string, string>()
    let claimed = false, seeded = false, observed = '', environment: unknown, signature: unknown, fixture: unknown, failure: unknown
    const save = () => writeFile(info.outputPath(`joint-choice-${profileName(profile)}.json`), JSON.stringify({
      protocol: 'joint-choice-only-v1', label: process.env.DEEP_JOINT_CHOICE_LABEL ?? 'unlabelled', profile,
      selectedProfiles: requested ?? profiles.map(profileName), total: jointChoiceTotal, phaseOrders,
      index: { name: jointChoiceIndex, expression: "lower(trim(coalesce(joint::text,'')))", otherExperimentalIndexes: 0 },
      limits: [
        'Real production-bundle HTTP RPCs with normal revision checks; this is not browser popup paint/keyboard latency',
        'Three alternating baseline/index pairs, server/OS warm; DDL, ANALYZE, derived-cache reset and correctness checks are outside HTTP timings',
        'Fixture settings and business rules stay unchanged; completed plain histories and three explicit legacy blank-joint controls',
        'Repeated numbers are unique only within their physical project/subtitle/line; unique-number sibling is a separate selectivity control',
        'Popup search/select-found follow the actual local-versus-remote branch; local steps have no invented RPC latency',
        'Manual multi-choice uses visible initial options; clear, normalized spelling, missing and blank cases are controls, not additional popup gains',
        'Each phase starts a fresh derived revision; later cases can reuse earlier membership caches and identical single/all-found selections',
        'Explanatory SQL plans are not application-query or HTTP latency measurements; no production index/migration is created',
      ], environment, signature, fixture, failure, phases, samples, chains,
      businessHashes: Object.fromEntries(businessHashes),
    }, null, 2))
    const compare = (key: string, value: unknown) => {
      const hash = digest(value), first = businessHashes.get(key)
      if (first === undefined) businessHashes.set(key, hash)
      else expect(hash, `Unchanged complete business response: ${key}`).toBe(first)
    }
    try {
      environment = await inspectJointChoiceFixture(); claimed = true
      const settingsBefore = (await jointChoiceSignature(profile)).settings
      seeded = true
      const facts = await seedJointChoiceFixture(profile)
      const selectedProject = jointChoiceSelectedProject(profile), scoped = facts.filter(row => row.projectTitle === selectedProject)
      const counts = new Map<string, number>()
      for (const row of scoped) { const value = (row.joint ?? '').trim(); counts.set(value, (counts.get(value) ?? 0) + 1) }
      const match = '017', foundValues = [...counts.keys()].filter(value => value.includes(match)).sort()
      const multiValues = [17, 17 + profile.projects, 17 + 2 * profile.projects].map(jointChoiceNumber)
      expect(foundValues).toContain(jointChoiceNumber(17))
      expect(multiValues.every(value => counts.has(value))).toBe(true)
      expect(counts.get('')).toBe(3)
      expect(new Set(scoped.filter(row => normalizedJointChoice(row.joint) === '').map(row => row.id)).size).toBe(3)
      const cases: Case[] = [
        { name: 'single', values: [jointChoiceNumber(17)], grouped: true },
        { name: 'manual-multi', values: multiValues, grouped: true },
        { name: 'all-found', values: foundValues, grouped: true },
        { name: 'blank-null-empty-space', values: [''], grouped: true },
        { name: 'missing', values: ['NO-SUCH-JOINT-CHOICE'], grouped: true },
        { name: 'normalized-spelling', values: [`  ${jointChoiceNumber(17).toLowerCase()}  `], grouped: false },
        { name: 'cleared-empty-selection', values: [], grouped: false },
      ]
      const selected = new Map(cases.map(item => {
        const values = new Set(item.values.map(normalizedJointChoice))
        return [item.name, item.values.length ? scoped.filter(row => values.has(normalizedJointChoice(row.joint))) : scoped]
      }))
      fixture = { selectedProject, selectedProjectRows: scoped.length, jointChoices: counts.size,
        repeatedJointMax: profile.distribution === 'repeated' ? 105 : null,
        singleGlobalRows: facts.filter(row => normalizedJointChoice(row.joint) === jointChoiceNumber(17).toLowerCase()).length,
        singleRows: selected.get('single')!.length, multiRows: selected.get('manual-multi')!.length,
        foundChoices: foundValues.length, foundRows: selected.get('all-found')!.length,
        legacyControls: scoped.filter(row => normalizedJointChoice(row.joint) === ''),
        allFoundEqualsSingle: digest(foundValues) === digest([jointChoiceNumber(17)]) }
      const expected = new Map(reports.map(report => [report, new Map(cases.map(item => [item.name, ordered(selected.get(item.name)!, report)]))]))
      const projectCounts = new Map(jointChoiceProjects(profile).map(project => [project, 0]))
      for (const row of facts) projectCounts.set(row.projectTitle, projectCounts.get(row.projectTitle)! + 1)
      projectCounts.set('E2E проект', 1) // the runner's verified seed belongs to all three report families

      page.on('request', request => { if (rpcName(request.url()).startsWith('readJournalGrid_')) observed = request.url() })
      await page.goto('/journal')
      await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(jointChoiceMarker)
      await expect(page.getByText(`Найдено: ${jointChoiceTotal}`, { exact: true })).toBeVisible({ timeout: 300_000 })
      await page.waitForLoadState('networkidle')
      expect(observed).not.toBe('')
      await page.goto('about:blank') // retain authenticated HTTP access, stop UI background reads
      const call = async <T,>(name: string, data: unknown) => {
        const response = await page.request.post(siblingRpcUrl(observed, `${name}_createServerFn_handler`), {
          data: await serializeRpcData(data), headers: { origin: new URL(observed).origin, 'sec-fetch-site': 'same-origin',
            'content-type': 'application/json', 'x-tsr-serverFn': 'true' }, timeout: 240_000,
        })
        expect(response.ok(), name).toBe(true)
        const body = await response.text(), payload = await deserializeRpcResponse(body) as { result: T; error?: Error }
        if (payload.error) throw payload.error
        return { result: payload.result, responseBytes: Buffer.byteLength(body) }
      }
      signature = await jointChoiceSignature(profile)
      expect((signature as { settings: string }).settings).toBe(settingsBefore)
      let previousRevision: JournalRevision | undefined
      for (let round = 0; round < phaseOrders.length; round++) for (const phase of phaseOrders[round]) {
        console.log('JOINT_CHOICE_PHASE', JSON.stringify({ profile: profileName(profile), phase, round, state: 'start' }))
        const ddl = await setJointChoiceIndex(phase)
        expect(await jointChoiceSignature(profile)).toEqual(signature)
        const { result: prime } = await call<JournalGridResult>('readJournalGrid', { report: 'weldingJournal',
          columnFilters: { joint: buildWeldColumnValueFilter(['NO-SUCH-JOINT-CHOICE']) }, groupBy: [], route: [], start: 0, end: 100 })
        expect(prime.rowCount).toBe(0); expect(prime.revision).not.toBe(previousRevision); previousRevision = prime.revision
        const before = await auditSqlCount(), detailsBefore = await auditSqlDetails()
        const measured = async <T,>(report: WeldReportKind, name: string, rpc: string, request: unknown) => {
          const started = performance.now(), response = await call<T>(rpc, request), milliseconds = performance.now() - started
          samples.push({ phase, round, report, name, rpc, request, milliseconds, responseBytes: response.responseBytes })
          return response.result
        }
        for (const report of reports) {
          const phaseStart = samples.length
          const projectFacet = await measured<JournalFilterPage>(report, 'project/facet', 'readJournalFilterPage', {
            report, fieldKey: 'projectTitle', columnFilters: { projectTitle: buildWeldColumnValueFilter(['NO-SUCH-OWN-PROJECT']) }, revision: prime.revision,
          })
          expect(projectFacet.revision).toBe(prime.revision)
          expect(projectFacet.total).toBe(projectCounts.size)
          expect(new Map(projectFacet.options.map(option => [option.value, option.count]))).toEqual(projectCounts)
          compare(`${report}/project-facet`, { total: projectFacet.total, options: projectFacet.options, next: projectFacet.next })
          const context = { projectTitle: buildWeldColumnValueFilter([selectedProject]) }
          const input = { report, fieldKey: 'joint' as const,
            columnFilters: { ...context, joint: buildWeldColumnValueFilter(['NO-SUCH-OWN-JOINT']) }, revision: prime.revision }
          const facet = await measured<JournalFilterPage>(report, 'joint/facet', 'readJournalFilterPage', input)
          expect(facet.revision).toBe(prime.revision); expect(facet.total).toBe(counts.size)
          for (const option of facet.options) expect(option.count).toBe(counts.get(option.value))
          expect(multiValues.every(value => facet.options.some(option => option.value === value)), 'Manual multi is available in the real initial popup page').toBe(true)
          compare(`${report}/joint-facet`, { total: facet.total, options: facet.options, next: facet.next })
          const searched: JournalFilterPage = facet.next === undefined
            ? { options: facet.options.filter(option => option.value.includes(match)), total: foundValues.length, revision: facet.revision }
            : await measured<JournalFilterPage>(report, 'joint/search', 'readJournalFilterPage', { ...input, match })
          if (facet.next === undefined) samples.push({ phase, round, report, name: 'joint/search', transport: 'already-loaded-options', values: searched.options.length })
          expect(searched.revision).toBe(prime.revision); expect(searched.total).toBe(foundValues.length)
          for (const option of searched.options) { expect(option.value).toContain(match); expect(option.count).toBe(counts.get(option.value)) }
          compare(`${report}/joint-search`, { total: searched.total, options: searched.options, next: searched.next })
          const found = searched.options.length === searched.total
            ? { values: searched.options.map(option => option.value), revision: searched.revision }
            : await measured<{ values: string[]; revision: JournalRevision }>(report, 'joint/select-found', 'selectJournalFilterValues', { ...input, match })
          if (searched.options.length === searched.total) samples.push({ phase, round, report, name: 'joint/select-found', transport: 'already-loaded-options', values: found.values.length })
          expect(found.revision).toBe(prime.revision); expect(found.values.slice().sort()).toEqual(foundValues)
          for (const item of cases) {
            const members = expected.get(report)!.get(item.name)!
            const request: JournalGridRequest = { report, columnFilters: { ...context,
              joint: buildWeldColumnValueFilter(item.name === 'all-found' ? found.values : item.values) },
            groupBy: [], route: [], start: 0, end: 100, revision: prime.revision }
            const rows = await measured<JournalGridResult>(report, `${item.name}/rows`, 'readJournalGrid', request)
            expect(rows.revision).toBe(prime.revision); expect(rows.rowCount).toBe(members.length)
            expect(rows.rows.map(row => row.id)).toEqual(members.slice(0, 100).map(row => row.id))
            compare(`${report}/${item.name}/rows`, { rows: rows.rows, rowCount: rows.rowCount })
            const summary = await measured<WeldReportSummaryResult>(report, `${item.name}/summary`, 'getJournalReportSummary', {
              report, ...splitReportQuickSearch(request.columnFilters), revision: rows.revision,
            })
            expect(summary.total).toBe(members.length); compare(`${report}/${item.name}/summary`, summary)
            if (!item.grouped) continue
            const lines = new Map<string, JointChoiceFact[]>()
            for (const row of members) { const group = lines.get(row.line) ?? []; group.push(row); lines.set(row.line, group) }
            const keys = [...lines.keys()].sort(), grouping = { ...request, groupBy: ['line'] as const }
            const groups = await measured<JournalGridResult>(report, `${item.name}/group`, 'readJournalGrid', grouping)
            expect(groups.revision).toBe(prime.revision); expect(groups.rowCount).toBe(keys.length)
            expect(groups.rows.map(row => row.journalGroup!.key)).toEqual(keys.slice(0, 100))
            for (const row of groups.rows) {
              expect(row.journalGroup!.recordCount).toBe(lines.get(row.journalGroup!.key)!.length)
              expect(row.journalGroup!.route).toEqual([row.journalGroup!.key])
            }
            compare(`${report}/${item.name}/group`, { rows: groups.rows, rowCount: groups.rowCount })
            if (!keys.length) continue
            const opened = await measured<JournalGridResult>(report, `${item.name}/open`, 'readJournalGrid', { ...grouping, route: [keys[0]] })
            expect(opened.revision).toBe(prime.revision); expect(opened.rowCount).toBe(lines.get(keys[0])!.length)
            expect(opened.rows.map(row => row.id)).toEqual(lines.get(keys[0])!.slice(0, 100).map(row => row.id))
            compare(`${report}/${item.name}/open`, { rows: opened.rows, rowCount: opened.rowCount })
          }
          for (const choice of ['single', 'manual-multi', 'all-found']) {
            const names = new Set(['project/facet', 'joint/facet', ...(choice === 'manual-multi' ? [] : ['joint/search']),
              ...(choice === 'all-found' ? ['joint/select-found'] : []), ...['rows', 'summary', 'group', 'open'].map(step => `${choice}/${step}`)])
            const steps = samples.slice(phaseStart).filter(sample => names.has(sample.name))
            chains.push({ phase, round, report, choice, milliseconds: steps.reduce((sum, step) => sum + (step.milliseconds ?? 0), 0),
              responseBytes: steps.reduce((sum, step) => sum + (step.responseBytes ?? 0), 0),
              httpSteps: steps.filter(step => step.rpc).map(step => step.name), localSteps: steps.filter(step => !step.rpc).map(step => step.name) })
          }
        }
        const after = await auditSqlCount(), detailsAfter = await auditSqlDetails()
        // Explanatory controls use the same actual choice expression. Keep
        // their EXPLAIN cost outside measured application RPCs and SQL counts.
        const plans = round === 0 ? await withE2eDatabase(async db => {
          const output: object[] = []
          for (const item of cases.filter(item => ['single', 'manual-multi', 'blank-null-empty-space', 'missing'].includes(item.name))) {
            const sql = "select count(*) from weld_joints where lower(trim(coalesce(project_title::text,'')))=any($1::text[]) and lower(trim(coalesce(joint::text,'')))=any($2::text[])"
            const parameters = [[selectedProject.toLowerCase()], item.values.map(normalizedJointChoice)]
            output.push({ name: item.name, sql, parameters, plan: (await db.query('explain (analyze,buffers,format json) ' + sql, parameters)).rows[0]['QUERY PLAN'] })
          }
          return output
        }) : undefined
        phases.push({ phase, round, revision: prime.revision, ...ddl, plans,
          statements: before === undefined || after === undefined ? undefined : after - before, detailsBefore, detailsAfter })
        expect(await jointChoiceSignature(profile)).toEqual(signature)
        console.log('JOINT_CHOICE_PHASE', JSON.stringify({ profile: profileName(profile), phase, round, samples: samples.length }))
        await save()
      }
    } catch (error) {
      failure = { name: error instanceof Error ? error.name : 'UnknownError', message: (error instanceof Error ? error.message : String(error)).split('\n')[0] }
      throw error
    } finally {
      try { await save() } finally {
        try { if (claimed) await removeJointChoiceIndex() } finally { if (seeded) await cleanupJointChoiceFixture(profile) }
      }
    }
  })
}
