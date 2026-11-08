import { expect, test } from '@playwright/test'
import { requireDb } from '../../src/db'
import { previewChainActualityInTransaction } from '../../src/server/chain-actuality'
import { updateWeldJoint as updateWeldJointHandler } from '../../src/server/weld-mutations'
import type { SystemDocumentSourcePosition } from '../../src/lib/system-document-types'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { asE2eOwner } from '../with-owner-access'

const project = 'E2E actuality stage waiting audit'
const prefix = 'ACT-STAGE-WAIT-'
const date = '2026-11-01'
const updateWeldJoint = asE2eOwner(updateWeldJointHandler, 'welding.edit')
test.afterEach(() => cleanupLineProgramProjects([project]))

async function fixture() {
  return withLineProgramFixture(async db => {
    const ids = (await db.query<{ id: number }>(`insert into weld_joints
      (project_title,subtitle_code,line,joint,weld_date,connection_type,has_vik,psto_required)
      select $1,'WAIT','WAIT-L',joint,'2026-10-01','С17','да','да'
      from unnest(array['F991','F991R1','F992']) joint returning id`, [project])).rows.map(row => row.id)
    const [root, facts, outside] = ids
    await db.query(`update weld_joints set psto_request=$1,psto_request_date=$3,psto_result='ожидает ПСТО',
      tvmt_request=$2,tvmt_request_date=$3,tvmt_result='ожидает ТВМТ' where id=any($4::int[])`,
    [prefix + 'P1', prefix + 'T1', date, [root, outside]])
    await db.query(`update weld_joints set psto_request=$1,psto_request_date=$3,psto_result='ожидает ПСТО',psto_date=$3,
      tvmt_request=$2,tvmt_request_date=$3,tvmt_result='ожидает ТВМТ',tvmt_conclusion='FACT-T1' where id=$4`,
    [prefix + 'FACT-P1', prefix + 'FACT-T1', date, facts])
    const cycles = (await db.query<{ id: number; weld_joint_id: number; sequence: number }>(`insert into psto_repeat_cycles
      (weld_joint_id,sequence,psto_request,psto_request_date,psto_result,heat_treatment_diagram,tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion_date)
      values ($1,2,$4||'P2',$3,'ожидает ПСТО',null,$4||'T2',$3,'ожидает ТВМТ',null),
        ($2,2,$4||'FACT-P2',$3,'ожидает ПСТО','FACT-D2',$4||'FACT-T2',$3,'ожидает ТВМТ',$3),
        ($2,3,$4||'UNKNOWN-P3',$3,'ожидает проверки факта',null,$4||'UNKNOWN-T3',$3,'архивный результат',null)
      returning id,weld_joint_id,sequence`, [root, facts, date, prefix])).rows
    const documents: Record<string, number> = {}
    const add = async (suffix: string, method: 'ПСТО' | 'ТВМТ', positions: SystemDocumentSourcePosition[]) => {
      const title = prefix + suffix
      const id = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,row_count,source_metadata)
        values($1,$2,$2||'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$3,$4,$5) returning id`,
      [method === 'ПСТО' ? 'system:pstoRequest' : 'system:tvmtRequest', title, date, positions.length,
        JSON.stringify({ sourceKind: 'pstoCycle', sourcePositions: positions, positionCount: positions.length })])).rows[0].id as number
      documents[suffix] = id
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])',
        [id, positions.map(position => position.weldJointId)])
    }
    for (const method of ['ПСТО', 'ТВМТ'] as const) {
      const letter = method === 'ПСТО' ? 'P' : 'T'
      const position = (rowId: number, relationId = rowId, sequence = 1): SystemDocumentSourcePosition => ({
        kind: 'pstoCycle', weldJointId: rowId, relationId, sequence, ...(method === 'ТВМТ' ? { methodCode: method } : {}),
      })
      await add(letter + '1', method, [position(root), position(outside)])
      await add('FACT-' + letter + '1', method, [position(facts)])
      for (const cycle of cycles) {
        const label = cycle.weld_joint_id === root ? '' : cycle.sequence === 2 ? 'FACT-' : 'UNKNOWN-'
        await add(label + letter + cycle.sequence, method, [position(cycle.weld_joint_id, cycle.id, cycle.sequence)])
      }
    }
    return { root, facts, outside, cycles, documents }
  })
}

async function snapshot() {
  return withE2eDatabase(async db => ({
    rows: (await db.query('select * from weld_joints where project_title=$1 order by id', [project])).rows,
    cycles: (await db.query('select c.* from psto_repeat_cycles c join weld_joints w on w.id=c.weld_joint_id where w.project_title=$1 order by c.id', [project])).rows,
    documents: (await db.query('select * from generated_documents where title like $1 order by id', [prefix + '%'])).rows,
    links: (await db.query('select r.* from generated_document_weld_joints r join generated_documents d on d.id=r.document_id where d.title like $1 order by r.document_id,r.weld_joint_id', [prefix + '%'])).rows,
  }))
}

test('actuality removes stage-specific waiting requests only; partial facts and unknown results survive in both cycles', async () => {
  const f = await fixture(), before = await snapshot()
  const preview = await requireDb().transaction(tx => previewChainActualityInTransaction(tx, { rowId: f.root, active: false }))
  expect(preview.total).toBe(2)
  expect(preview.pendingRequestCount).toBe(4)
  expect(await snapshot()).toEqual(before)
  const expectedVersion = await withE2eDatabase(async db => (await db.query('select xmin::text as version from weld_joints where id=$1', [f.root])).rows[0].version as string)
  await updateWeldJoint({ data: { id: f.root, expectedVersion,
    chainActualityConfirmation: { active: false, confirmed: true, token: preview.token } } })

  const after = await snapshot()
  const root = after.rows.find(row => row.id === f.root)!
  expect(root).toMatchObject({ revision_actuality: 'не актуален', psto_required: 'да',
    psto_request: null, psto_request_date: null, psto_result: null, tvmt_request: null, tvmt_request_date: null, tvmt_result: null })
  expect(after.cycles.find(cycle => cycle.weld_joint_id === f.root)).toMatchObject({
    psto_request: null, psto_request_date: null, psto_result: null, tvmt_request: null, tvmt_request_date: null, tvmt_result: null,
  })
  const factual = after.rows.find(row => row.id === f.facts)!, original = before.rows.find(row => row.id === f.facts)!
  for (const field of ['psto_request', 'psto_request_date', 'psto_result', 'psto_date', 'tvmt_request', 'tvmt_request_date', 'tvmt_result', 'tvmt_conclusion']) {
    expect(factual[field]).toEqual(original[field])
  }
  expect(factual.revision_actuality).toBe('не актуален')
  expect(after.cycles.filter(cycle => cycle.weld_joint_id === f.facts)).toEqual(before.cycles.filter(cycle => cycle.weld_joint_id === f.facts))
  expect(after.rows.find(row => row.id === f.outside)).toEqual(before.rows.find(row => row.id === f.outside))
  for (const suffix of ['P2', 'T2']) expect(after.documents.some(document => document.id === f.documents[suffix])).toBe(false)
  for (const suffix of ['P1', 'T1']) {
    const document = after.documents.find(item => item.id === f.documents[suffix])!
    expect(after.links.filter(link => link.document_id === document.id).map(link => link.weld_joint_id)).toEqual([f.outside])
    expect(JSON.parse(document.source_metadata).sourcePositions.map((position: SystemDocumentSourcePosition) => position.weldJointId)).toEqual([f.outside])
  }
  for (const document of before.documents.filter(item => /-(?:FACT|UNKNOWN)-/.test(item.title))) {
    expect(after.documents.find(item => item.id === document.id)).toEqual(document)
  }
})
