import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { drizzle } from 'drizzle-orm/node-postgres'
import { withE2eDatabase } from '../database'
import { withLineProgramFixture } from '../line-program-fixtures'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import { DOCUMENT_GRID_GROUP_FIELDS } from '../../src/lib/document-history-grid-state'
import { isDocumentHistoryGroupRow, type DocumentHistoryGridRequest } from '../../src/lib/document-history-grid'
import { SYSTEM_DOCUMENT_TYPES, type SystemDocumentType } from '../../src/lib/system-document-types'
import { GENERATED_DOCUMENT_HISTORY_FILTER_KEYS, loadRemoteGeneratedDocumentHistoryGrid,
  loadRemoteGeneratedDocumentHistoryFilterOptions, normalizeGeneratedDocumentHistoryGridRequest,
  normalizeGeneratedDocumentHistoryFilterOptionsRequest } from '../../src/server/generated-documents'
import { SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS, loadIndexedSystemDocumentHistoryGrid,
  loadIndexedSystemDocumentHistoryFilterOptions, loadSystemDocumentSummaries } from '../../src/server/system-document-index'
import { normalizeSystemDocumentHistoryGridRequest, normalizeSystemDocumentHistoryFilterOptionsRequest } from '../../src/server/system-documents'
import { touchDocumentMembershipParents } from '../../src/server/document-version'

// Functional SQL/API-helper matrix, not a latency benchmark. Parent owns the
// disposable runner and executes this separately from performance profiles.
const prefix = 'E2E deep document matrix '
const sentinelPrefix = 'E2E unrelated document matrix sentinel '
const defaults: DocumentHistoryGridRequest = { startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] }
type Expected = { id: number; fields: Record<string, string[]>; links: number[] }
type Family = { name: string; system?: SystemDocumentType; types?: string[]; fields: readonly string[]; documents: Expected[] }
const asciiTrim = (value: string) => value.replace(/^ +| +$/g, '')
const lower = (value: string) => value.toLocaleLowerCase('ru-RU')
const ids = (rows: Array<{ id: string | number }>) => rows.map(row => Number(String(row.id).replace('system-document:', ''))).sort((a, b) => a - b)

function matches(document: Expected, filters: Record<string, string>, search = '', omit?: string) {
  // Independent oracle receives explicit filter values below, never production
  // document normalizers, aggregators, SQL matchers or display helpers.
  return Object.entries(filters).every(([key, value]) => key === omit || !value.trim() || document.fields[key].some(item => lower(item).includes(lower(value.trim()))))
    && (!search.trim() || Object.values(document.fields).flat().some(item => lower(item).includes(lower(search.trim()))))
}
function choiceMatches(document: Expected, key: string, values: string[]) {
  return document.fields[key].some(item => values.some(value => lower(asciiTrim(item)) === lower(value.trim())))
}
function groupKey(values: string[]) {
  const unique = [...new Set(values.map(asciiTrim).filter(Boolean))]
  return JSON.stringify(unique.length === 0 ? ['empty'] : unique.length === 1 ? ['value', unique[0]] : ['multiple'])
}
function facetExpected(documents: Expected[], key: string, filters: Record<string, string>, search = '', gridSearch = '') {
  const counts = new Map<string, number>()
  for (const document of documents.filter(row => matches(row, filters, gridSearch, key))) {
    for (const value of new Set(document.fields[key].map(asciiTrim))) {
      if (!lower(value).includes(lower(search.trim()))) continue
      counts.set(value.trim(), (counts.get(value.trim()) ?? 0) + 1)
    }
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)))
}
const familyRequest = (family: Family) => family.system ? { type: family.system } : { types: family.types! }
const familySearch = (family: Family) => prefix + family.name + '-'
async function read(family: Family, columnFilters: Record<string, string> = {}, request: Partial<DocumentHistoryGridRequest> = {}, scoped = true) {
  const hasTitleFilter = 'title' in columnFilters
  const filters = scoped && !hasTitleFilter ? { title: familySearch(family), ...columnFilters } : columnFilters
  // Keep the compact path unless title itself is under test. Its empty/multi
  // choices need a separate search scope; do not interpret their encoding here.
  const data = { ...defaults, ...familyRequest(family), ...(scoped && hasTitleFilter ? { search: familySearch(family) } : {}),
    columnFilters: filters, ...request }
  return family.system
    ? loadIndexedSystemDocumentHistoryGrid(normalizeSystemDocumentHistoryGridRequest(data as never))
    : loadRemoteGeneratedDocumentHistoryGrid(normalizeGeneratedDocumentHistoryGridRequest(data as never))
}
async function documentSnapshot(excludedIds: number[] = []) {
  return withE2eDatabase(async client => ({
    documents: (await client.query(`select to_jsonb(document) as payload, xmin::text as version from generated_documents document
      where not (id=any($1::integer[])) order by id`, [excludedIds])).rows,
    relations: (await client.query(`select to_jsonb(assignment) as payload, xmin::text as version from generated_document_weld_joints assignment
      where not (document_id=any($1::integer[])) order by document_id,weld_joint_id`, [excludedIds])).rows,
  }))
}
async function facet(family: Family, fieldKey: string, columnFilters: Record<string, string>, search = '', gridSearch = '') {
  const data = { ...familyRequest(family), fieldKey, columnFilters, search, gridSearch }
  return family.system
    ? loadIndexedSystemDocumentHistoryFilterOptions(normalizeSystemDocumentHistoryFilterOptionsRequest(data as never))
    : loadRemoteGeneratedDocumentHistoryFilterOptions(normalizeGeneratedDocumentHistoryFilterOptionsRequest(data as never))
}

test('every document field preserves membership, contextual facets and multi-value grouping', async ({}, info) => {
  test.setTimeout(240_000)
  const documents: number[] = [], welds: number[] = [], coverage: object[] = []
  const sentinelIds = new Map<string, number>()
  const baselineFamilies = new Map<string, { total: number; ids: number[] }>()
  let ambientBefore: Awaited<ReturnType<typeof documentSnapshot>> | undefined
  let other: string | undefined
  // Initialize indexes before deliberate history cards; ordinary suite runs
  // may already contain unrelated history, which this matrix must preserve.
  for (const type of SYSTEM_DOCUMENT_TYPES) await loadSystemDocumentSummaries(type)
  const families: Family[] = [
    { name: 'generated', types: ['weldingJournal'], fields: GENERATED_DOCUMENT_HISTORY_FILTER_KEYS, documents: [] },
    { name: 'layered', types: ['layeredVikEdges', 'layeredVikLayers'], fields: GENERATED_DOCUMENT_HISTORY_FILTER_KEYS, documents: [] },
    ...SYSTEM_DOCUMENT_TYPES.map(system => ({ name: system, system, fields: SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS, documents: [] })),
  ]
  try {
    ambientBefore = await documentSnapshot()
    for (const family of families) {
      const existing = await read(family, {}, { search: '', idsOnly: true, endRow: 1 }, false)
      const existingIds = ids((existing.ids ?? []).map(id => ({ id })))
      expect(existing.total).toBe(existingIds.length)
      baselineFamilies.set(family.name, { total: existing.total, ids: existingIds })
    }
    await withLineProgramFixture(async client => {
      const existing = await client.query(`select id from generated_documents where title like $1 or title like $2`,
        [prefix + '%', sentinelPrefix + '%'])
      expect(existing.rows, 'No documents owned by a previous matrix run').toEqual([])
      other = (await client.query("select value from app_settings where key='other'")).rows[0]?.value
      await client.query(`insert into app_settings(key,value) values('other','{"wdiCalculationMode":"manual"}')
        on conflict(key) do update set value=excluded.value`)
      const facts = [
        ['Проект Альфа', 'Код-А', 'Л-1', '2026-10-01', 1.2],
        ['Проект Бета', 'Код-Б', 'Л-2', '2026-10-03', 2.3],
        ['Проект Альфа', 'Код-А', 'Л-1', '2026-10-02', null],
        ['Проект Альфа', 'Код-А', 'Л-1', null, 0],
        [null, null, '', null, null],
        ['Проект\u00a0Гамма', 'Код_100%', 'Л\\3', '2026-10-04', 4.5],
      ]
      for (const [project, subtitle, line, date, wdi] of facts) {
        const row = await client.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,wdi)
          values($1,$2,$3,$4,$5,$6) returning id`, [project, subtitle, line, prefix + welds.length, date, wdi])
        welds.push(row.rows[0].id)
      }
      // Every fresh run also has unrelated records with overlapping field
      // values. They are outside our title scope, but inside selectionOnly's
      // intentionally unfiltered registry/revision. Keep their IDs separate.
      const sentinelWeld = (await client.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,wdi)
        values('Проект Альфа','Код-А','Л-1',$1,'2026-10-05',11) returning id`, [sentinelPrefix])).rows[0].id
      welds.push(sentinelWeld)
      for (const family of families) {
        const storage = family.types?.[0] ?? (family.system === 'lnkConclusion' ? 'system:lnkConclusionVik' : `system:${family.system}`)
        const metadata = family.system ? { projects: ['Проект Альфа'], subtitleCodes: ['Код-А'], lines: ['Л-1'],
          methodCodes: ['ВИК'], positionCount: 1, sourcePositions: [] } : null
        const sentinel = (await client.query(`insert into generated_documents(type,title,file_name,mime_type,row_count,source_metadata)
          values($1,$2,'sentinel.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1,$3) returning id`,
        [storage, sentinelPrefix + family.name + '-ambient 100% A_B C\\path', metadata ? JSON.stringify(metadata) : null])).rows[0].id
        sentinelIds.set(family.name, sentinel)
        await client.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [sentinel, sentinelWeld])
      }
      // Shared membership is intentional: weld 0 occurs in several documents;
      // document 0 spans two projects/lines; empty and factual-empty differ.
      const links = [[0, 1, 2], [0, 3], [], [4], [5], [0, 5]]
      const projects = [['Проект Альфа', 'Проект Бета'], ['Проект Альфа'], [''], [''], ['Проект\u00a0Гамма'], ['Проект Альфа', 'Проект\u00a0Гамма']]
      const subtitles = [['Код-А', 'Код-Б'], ['Код-А'], [''], [''], ['Код_100%'], ['Код-А', 'Код_100%']]
      const lines = [['Л-1', 'Л-2'], ['Л-1'], [''], [''], ['Л\\3'], ['Л-1', 'Л\\3']]
      const periods = ['01.10.2026 - 03.10.2026', '01.10.2026 - 01.10.2026', '', '', '04.10.2026 - 04.10.2026', '01.10.2026 - 04.10.2026']
      const wdi = ['3,5', '1,2', '0', '0', '4,5', '5,7']
      for (const family of families) for (let index = 0; index < links.length; index++) {
        const title = prefix + `${family.name}-${index + 1}` + (index === 0 ? ' 100% A_B C\\path' : '')
        const first = index === 0 ? ' Анна ' : index === 1 ? 'анна' : index === 4 ? 'Ирина' : ''
        const second = index === 0 ? 'Борис' : index === 4 ? 'Олег' : ''
        const expected: Record<string, string[]> = { title: [title], specialistFirst: [first], specialistSecond: [second],
          project: projects[index], subtitle: subtitles[index], line: lines[index], rowCount: [String(links[index].length)] }
        let storage = family.types?.[family.name === 'layered' ? index % 2 : 0] ?? `system:${family.system}`
        let metadata: object | null = null
        if (family.system) {
          const methods = index === 0 ? ['ВИК', 'РК', 'ВИК'] : index === 1 ? ['ВИК'] : index === 4 ? ['ТВМТ'] : index === 5 ? ['РК'] : []
          const sourceKind = index === 1 ? 'beforeHeatTreatment' : index === 3 ? 'pstoRepeat' : index === 5 ? 'pstoCycle' : undefined
          const cycles = index === 3 ? [2, 3] : undefined
          // Index 5 intentionally uses the legacy sourcePositions fallback.
          metadata = index === 2 ? null : { projects: projects[index].filter(Boolean), subtitleCodes: subtitles[index].filter(Boolean),
            lines: lines[index].filter(Boolean), methodCodes: methods, sourceKind, cycleSequences: cycles,
            positionCount: links[index].length, sourcePositions: index === 5
              ? [{ kind: 'pstoCycle', weldJointId: welds[0], relationId: 0, sequence: 4 }] : [] }
          if (family.system === 'lnkConclusion') storage = index === 4 ? 'system:tvmtConclusion' : index === 2 ? 'system:lnkConclusionOther' : index % 2 ? 'system:lnkConclusionRk' : 'system:lnkConclusionVik'
          if (family.system === 'lnkRequest' && index === 4) storage = 'system:tvmtRequest'
          expected.method = methods.length ? methods : ['']
          expected.stage = [index === 1 ? 'До ТО' : index === 3 ? 'Циклы 2, 3' : index === 5 ? 'Цикл 4'
            : index === 4 || family.system.startsWith('psto') ? 'Цикл 1' : 'Основной']
          expected.date = [index === 2 ? '' : `0${index + 1}.10.2026`]
        } else {
          expected.stage = [family.name === 'layered' ? index % 2 ? 'Слои' : 'Кромки' : '']
          expected.period = [periods[index]]; expected.wdi = [wdi[index]]
          expected.updatedAt = ['01.11.2026, 12:00']
        }
        const result = await client.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,
          row_count,source_metadata,specialists,created_at,updated_at)
          values($1,$2,'matrix.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$3,$3,$4,$5,$6,
            '2026-11-01T09:00:00Z','2026-11-01T09:00:00Z') returning id`,
        [storage, title, index === 2 ? null : `2026-10-0${index + 1}`, links[index].length, metadata ? JSON.stringify(metadata) : null,
          JSON.stringify({ first: { name: first }, second: { name: second } })])
        const id = result.rows[0].id; documents.push(id)
        const members = links[index].map(position => welds[position])
        if (members.length) await client.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::integer[])', [id, members])
        family.documents.push({ id, fields: expected, links: members })
      }
    })
    const ambientWithSentinels = await documentSnapshot(documents)

    for (const family of families) {
      const full = await read(family), expectedIds = family.documents.map(row => row.id).sort((a, b) => a - b)
      // Title-only scope preserves compact system grouping. A global search
      // would intentionally select the production full-projection fallback.
      const groupScope = { title: familySearch(family) }
      expect(full.total, family.name).toBe(6)
      expect(ids(full.rows as Array<{ id: string | number }>), family.name).toEqual(expectedIds)
      for (const field of family.fields) {
        const nonempty = family.documents.flatMap(row => row.fields[field]).find(value => value.trim()) ?? ''
        const fragment = field === 'title' ? '100%' : nonempty ? nonempty.trim().slice(0, Math.min(4, nonempty.trim().length)).toUpperCase() : 'absent'
        const filters = { [field]: fragment }
        const matching = family.documents.filter(row => matches(row, filters))
        const filtered = await read(family, filters)
        expect(ids(filtered.rows as Array<{ id: string | number }>), `${family.name}/${field}/fragment`).toEqual(matching.map(row => row.id).sort((a, b) => a - b))
        expect(filtered.total).toBe(matching.length)
        const values = nonempty ? ['', nonempty.trim()] : ['']
        const checked = await read(family, { [field]: buildWeldColumnValueFilter(values) })
        expect(ids(checked.rows as Array<{ id: string | number }>), `${family.name}/${field}/choices`).toEqual(
          family.documents.filter(row => choiceMatches(row, field, values)).map(row => row.id).sort((a, b) => a - b))
        // Own filter is deliberately impossible. Facets must still list their
        // alternatives while respecting the other field and global search.
        const contextKey = field === 'title' ? 'project' : 'title'
        const contextValue = field === 'title' ? 'Альфа' : `${family.name}-`
        const contextual = { [field]: 'this value cannot match', [contextKey]: contextValue }
        for (const search of ['', fragment]) {
          const result = await facet(family, field, contextual, search, familySearch(family))
          const actual = Object.fromEntries(result.options.map(option => [option.value, option.count]).sort(([a], [b]) => String(a).localeCompare(String(b))))
          expect(actual, `${family.name}/${field}/facet/${search}`).toEqual(facetExpected(family.documents, field, contextual, search, familySearch(family)))
          expect(result.hasMore).toBe(false)
        }
        coverage.push({ family: family.name, field, fragment, matching: matching.length, modes: ['fragment', 'choices-with-empty', 'contextual-facet', 'facet-search'] })
      }
      for (const literal of ['%', '_', '\\', '=']) {
        const result = await read(family, { title: literal })
        expect(ids(result.rows as Array<{ id: string | number }>)).toEqual(family.documents.filter(row => matches(row, { title: literal })).map(row => row.id))
      }
      // Keep the actual quick-search probe, with an independent title scope
      // because this request intentionally overrides the default grid search.
      const combined = { project: 'Альфа', line: 'Л-1', title: familySearch(family) }
      const combination = await read(family, combined, { search: '100%' })
      expect(ids(combination.rows as Array<{ id: string | number }>)).toEqual(family.documents.filter(row => matches(row, combined, '100%')).map(row => row.id))
      // Unique full titles need no external search scope. This separately
      // retains compact exact-title coverage; empty choices remain above.
      const exactTitleDocuments = [family.documents[0], family.documents[4]]
      const exactTitles = await read(family, { title: buildWeldColumnValueFilter(exactTitleDocuments.map(row => row.fields.title[0])) }, { search: '' })
      expect(ids(exactTitles.rows as Array<{ id: string | number }>)).toEqual(exactTitleDocuments.map(row => row.id).sort((a, b) => a - b))
      expect(exactTitles.total).toBe(2)
      const selectedIds = family.documents.filter((_row, index) => index % 2 === 0).map(row => family.system ? `system-document:${row.id}` : row.id)
      for (const field of family.fields.filter(key => DOCUMENT_GRID_GROUP_FIELDS.has(key))) {
        const expected = new Map<string, Expected[]>()
        for (const row of family.documents) { const key = groupKey(row.fields[field]); expected.set(key, [...expected.get(key) ?? [], row]) }
        const result = await read(family, groupScope, { search: '', rowGroupCols: [field], selectedIds })
        expect(result.rowCount, `${family.name}/${field}/groups`).toBe(expected.size)
        expect(result.total).toBe(6)
        expect(result.revision).toBe(full.revision)
        for (const row of result.rows) {
          expect(isDocumentHistoryGroupRow(row)).toBe(true)
          if (!isDocumentHistoryGroupRow(row)) continue
          const members = expected.get(row.groupKey)!
          expect(members, row.groupKey).toBeDefined()
          expect(row.childCount).toBe(members.length)
          expect(row.selectedCount).toBe(members.filter(member => selectedIds.includes(family.system ? `system-document:${member.id}` : member.id)).length)
          const opened = await read(family, groupScope, { search: '', rowGroupCols: [field], groupKeys: [row.groupKey], selectedIds, revision: result.revision })
          expect(ids(opened.rows as Array<{ id: string | number }>)).toEqual(members.map(member => member.id).sort((a, b) => a - b))
          expect(opened.revision).toBe(result.revision)
        }
      }
      const allIds = await read(family, groupScope, { search: '', idsOnly: true, endRow: 1 })
      expect((allIds.ids ?? []).map(id => Number(String(id).replace('system-document:', ''))).sort((a, b) => a - b)).toEqual(expectedIds)
      const restore = await read(family, { title: 'impossible' }, { search: 'also impossible', selectionOnly: true, selectedIds })
      expect(ids(restore.rows as Array<{ id: string | number }>)).toEqual(selectedIds.map(id => Number(String(id).replace('system-document:', ''))).sort((a, b) => a - b))
      const unscoped = await read(family, {}, { search: '', idsOnly: true, endRow: 1 }, false)
      const baseline = baselineFamilies.get(family.name)!
      expect(unscoped.total).toBe(baseline.total + 6 + 1)
      expect(ids((unscoped.ids ?? []).map(id => ({ id })))).toEqual([...baseline.ids, ...expectedIds, sentinelIds.get(family.name)!].sort((a, b) => a - b))
      expect(restore.total).toBe(unscoped.total)
      // Revision hashes filtered_documents. selectionOnly deliberately skips
      // filters/search, so it shares the unscoped revision, not the six-card one.
      expect(restore.revision).toBe(unscoped.revision)
      expect(unscoped.revision).not.toBe(full.revision)
      expect(allIds.revision).toBe(full.revision)
      const multiple = JSON.stringify(['multiple'])
      const routes = [[], [multiple], [multiple, multiple]]
      const routeCounts = await read(family, groupScope, { search: '', rowGroupCols: ['project', 'line'], groupKeys: [multiple], selectedIds, countRoutes: routes })
      for (const route of routes) {
        const fields = ['project', 'line'].slice(0, route.length)
        const expected = family.documents.filter(row => selectedIds.includes(family.system ? `system-document:${row.id}` : row.id)
          && fields.every((field, index) => groupKey(row.fields[field]) === route[index])).length
        expect(routeCounts.counts?.[JSON.stringify(route)], `${family.name}/${JSON.stringify(route)}/selection-count`).toBe(expected)
      }
    }

    // Related facts change a manual registry even when its parent xmin does
    // not. This independently prevents an unsafe document-only revision hash.
    const manual = families[0], before = await read(manual)
    const versionsBefore = await withE2eDatabase(client => client.query('select id,xmin::text as version from generated_documents where id=any($1::integer[]) order by id', [manual.documents.map(row => row.id)]))
    await withLineProgramFixture(client => client.query('update weld_joints set wdi=7.2 where id=$1', [welds[0]]))
    const after = await read(manual)
    expect(after.revision).not.toBe(before.revision)
    await expect(read(manual, {}, { revision: before.revision })).rejects.toThrow('Данные реестра изменились')
    const versionsAfter = await withE2eDatabase(client => client.query('select id,xmin::text as version from generated_documents where id=any($1::integer[]) order by id', [manual.documents.map(row => row.id)]))
    expect(versionsAfter.rows).toEqual(versionsBefore.rows)
    const updated = after.rows.find(row => Number(row.id) === manual.documents[0].id) as unknown as { wdiTotal: number }
    expect(updated.wdiTotal).toBe(9.5)
    // System metadata/specialists remain in the version contract independently
    // of membership. Parent-level writes must invalidate a pinned selection.
    const system = families[2], systemBefore = await read(system)
    await withLineProgramFixture(client => client.query('update generated_documents set specialists=$2 where id=$1',
      [system.documents[0].id, JSON.stringify({ first: { name: 'Новый специалист' } })]))
    const systemAfter = await read(system)
    expect(systemAfter.revision).not.toBe(systemBefore.revision)
    await expect(read(system, {}, { revision: systemBefore.revision })).rejects.toThrow('Данные реестра изменились')
    // Exercise the existing link-only writer contract: lock/touch the parent
    // before replacing one relation, without changing title, metadata, count
    // or specialists. A metadata-only hash would miss this equal-size change.
    const membershipTarget = system.documents[1].id
    const parentPayload = async () => withE2eDatabase(client => client.query(`select title,source_metadata,row_count,specialists,period_from
      from generated_documents where id=$1`, [membershipTarget]))
    const payloadBefore = await parentPayload()
    await withLineProgramFixture(async client => {
      await touchDocumentMembershipParents(drizzle(client) as never, [membershipTarget])
      await client.query('delete from generated_document_weld_joints where document_id=$1 and weld_joint_id=$2', [membershipTarget, welds[3]])
      await client.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [membershipTarget, welds[1]])
    })
    expect((await parentPayload()).rows).toEqual(payloadBefore.rows)
    const relations = await withE2eDatabase(client => client.query('select weld_joint_id from generated_document_weld_joints where document_id=$1 order by weld_joint_id', [membershipTarget]))
    expect(relations.rows.map(row => row.weld_joint_id)).toEqual([welds[0], welds[1]])
    const membershipAfter = await read(system)
    expect(membershipAfter.revision).not.toBe(systemAfter.revision)
    await expect(read(system, {}, { revision: systemAfter.revision })).rejects.toThrow('Данные реестра изменились')
    expect(await documentSnapshot(documents), 'Unrelated history and sentinels survive all matrix reads/writes').toEqual(ambientWithSentinels)
    await writeFile(info.outputPath('deep-document-field-matrix.json'), JSON.stringify({ coverage, families: families.map(family => ({ name: family.name, count: family.documents.length })) }, null, 2))
  } finally {
    if (documents.length || sentinelIds.size || welds.length) await withLineProgramFixture(async client => {
      const ownedDocuments = [...documents, ...sentinelIds.values()]
      if (ownedDocuments.length) await client.query('delete from generated_documents where id=any($1::integer[])', [ownedDocuments])
      if (welds.length) await client.query('delete from weld_joints where id=any($1::integer[])', [welds])
      if (other === undefined) await client.query("delete from app_settings where key='other'")
      else await client.query("insert into app_settings(key,value) values('other',$1) on conflict(key) do update set value=excluded.value", [other])
    })
    if (ambientBefore) expect(await documentSnapshot(), 'Cleanup preserves the original unrelated document rows and links').toEqual(ambientBefore)
  }
})
