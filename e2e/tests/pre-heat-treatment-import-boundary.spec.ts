import { expect, test } from '@playwright/test'
import { importWeldJoints, massFillWeldJoints, replaceWeldJoints } from '../../src/server/weld-import'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { asE2eOwner } from '../with-owner-access'

const project = 'E2E preliminary import boundary audit'
const scope = { projectTitle: project, subtitleCode: 'PRE-IMPORT', line: 'PRE-IMPORT-L' }
const importRows = asE2eOwner(importWeldJoints, 'welding.import')
const massFill = asE2eOwner(massFillWeldJoints, 'welding.import')
const replace = asE2eOwner(replaceWeldJoints, 'welding.import')
test.afterEach(() => cleanupLineProgramProjects([project]))

const snapshot = () => withE2eDatabase(async db => ({
  rows: (await db.query('select *,xmin::text as version from weld_joints where project_title=$1 order by id', [project])).rows,
  programs: (await db.query('select * from line_programs where project_title=$1 order by id', [project])).rows,
}))

test('raw imports cannot set the chain requirement; each mixed batch rolls back and ordinary import remains available', async () => {
  await withLineProgramFixture(db => db.query(`insert into weld_joints
    (project_title,subtitle_code,line,joint,connection_type,has_vik,pre_heat_treatment_required)
    values($1,$2,$3,'F881','С17','да',false),($1,$2,$3,'F882','С17','да',true)`,
  [scope.projectTitle, scope.subtitleCode, scope.line]))
  const before = await snapshot(), [first, second] = before.rows
  await expect(importRows({ data: { records: [
    { ...scope, joint: 'F883' }, { ...scope, joint: 'F884', preHeatTreatmentRequired: true },
  ] } })).rejects.toThrow('НК до ТО не задаётся импортом')
  expect(await snapshot()).toEqual(before)

  await expect(replace({ data: { records: [{ id: first.id, preHeatTreatmentRequired: true }],
    deleteIds: [second.id], expectedVersions: before.rows.map(row => ({ id: row.id, version: row.version })),
  } })).rejects.toThrow('НК до ТО не задаётся импортом')
  expect(await snapshot()).toEqual(before)

  await expect(massFill({ data: { records: [
    { id: first.id, weldingJournalNote: 'Must roll back' }, { id: second.id, preHeatTreatmentRequired: false },
  ], expectedVersions: before.rows.map(row => ({ id: row.id, version: row.version })) } }))
    .rejects.toThrow('Поле "НК до ТО" недоступно')
  expect(await snapshot()).toEqual(before)

  const saved = await importRows({ data: { records: [{ ...scope, joint: 'F883', weldingJournalNote: 'Ordinary import' }] } })
  expect(saved.inserted).toBe(1)
  const after = await snapshot(), added = after.rows.find(row => row.id === saved.rows[0].id)!
  expect(added).toMatchObject({ joint: 'F883', welding_journal_note: 'Ordinary import', psto_required: null })
  expect(added.pre_heat_treatment_required).not.toBe(true)
})
