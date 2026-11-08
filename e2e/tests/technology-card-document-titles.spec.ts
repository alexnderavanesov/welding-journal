import { expect, test } from '@playwright/test'
import { asE2eOwner } from '../with-owner-access'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { changeCard, previewAssignments, applyAssignments } from '../../src/server/technology-cards'

const project = 'E2E TK title preservation', name = 'E2E TK title materials'
const change = asE2eOwner(changeCard, 'references.edit')
const preview = asE2eOwner(previewAssignments, 'welding.view')
const apply = asE2eOwner(applyAssignments, 'welding.edit')
const types = ['layeredPvkEdges', 'layeredPvkLayers', 'layeredVikEdges']

test('TK material refresh updates dependent titles without repairing or rewriting historical documents', async () => {
  const savedTemplates = await withE2eDatabase(async db => (await db.query(
    'select id,constructor_config from document_templates where id=any($1::text[])', [types],
  )).rows)
  try {
    await change({ action: 'create', card: { name, weldingMethods: ['РАД'], connectionType: 'С17', materialGroups: ['М01'],
      diameterFrom: 57, diameterTo: 159, thicknessFrom: 3, thicknessTo: 8, psto: 'any', fillerWire: 'Проволока из ТК' } })
    const id = await withLineProgramFixture(async db => {
      // A historical layered assignment can survive changed/legacy welding
      // parameters. Refreshing material defaults must not repair its workflow.
      const row = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,technology_card_number,
        connection_type,material_group,welding_method,d1,d2,t1,t2,filler_wire,isometry,welding_journal_note)
        values($1,'TK-TITLE','L','F981','2026-10-01',$2,'С17','М01','РАД',57,159,6,3,'Старая проволока','ISO-KEEP','Не менять') returning id`,
      [project, name])).rows[0]
      const configs = [
        [{ type: 'field', field: 'fillerWire' }, { type: 'text', text: ' — ' }, { type: 'field', field: 'isometry' }],
        [{ type: 'field', field: '__documentNumber' }, { type: 'text', text: ' — ' }, { type: 'field', field: 'fillerWire' }],
        [{ type: 'field', field: 'isometry' }],
      ]
      for (const [index, type] of types.entries()) await db.query(`insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata,constructor_config)
        values($1,'tk-title-fixture','fixture.xlsx','xlsx',0,'{}',$2) on conflict(id) do update set constructor_config=excluded.constructor_config`,
      [type, JSON.stringify({ nameConfig: { parts: configs[index] } })])
      for (const [index, type] of [...types, types[0]].entries()) {
        const document = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,
          row_count,wdi_total,document_number,source_metadata,specialists,specialists_revision)
          values($1,$2,$3,'legacy/type','2025-01-01','2025-01-02',2,null,$4,
            '{"kind":"layeredControl","version":2}',
            '{"first":{"id":101,"name":"Исторический исполнитель","certificate":"OLD-CERT"}}',3) returning id`,
        [type, `Historical ${index}`, `Historical ${index}.xlsx`, index === 3 ? 78 : null])).rows[0]
        await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [document.id, row.id])
      }
      return row.id as number
    })
    const documents = () => withE2eDatabase(async db => (await db.query(`select d.*,a.created_at assignment_created_at
      from generated_documents d join generated_document_weld_joints a on a.document_id=d.id
      where a.weld_joint_id=$1 order by d.id`, [id])).rows)
    const joint = () => withE2eDatabase(async db => (await db.query('select * from weld_joints where id=$1', [id])).rows[0])
    const before = await documents(), beforeJoint = await joint()
    const scan = await preview({ afterId: id - 1 })
    const result = await apply({ context: scan.context, chunk: scan.chunks[0], actions: ['materials'], excludedIds: [] })
    expect(result.materials).toBe(1)
    const after = await documents(), afterJoint = await joint()
    expect(after).toHaveLength(4)
    expect(after[0]).toEqual({ ...before[0], title: 'Проволока из ТК — ISO-KEEP', file_name: 'Проволока из ТК — ISO-KEEP.xlsx', updated_at: after[0].updated_at })
    // Missing historical numbers, unrelated names and duplicate assignments
    // are left intact, including null WDI, old dates/MIME and specialist data.
    expect(after.slice(1)).toEqual(before.slice(1))
    expect(afterJoint).toEqual({ ...beforeJoint, filler_wire: 'Проволока из ТК',
      welding_updated_at: afterJoint.welding_updated_at, updated_at: afterJoint.updated_at })
  } finally {
    await cleanupLineProgramProjects([project])
    await withLineProgramFixture(async db => {
      await db.query('delete from technology_cards where name=$1', [name])
      for (const type of types) {
        const previous = savedTemplates.find(template => template.id === type)
        if (previous) await db.query('update document_templates set constructor_config=$2 where id=$1', [type, previous.constructor_config])
        else await db.query('delete from document_templates where id=$1', [type])
      }
    })
  }
})
