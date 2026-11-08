import { expect, test, type BrowserContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { withE2eDatabase } from '../database'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { asE2eOwner } from '../with-owner-access'
import { latestE2eToken, resetE2eAccountFixtureLimits } from '../authentication'
import { inviteAccount, completeAccountLink } from '../../src/server/account-management'
import type { Permission } from '../../src/lib/access-permissions'
import { loadProgramRows, PROGRAM_ROWS_PROTOCOL, type ProgramRowsWireResult } from '../../src/lib/line-program-row-stream'
import { unpackProgramRows } from '../../src/lib/line-program-row-payload'
import { deserializeRpcHttpResponse, rpcName, serializeRpcPayload, siblingRpcUrl } from '../rpc'

// This focused HTTP regression complements the Chrome 50k/250k UI matrix.
// A moderate row count with distinct long notes deterministically exceeds the
// former 32MiB Seroval-record boundary without depending on row-shape estimates.
test('large program stream keeps every row and history, and redacts before transport for each real identity', async ({ browser, page, baseURL }, info) => {
  test.setTimeout(240000)
  await resetE2eAccountFixtureLimits()
  const project = `STREAM-ACCESS-${randomUUID()}`, line = 'STREAM-LINE'
  const count = 900, noteBody = 'Ж👷'.repeat(8192), password = 'stream123!'
  const accounts: string[] = [], contexts: BrowserContext[] = []
  // Discover the installed server-function ID through the actual application,
  // before the large fixture is inserted. No direct createServerFn invocation.
  const section = page.waitForResponse(response => response.url().includes('/_serverFn/') && /^getLineProgramSection(?:_|$)/.test(rpcName(response.url())))
  await page.goto('/line-program')
  const observed = await section
  expect(observed.ok()).toBe(true)
  await observed.finished()
  const endpoint = siblingRpcUrl(observed.url(), 'getLineProgramJointPage_createServerFn_handler')
  await page.close()
  let lineId = 0, ids: number[] = [], sourceBytes = 0
  try {
    const fixture = await withLineProgramFixture(async db => {
      const program = (await db.query<{ id: number }>(`insert into line_programs
        (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
        values($1,'STREAM',$2,'II','Б(а)',100,10) returning id`, [project, line])).rows[0]
      const rows = (await db.query<{ id: number }>(`insert into weld_joints
        (line_program_id,project_title,subtitle_code,line,joint,connection_type,weld_date,
        officiality,revision_actuality,isometry,welding_journal_note,lnk_note,psto_note,psto_required,
        stamp_1_k,has_vik,vik_result,has_rk,rk_result,created_at)
        select $1,$2,'STREAM',$3,'F'||lpad(n::text,4,'0'),'С17','2026-10-01',
        'действующий','актуальная',null,'PRIVATE-WELD-'||n||':'||$4,'PRIVATE-LNK-'||n,'PRIVATE-PSTO-'||n,'да',
        'STR1','да','годен','да','годен',timestamptz '2026-10-01T10:11:12Z'
        from generate_series(1,$5::int) n order by n returning id`, [program.id, project, line, noteBody, count])).rows
      const ordinaryIds = rows.map(row => row.id)
      await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
        select id,'primary',id from weld_joints where project_title=$1`, [project])
      await db.query(`insert into pre_heat_treatment_controls
        (weld_joint_id,method,request_name,request_date,conclusion_name,conclusion_date,result,created_at)
        select id,'ВИК','PRIVATE-PRE','2026-09-20','PRIVATE-PRE-C','2026-09-21','годен',timestamptz '2026-09-21T09:10:11Z'
        from weld_joints where id=any($1::int[])`, [[ordinaryIds[0], ordinaryIds.at(-1)]])
      await db.query(`insert into psto_repeat_cycles
        (weld_joint_id,sequence,psto_request,psto_request_date,psto_result,psto_date,tvmt_result,created_at)
        select id,2,'PRIVATE-REPEAT','2026-10-02','проведено','2026-10-03','годен',timestamptz '2026-10-03T12:13:14Z'
        from weld_joints where id=any($1::int[])`, [[ordinaryIds[0], ordinaryIds.at(-1)]])
      await db.query(`insert into duplicate_controls(weld_joint_id,method,result,control_date,conclusion,conclusion_date)
        select id,'ВИК','годен','2026-10-04','PRIVATE-DUP','2026-10-04' from weld_joints where id=any($1::int[])`, [[ordinaryIds[0], ordinaryIds.at(-1)]])
      const bytes = Number((await db.query('select sum(octet_length(welding_journal_note)) bytes from weld_joints where project_title=$1', [project])).rows[0].bytes)
      await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,officiality,revision_actuality,welding_journal_note,lnk_note,psto_note)
        values($1,$2,'STREAM',$3,'ОП1','Т1','действующий','актуальная','PRIVATE-SUPPORT','PRIVATE-SUPPORT-LNK','PRIVATE-SUPPORT-PSTO')`, [program.id, project, line])
      return { id: program.id, ids: ordinaryIds, bytes }
    })
    lineId = fixture.id; ids = fixture.ids; sourceBytes = fixture.bytes
    expect(sourceBytes).toBeGreaterThan(32 * 1024 * 1024)

    const openAccount = async (permissions: Permission[]) => {
      const email = `stream-${randomUUID()}@e2e.test`
      accounts.push(email)
      await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Проверка потока', email, title: '', role: 'user', permissions })
      await completeAccountLink({ token: await latestE2eToken(), kind: 'invite', password })
      const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
      contexts.push(context)
      expect((await context.request.post('/api/auth/sign-in/email', { data: { email, password }, headers: { origin: baseURL! } })).ok()).toBe(true)
      return context
    }
    const transport = async (context: BrowserContext, data: unknown, signal?: AbortSignal, forgedContext?: unknown, onChunk?: (bytes: number) => void) => {
      const url = new URL(endpoint)
      url.searchParams.set('payload', await serializeRpcPayload({ data, ...(forgedContext ? { context: forgedContext } : {}) }))
      const cookies = (await context.cookies(baseURL)).map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
      const response = await fetch(url, { signal, headers: { cookie: cookies, origin: baseURL!, 'sec-fetch-site': 'same-origin', 'x-tsr-serverFn': 'true', accept: 'application/x-tss-framed, application/json' } })
      expect(response.headers.get('cache-control')).toContain('no-store')
      let bytes = 0
      const body = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) { bytes += chunk.byteLength; controller.enqueue(chunk); onChunk?.(bytes) },
      }))
      const payload = await deserializeRpcHttpResponse(new Response(body, { status: response.status, headers: response.headers })) as { result?: ProgramRowsWireResult; error?: Error }
      return { payload, type: response.headers.get('content-type'), bytes: () => bytes }
    }
    const read = async (context: BrowserContext, data: Record<string, unknown> = { id: lineId }, forgedContext?: unknown) => {
      let received: Awaited<ReturnType<typeof transport>> | undefined
      const packed = await loadProgramRows(async signal => {
        received = await transport(context, { ...data, transport: PROGRAM_ROWS_PROTOCOL }, signal, forgedContext)
        if (received.payload.error) throw received.payload.error
        expect(received.type).toContain('application/x-tss-framed')
        expect(received.payload.result).toMatchObject({ protocol: PROGRAM_ROWS_PROTOCOL })
        return received.payload.result!
      })
      return { packed, restored: unpackProgramRows(packed), bytes: received!.bytes() }
    }
    const legacyRead = async (context: BrowserContext, forgedContext?: unknown) => {
      const received = await transport(context, { id: lineId, family: 'supports' }, undefined, forgedContext)
      if (received.payload.error) throw received.payload.error
      expect(received.type).not.toContain('application/x-tss-framed')
      const packed = received.payload.result
      if (!packed || !('rows' in packed)) throw new Error('A client without stream capability must receive the original plain payload')
      expect(packed).not.toHaveProperty('protocol')
      // The previous bundle calls unpackProgramRows directly, without a stream
      // decoder. Verify that exact compatibility path, under the same grants.
      return { packed, restored: unpackProgramRows(packed) }
    }

    const linesOnly = await openAccount(['lines.view'])
    const forged = { identity: { role: 'owner', permissions: ['welding.view', 'lnk.view', 'psto.view'] }, permissions: ['welding.view', 'lnk.view', 'psto.view'] }
    const limited = await read(linesOnly, { id: lineId, ...forged, nullFields: [], chainStates: [ids[0], ids.at(-1)!].map(id => [id, 'primary', id]) }, forged)
    expect(limited.restored.total).toBe(count)
    expect(limited.restored.rows.map(row => row.id)).toEqual(ids)
    expect(JSON.stringify(limited.packed)).not.toContain('PRIVATE-')
    expect(limited.packed).not.toHaveProperty('chainStates')
    expect(limited.packed).not.toHaveProperty('emptyRepairRequirementIds')
    expect(limited.packed.nullFields).not.toContain('rkRequest')
    for (const row of [limited.restored.rows[0], limited.restored.rows.at(-1)!]) {
      expect(row).toMatchObject({ isometry: null })
      for (const key of ['weldingJournalNote', 'lnkNote', 'pstoNote', 'rkRequest', 'programChainState', 'programRepairRequirements', 'preHeatTreatmentControls', 'pstoRepeatCycles', 'duplicateControls']) expect(row).not.toHaveProperty(key)
    }
    const limitedSupport = await read(linesOnly, { id: lineId, family: 'supports', ...forged }, forged)
    expect(limitedSupport.restored.rows).toHaveLength(1)
    expect(limitedSupport.restored.rows[0].joint).toBe('ОП1')
    expect(JSON.stringify(limitedSupport.packed)).not.toContain('PRIVATE-')
    expect((await legacyRead(linesOnly, forged)).packed).toStrictEqual(limitedSupport.packed)

    const lnkContext = await openAccount(['lines.view', 'lnk.view'])
    const lnk = await read(lnkContext)
    expect(lnk.restored.rows[0].lnkNote).toBe('PRIVATE-LNK-1')
    expect(lnk.restored.rows[0].preHeatTreatmentControls?.[0].requestName).toBe('PRIVATE-PRE')
    expect(lnk.restored.rows[0].duplicateControls?.[0].conclusion).toBe('PRIVATE-DUP')
    expect(lnk.restored.rows[0].preHeatTreatmentControls?.[0].createdAt).toBeInstanceOf(Date)
    expect(lnk.restored.rows[0]).not.toHaveProperty('pstoRepeatCycles')
    expect(lnk.restored.rows[0]).not.toHaveProperty('weldingJournalNote')
    expect(lnk.packed).not.toHaveProperty('chainStates')
    expect(lnk.packed.emptyRepairRequirementIds).toEqual(ids)
    const legacyLnk = await legacyRead(lnkContext, forged)
    expect(legacyLnk.packed).toStrictEqual((await read(lnkContext, { id: lineId, family: 'supports' })).packed)
    expect(legacyLnk.restored.rows[0].lnkNote).toBe('PRIVATE-SUPPORT-LNK')
    expect(legacyLnk.restored.rows[0]).not.toHaveProperty('weldingJournalNote')
    expect(legacyLnk.restored.rows[0]).not.toHaveProperty('pstoNote')

    const fullContext = await openAccount(['lines.view', 'welding.view', 'lnk.view', 'psto.view'])
    const cancellation = new AbortController(), cancelReason = new Error('E2E leaves a partially received program')
    let interruptedBytes = 0, published = false, rpcSignal: AbortSignal | undefined, decoding: ReadableStream<Uint8Array> | undefined
    const interrupted = loadProgramRows(async signal => {
      rpcSignal = signal
      const received = await transport(fullContext, { id: lineId, transport: PROGRAM_ROWS_PROTOCOL }, signal, undefined, bytes => {
        // Wait until the real envelope was decoded and the application owns
        // the raw reader. Then cancel the same signal used by fetch and codec.
        if (decoding?.locked && bytes >= 64 * 1024 && !cancellation.signal.aborted) {
          interruptedBytes = bytes
          cancellation.abort(cancelReason)
        }
      })
      if (received.payload.error) throw received.payload.error
      const result = received.payload.result
      if (!result || 'rows' in result || !('getReader' in result.stream)) throw new Error('Expected a real decoded HTTP raw stream')
      decoding = result.stream
      return result
    }, cancellation.signal).then(result => { published = true; return result })
    await expect(interrupted).rejects.toBe(cancelReason)
    expect(interruptedBytes).toBeGreaterThanOrEqual(64 * 1024)
    expect(rpcSignal?.aborted).toBe(true)
    expect(decoding?.locked).toBe(false)
    expect(published).toBe(false)
    // The normal complete read below is also the retry after HTTP cancellation.
    const full = await read(fullContext)
    expect(full.bytes).toBeGreaterThan(32 * 1024 * 1024)
    expect(interruptedBytes).toBeLessThan(full.bytes)
    expect(published).toBe(false)
    expect(full.restored.total).toBe(count)
    expect(full.restored.rows.map(row => row.id)).toEqual(ids)
    expect(full.restored.rows.every((row, index) => row.weldingJournalNote === `PRIVATE-WELD-${index + 1}:${noteBody}`)).toBe(true)
    expect(full.packed.nullFields).toContain('rkRequest')
    for (const row of [full.restored.rows[0], full.restored.rows.at(-1)!]) {
      expect(row.rkRequest).toBeNull()
      expect(row.programChainState).toMatchObject({ weldJointId: row.id, physicalRootId: row.id, kind: 'primary' })
      expect(row.preHeatTreatmentControls).toHaveLength(1)
      expect(row.duplicateControls).toHaveLength(1)
      expect(row.pstoRepeatCycles).toHaveLength(1)
      expect(row.pstoRepeatCycles?.[0]).toMatchObject({ sequence: 2, pstoRequest: 'PRIVATE-REPEAT', createdAt: new Date('2026-10-03T12:13:14Z') })
    }
    const legacyFull = await legacyRead(fullContext, forged)
    expect(legacyFull.packed).toStrictEqual((await read(fullContext, { id: lineId, family: 'supports' })).packed)
    expect(legacyFull.restored.rows[0]).toMatchObject({ weldingJournalNote: 'PRIVATE-SUPPORT', lnkNote: 'PRIVATE-SUPPORT-LNK', pstoNote: 'PRIVATE-SUPPORT-PSTO' })

    // Supplying a privileged client context must not replace the actual role.
    const deniedContext = await openAccount(['references.view'])
    for (const capability of [{}, { transport: PROGRAM_ROWS_PROTOCOL }]) {
      const denied = await transport(deniedContext, { id: lineId, family: 'supports', ...forged, ...capability }, undefined, forged)
      expect(denied.payload.error).toBeTruthy()
      expect(denied.payload.result).toBeUndefined()
      expect(JSON.stringify(denied.payload)).not.toContain('PRIVATE-')
    }
    const malformed = await transport(linesOnly, { id: lineId, family: 'all', ...forged, transport: PROGRAM_ROWS_PROTOCOL }, undefined, forged)
    expect(malformed.payload.error).toBeTruthy()
    expect(malformed.payload.result).toBeUndefined()
    const unknownTransport = await transport(linesOnly, { id: lineId, family: 'supports', transport: 'unsupported' })
    expect(unknownTransport.payload.error).toBeTruthy()
    expect(unknownTransport.payload.result).toBeUndefined()
    await info.attach('stream-access-summary', { body: JSON.stringify({ rows: count, sourceBytes, fullWireBytes: full.bytes,
      linesOnlyWireBytes: limited.bytes, lnkWireBytes: lnk.bytes, denied: true, legacyGrantParity: true,
      cancelledWireBytes: interruptedBytes, cancelledSnapshotPublished: published, completeRetry: true }), contentType: 'application/json' })
  } finally {
    for (const context of contexts) await context.close()
    await cleanupLineProgramProjects([project])
    if (ids.length) await withE2eDatabase(db => db.query('delete from weld_joint_program_states where weld_joint_id=any($1::int[])', [ids]))
    if (accounts.length) await withE2eDatabase(db => db.query('delete from auth_users where email=any($1::text[])', [accounts]))
  }
})
