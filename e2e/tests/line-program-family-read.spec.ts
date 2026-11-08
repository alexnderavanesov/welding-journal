import { expect, test, type Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { linePrograms } from '../../src/db/schema'
import type { WeldRow } from '../../src/lib/dispatcher-types'
import { isTConnectionType } from '../../src/lib/connection-type'
import { asSupportLineProgram } from '../../src/lib/line-program'
import { calculateLineProgram } from '../../src/lib/line-program-calculation'
import { summarizeLineProgram } from '../../src/lib/line-program-overview'
import { attachProgramRepairRequirements } from '../../src/lib/line-program-repair-requirements'
import { explainLineProgram } from '../../src/lib/line-program-explanation'
import { unpackProgramRows } from '../../src/lib/line-program-row-payload'
import { loadProgramRows, type ProgramRowsPayload, type ProgramRowsWireResult } from '../../src/lib/line-program-row-stream'
import { type getLineProgramCalculation, type getLineProgramExplanation,
  loadLineProgramRows, loadProgramSystemIndexSettings, mapLineProgramCalculations, toLineProgramRecord } from '../../src/server/line-program'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { deserializeRpcHttpResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'

const project = 'E2E program family read equivalence'
const subtitle = 'FAMILY-READ'
type PublicReadResults = {
  getLineProgramCalculation: Awaited<ReturnType<typeof getLineProgramCalculation>>
  getLineProgramExplanation: Awaited<ReturnType<typeof getLineProgramExplanation>>
  getLineProgramJointPage: ProgramRowsPayload
}
async function publicRead<Name extends keyof PublicReadResults>(page: Page, observedUrl: string, name: Name, data: unknown): Promise<PublicReadResults[Name]> {
  const url = new URL(siblingRpcUrl(observedUrl, `${name}_createServerFn_handler`))
  url.searchParams.set('payload', await serializeRpcData(data))
  const response = await page.request.get(url.href, {
    headers: { origin: url.origin, 'sec-fetch-site': 'same-origin', 'x-tsr-serverFn': 'true' },
  })
  const payload = await deserializeRpcHttpResponse(new Response(Uint8Array.from(await response.body()), { status: response.status(), headers: response.headers() })) as {
    result: PublicReadResults[Name] | ProgramRowsWireResult; error?: Error
  }
  if (payload.error) throw payload.error
  expect(response.ok(), `${name}: authenticated public read`).toBe(true)
  return (name === 'getLineProgramJointPage' ? await loadProgramRows(async () => payload.result as ProgramRowsWireResult) : payload.result) as PublicReadResults[Name]
}
test.afterEach(() => cleanupLineProgramProjects([project]))

async function seed() {
  return withLineProgramFixture(async db => {
    const programs = (await db.query<{ id: number; line: string }>(`insert into line_programs(
      project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent,
      support_uzk_control_percent,support_pvk_control_percent)
      select $1,$2,line,'II','Б(а)',20,10,30,10 from unnest(array['MIXED','MOVED']) line returning id,line`, [project, subtitle])).rows
    const lineId = programs.find(row => row.line === 'MIXED')!.id
    const fixture: { key: string; joint: string; type: string | null; rejection?: string; legacy?: boolean }[] = [
      { key: 'f', joint: 'F1', type: 'С17', rejection: 'ремонт' },
      { key: 'r', joint: 'F1R1', type: 'С17', rejection: 'вырез' },
      { key: 'y1', joint: 'F1R1Y1', type: 'С17', rejection: 'ремонт' },
      { key: 'y2', joint: 'F1R1Y2', type: 'С17' },
      { key: 'yr', joint: 'F1R1Y1R1', type: 'С17' },
      { key: 'f2', joint: 'F2', type: 'У19', rejection: 'вырез' },
      { key: 'w', joint: 'F2W1', type: 'У19' },
      { key: 't', joint: 'ОП1', type: 'Т1', rejection: 'ремонт', legacy: true },
      { key: 'tr', joint: 'ОП1R1', type: 'Т1', legacy: true },
      { key: 'moved', joint: 'ОП-MOVED', type: 'Т1', rejection: 'ремонт' },
      { key: 'moved-r', joint: 'ОП-MOVEDR1', type: 'Т1' },
      // Historical inconsistency: preserve an ID pointing to another family;
      // this optimisation must not silently rebind or repair its topology.
      { key: 'cross', joint: 'ОП-CROSS', type: 'С17', rejection: 'ремонт' },
      { key: 'cross-r', joint: 'ОП-CROSSR1', type: 'Т1' },
    ]
    // Independent JS oracle covers every current ECMAScript trim character,
    // plus non-whitespace lookalikes and Latin T. Do not normalise fixture data.
    const whitespace = [9, 10, 11, 12, 13, 32, 160, 5760, ...Array.from({ length: 11 }, (_, n) => 8192 + n), 8232, 8233, 8239, 8287, 12288, 65279]
    const types = [...whitespace.map(code => `${String.fromCodePoint(code)}т4 `),
      '\u1c841', '\u1c851', '\t\u1c841 ', '\u00a0\u1c851 ', ' T1 ', '\u0085Т1', '\u200bТ1', '', null]
    types.forEach((type, n) => fixture.push({ key: `whitespace-${n}`, joint: `${isTConnectionType(type) ? 'ОП' : 'F'}-WS-${n}`, type, legacy: true }))
    const ids = new Map<string, number>()
    for (const row of fixture) {
      const stored = await db.query<{ id: number }>(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,
        connection_type,weld_date,officiality,revision_actuality,stamp_1_k,has_vik,vik_result,has_rk,rk_result,has_uzk,uzk_result,psto_required)
        values($1,$2,$3,$4,$5,$6,'2026-10-01','действующий','актуальная',$7,'да','годен',$8,$9,$10,$11,'нет') returning id`,
      [row.legacy ? null : lineId, project, subtitle, row.legacy ? ' mixed ' : 'MIXED', row.joint, row.type,
        isTConnectionType(row.type) ? 'H001' : 'G001', isTConnectionType(row.type) ? '' : 'да',
        isTConnectionType(row.type) ? null : row.rejection ?? 'годен', isTConnectionType(row.type) ? 'да' : '',
        isTConnectionType(row.type) ? row.rejection ?? 'годен' : null])
      ids.set(row.key, stored.rows[0].id)
    }
    const states: [string, 'primary' | 'repair' | 'coil', string, string | null, string | null, number | null][] = [
      ['f', 'primary', 'f', null, null, null], ['r', 'repair', 'f', 'f', null, null],
      ['y1', 'coil', 'y1', 'r', 'r', 1], ['y2', 'coil', 'y2', 'r', 'r', 2], ['yr', 'repair', 'y1', 'y1', null, null],
      ['f2', 'primary', 'f2', null, null, null], ['w', 'repair', 'f2', 'f2', null, null],
      ['moved', 'primary', 'moved', null, null, null], ['moved-r', 'repair', 'moved', 'moved', null, null],
      ['cross', 'primary', 'cross', null, null, null], ['cross-r', 'repair', 'cross', 'cross', null, null],
    ]
    for (const [key, kind, root, source, parent, side] of states) {
      await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id,coil_parent_id,coil_side,replaced_by_coil,replacement_coil_ids)
        values($1,$2,$3,$4,$5,$6,$7,$8)`, [ids.get(key), kind, ids.get(root), source ? ids.get(source) : null,
        parent ? ids.get(parent) : null, side, key === 'r', key === 'r' ? [ids.get('y1'), ids.get('y2')] : []])
    }
    // Preserve a moved historical root and intentionally stale FK: membership
    // remains identity-based, and the surviving repair keeps its stored IDs.
    await db.query("update weld_joints set line='MOVED' where id=$1", [ids.get('moved')])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,result,request_name,request_date,conclusion_name,conclusion_date)
      select id,'ВИК','годен','FAMILY-PRE','2026-09-29','FAMILY-PRE-C','2026-09-30' from weld_joints where project_title=$1`, [project])
    await db.query(`insert into duplicate_controls(weld_joint_id,method,result,control_date,conclusion,conclusion_date)
      select id,'ВИК','годен','2026-10-02','FAMILY-DUP','2026-10-02' from weld_joints where project_title=$1`, [project])
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_result,psto_date)
      select id,2,'FAMILY-REPEAT','2026-10-03','проведено','2026-10-04' from weld_joints where project_title=$1`, [project])
    return { ids, lineId, fixture }
  })
}

test('family SQL is equivalent to full-line hydration then JS filtering for whitespace, legacy and moved R/W/Y', async ({ page }) => {
  test.setTimeout(180000)
  const { ids, lineId, fixture } = await seed()
  const snapshot = await requireDb().transaction(async db => {
    const [stored] = await db.select().from(linePrograms).where(eq(linePrograms.id, lineId))
    const ordinary = toLineProgramRecord(stored), support = asSupportLineProgram(ordinary)
    const settings = await loadProgramSystemIndexSettings(db)
    const full = await loadLineProgramRows(db, ordinary)
    expect(full).toHaveLength(fixture.length - 1)
    expect(full.some(row => row.id === ids.get('moved'))).toBe(false)
    const expected = [ordinary, support].map(line => {
      const rows = full.filter(row => isTConnectionType(row.connectionType) === (line.family === 'supports'))
      return { line, rows }
    })
    for (const { line, rows } of expected) {
      expect(await loadLineProgramRows(db, line, line.family ?? 'welds')).toEqual(rows)
      expect(rows.every(row => row.preHeatTreatmentControls?.length === 1 && row.duplicateControls?.length === 1 && row.pstoRepeatCycles?.length === 1)).toBe(true)
    }
    // Same line ID appears in both families: OR-scoping must preserve each
    // output without duplicating SQL rows or dropping either family.
    const projectResult = (line: typeof ordinary, rows: WeldRow[], calculations: ReturnType<typeof calculateLineProgram>) => ({
      family: line.family ?? 'welds', ids: rows.map(row => row.id).sort((a, b) => a - b),
      states: rows.map(row => [row.id, row.programChainState]).sort((a, b) => Number(a[0]) - Number(b[0])),
      calculations, overview: summarizeLineProgram(rows, line, new Set(), calculations, settings),
    })
    const reference = expected.map(({ line, rows }) => {
      const contextual = attachProgramRepairRequirements(rows, new Set(), settings)
      return projectResult(line, contextual, calculateLineProgram(contextual, line.weldControlPercent!, line.pvkControlPercent!, settings, new Set(), line.family === 'supports'))
    })
    for (const programs of [[ordinary], [support], [ordinary, support]]) {
      const actual = await mapLineProgramCalculations(db, programs, ({ line, rows, calculations }) => projectResult(line, rows, calculations))
      expect(actual).toEqual(reference.filter(value => programs.some(line => (line.family ?? 'welds') === value.family)))
    }
    return { expected, settings }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })

  // The plain domain snapshot above needs no Start request context. Public
  // createServerFn reads below must use the authenticated HTTP boundary.
  const observed = page.waitForResponse(response => response.url().includes('/_serverFn/') &&
    /^getLineProgramSection(?:_|$)/.test(rpcName(response.url())))
  await page.goto('/line-program')
  const section = await observed
  expect(section.ok()).toBe(true)
  await section.finished()
  try {
    for (const { line, rows } of snapshot.expected) {
      const data = { id: line.id, family: line.family }
      const contextual = attachProgramRepairRequirements(rows, new Set(), snapshot.settings)
      const result = unpackProgramRows(await publicRead(page, section.url(), 'getLineProgramJointPage', data))
      expect(result.total).toBe(rows.length)
      expect(result.rows.map(row => ({ id: row.id, state: row.programChainState, requirements: row.programRepairRequirements })))
        .toEqual(contextual.map(row => ({ id: row.id, state: row.programChainState, requirements: row.programRepairRequirements })))
      const calculated = await publicRead(page, section.url(), 'getLineProgramCalculation', data)
      const reference = calculateLineProgram(contextual, line.weldControlPercent!, line.pvkControlPercent!, snapshot.settings, new Set(), line.family === 'supports')
      expect(calculated.stamps.map(value => ({ stamp: value.stamp, count: value.count })))
        .toEqual(reference.map(value => ({ stamp: value.stamp, count: value.rowIds.length })))
      const options = { ...data, kind: 'common' as const, list: 'physical' as const, page: 0 }
      expect(await publicRead(page, section.url(), 'getLineProgramExplanation', options)).toEqual(explainLineProgram(rows, line.weldControlPercent!, line.pvkControlPercent!, {
        ...options, support: line.family === 'supports', lineId: line.id, approved: new Set(), settings: snapshot.settings,
      }))
    }
  } finally { await page.close() }
})
