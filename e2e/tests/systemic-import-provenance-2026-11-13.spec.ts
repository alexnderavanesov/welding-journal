import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'
import { latestE2eToken, resetE2eAccountFixtureLimits } from '../authentication'
import { withE2eDatabase } from '../database'
import { asE2eOwner } from '../with-owner-access'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'

test.beforeEach(resetE2eAccountFixtureLimits)

test('new import ignores claimed row identity and rejects forged chain/control context atomically', async ({ browser, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Checks the production RPC manifest')
  const email = `import-provenance-${randomUUID()}@e2e.test`, project = `IMPORT-PROVENANCE-${randomUUID()}`
  await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Импорт стыков', email, title: '', role: 'user',
    permissions: ['welding.view', 'welding.import', 'lnk.view', 'lnk.edit', 'psto.view', 'psto.edit'] })
  await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password: 'audit123!' })
  const rootId = await withE2eDatabase(async db => {
    const program = (await db.query(`insert into line_programs(project_title,subtitle_code,line,psto_assignment)
      values($1,'S','L','unassigned') returning id`, [project])).rows[0].id
    return (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,
      connection_type,has_vik,pre_heat_treatment_required,final_status)
      values($1,$2,'S','L','F1','С17','да',true,'ожидает сварку') returning id`, [program, project])).rows[0].id as number
  })
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  const facts = () => withE2eDatabase(async db => (await db.query(
    'select to_jsonb(w) as row from weld_joints w where project_title=$1 order by id', [project])).rows.map(item => item.row))
  try {
    expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password: 'audit123!' }, headers: { origin: baseURL! } })).ok()).toBe(true)
    const page = await context.newPage()
    let observed = ''
    page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible()
    const importRecords = async (records: Record<string, unknown>[]) => {
      const response = await context.request.post(siblingRpcUrl(observed, 'importWeldJoints_createServerFn_handler'), {
        data: await serializeRpcData({ records }), headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin',
          'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
      })
      return await deserializeRpcResponse(await response.text()) as { result?: { inserted: number; rows: { id: number }[] }; error?: Error }
    }
    const importRecord = (record: Record<string, unknown>) => importRecords([record])
    const record = { projectTitle: project, subtitleCode: 'S', line: 'L', joint: 'F2', connectionType: 'С17', hasVik: 'да' }
    const before = await facts()
    for (const forged of [
      { programChainState: { kind: 'repair', weldJointId: -1, physicalRootId: rootId, sourceRowId: rootId, coilParentId: null, coilSide: null, replacedByCoil: false } },
      { preHeatTreatmentControls: [{ weldJointId: rootId, method: 'ВИК', result: 'годен' }] },
      { pstoRepeatCycles: [{ weldJointId: rootId, sequence: 2, pstoResult: 'проведено' }] },
      { duplicateControls: [{ weldJointId: rootId, method: 'ВИК', result: 'годен' }] },
      { programRepairRequirements: [] }, { layeredControlAssigned: true }, { earlyCoilDecisionAccepted: true },
      { lineProgramId: 123456 }, { preHeatTreatmentMode: 'off' },
    ]) {
      const result = await importRecord({ ...record, ...forged })
      expect(result.error?.message).toContain('недоступно для импорта')
      expect(result.result).toBeUndefined()
      expect(await facts()).toEqual(before)
    }
    // Specialty edit permissions do not authorize importing workflow history.
    // Include one ordinary row first: the complete batch must remain atomic.
    for (const history of [
      { vikRequest: 'V', vikRequestDate: '2026-07-02' },
      { vikResult: 'годен', vikConclusion: 'V-123', vikConclusionDate: '2026-07-03' },
      { rkRequest: 'R', rkResult: 'годен', rkConclusion: 'R-123', rkConclusionDate: '2026-07-03' },
      { uzkRequest: 'U', uzkResult: 'годен', uzkConclusion: 'U-123' },
      { pvkRequest: 'P', pvkResult: 'годен', pvkConclusion: 'P-123' },
      { pstoRequest: 'H', pstoRequestDate: '2026-07-02', pstoResult: 'проведено', pstoDate: '2026-07-03', heatTreatmentDiagram: '123' },
      { tvmtRequest: 'T', tvmtRequestDate: '2026-07-04', tvmtResult: 'годен', tvmtConclusion: 'T-123', tvmtConclusionDate: '2026-07-05' },
      { jsrDocument: 'JSR-123' }, { checklistDocument: 'CHECK-123' }, { zniDocument: 'ZNI-123' },
    ]) {
      const result = await importRecords([record, { ...record, joint: 'F3', ...history }])
      expect(result.error?.message).toContain('недоступны для импорта')
      for (const key of Object.keys(history)) expect(result.error?.message).toContain(key)
      expect(result.result).toBeUndefined()
      expect(await facts()).toEqual(before)
    }
    expect(await withE2eDatabase(async db => (await db.query(
      'select count(*)::int n from audit_operations where actor_id=(select id from auth_users where email=$1) and action=$2',
      [email, 'importWeldJoints'])).rows[0].n)).toBe(0)
    // Existing IDs are not an update selector in the new-record import mode.
    const valid = await importRecord({ ...record, id: rootId })
    expect(valid.error).toBeUndefined()
    expect(valid.result?.inserted).toBe(1)
    expect(valid.result?.rows[0].id).not.toBe(rootId)
    const after = await facts()
    expect(after.find(row => row.id === rootId)).toEqual(before[0])
    expect(after.find(row => row.joint === 'F2')).toMatchObject({ pre_heat_treatment_required: false })
    // Assigned VIK without a request has a derived waiting label, not a fact
    // of completed control. The import must preserve that normal workflow.
    expect(after.find(row => row.joint === 'F2')).toMatchObject({ vik_request: null, vik_result: 'ожидает заявку',
      vik_conclusion: null, vik_conclusion_date: null,
      rk_request: null, rk_result: null, psto_request: null, psto_result: null, tvmt_request: null, tvmt_result: null })
  } finally {
    await context.close()
    await cleanupLineProgramProjects([project])
    await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
  }
})
