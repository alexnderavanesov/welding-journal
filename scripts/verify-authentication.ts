import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import pg from 'pg'

// This runner owns only the absent, freshly created database with this exact OID.
const name = `welding_tracker_auth_20261029_${process.pid}`
const url = `postgresql://welding:welding@127.0.0.1:5432/${name}`
const admin = new pg.Client({ connectionString: 'postgresql://welding:welding@127.0.0.1:5432/postgres' })
const output = await mkdtemp(join(tmpdir(), 'welding-auth-'))
let oid: number | undefined
let closeDatabase: (() => Promise<void>) | undefined
await admin.connect()
try {
  assert.equal((await admin.query('select oid from pg_database where datname=$1', [name])).rowCount, 0)
  await admin.query(`create database ${name}`)
  oid = (await admin.query('select oid from pg_database where datname=$1', [name])).rows[0].oid
  console.log('AUTH_TEST_DATABASE', JSON.stringify({ name, oid, host: '127.0.0.1' }))
  const check = new pg.Client({ connectionString: url }); await check.connect()
  const initial = (await check.query("select current_database() as name,(select count(*)::int from information_schema.tables where table_schema='public') as tables")).rows[0]
  assert.equal(initial.name, name); assert.equal(initial.tables, 0); await check.end()
  Object.assign(process.env, { DATABASE_URL: url, WELDING_ENV_LOADED: '1', BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    BETTER_AUTH_URL: 'http://127.0.0.1:3000', AUTH_MAIL_MODE: 'local', SMTP_HOST: '127.0.0.1', AUTH_MAIL_LOCAL_DIR: output,
    npm_config_manage_package_manager_versions: 'false' })
  execFileSync('pnpm', ['db:migrate'], { env: process.env, stdio: 'pipe' })
  const databaseModule = await import('../src/db/index')
  const { requireDb } = databaseModule
  closeDatabase = databaseModule.closeDatabase
  const db = requireDb()
  const { eq, sql, inArray } = await import('drizzle-orm')
  const schema = await import('../src/db/schema')
  const management = await import('../src/server/account-management')
  const { getAuth, handleAuthRequest } = await import('../src/server/auth')
  const { runWithAccess, toAccessIdentity } = await import('../src/server/access-context')
  const auth = getAuth()
  const ownerInput = { name: 'Проверочный владелец', email: 'owner@example.test', title: 'Директор' }
  const preparations = await Promise.all([management.bootstrapOwner(ownerInput), management.bootstrapOwner(ownerInput)])
  assert.ok(preparations.every(result => result.sent))
  assert.equal((await db.select().from(schema.authOwner)).length, 1)
  const link = async () => {
    const files = (await readdir(output)).sort()
    const raw = await readFile(join(output, files.at(-1)!), 'utf8')
    const body = raw.split(/\r?\n\r?\n/).slice(1).join('\n\n')
    const content = /Content-Transfer-Encoding: base64/i.test(raw)
      ? Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8')
      : body.replace(/=\r?\n/g, '').replace(/=3D/g, '=')
    const match = /token=([A-Za-z0-9_-]{48})/.exec(content)
    assert.ok(match, 'Local message must contain a single-use account link')
    return match[1]
  }
  const firstToken = await link()
  await management.bootstrapOwner(ownerInput)
  const token = await link(); assert.notEqual(firstToken, token)
  assert.equal((await db.select().from(schema.authUsers)).length, 1)
  await assert.rejects(() => management.completeAccountLink({ token: firstToken, kind: 'invite', password: 'secret' }))
  await assert.rejects(() => management.completeAccountLink({ token, kind: 'invite', password: 'short' }))
  const raced = await Promise.allSettled([0, 1].map(() => management.completeAccountLink({ token, kind: 'invite', password: 'secret' })))
  assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal((await db.select().from(schema.authAccounts)).length, 1)
  const owner = toAccessIdentity((await db.select().from(schema.authUsers))[0])
  assert.equal((await management.bootstrapOwner(ownerInput)).sent, false)
  const signedIn = await auth.handler(new Request('http://127.0.0.1:3000/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3000' }, body: JSON.stringify({ email: ownerInput.email, password: 'secret' }) }))
  assert.equal(signedIn.status, 200, await signedIn.text())
  const cookie = signedIn.headers.get('set-cookie'); assert.ok(cookie?.includes('HttpOnly'))
  assert.equal((await db.select().from(schema.authSessions)).length, 1)
  for (const path of ['/sign-up/email', '/request-password-reset', '/change-email', '/update-user', '/delete-user', '/admin/create-user']) {
    assert.equal((await handleAuthRequest(new Request(`http://127.0.0.1:3000/api/auth${path}`, { method: 'POST' }))).status, 404)
  }
  await runWithAccess(owner, 'inviteAccount', [], () => management.inviteAccount({ name: 'Инженер', email: 'engineer@example.test', title: '', role: 'user', permissions: ['welding.view', 'welding.edit'] }))
  const invitation = await link()
  await management.completeAccountLink({ token: invitation, kind: 'invite', password: 'secret' })
  const engineer = toAccessIdentity((await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, 'engineer@example.test')))[0])
  await assert.rejects(() => runWithAccess(engineer, 'deleteAccount', [], () => management.deleteAccount({ id: owner.id, revision: owner.revision, confirmed: true })))
  await runWithAccess(owner, 'updateWeldJoint', ['welding.edit'], () => db.transaction(async tx => {
    const [created] = await tx.insert(schema.weldJoints).values({ joint: 'AUTH-1', line: 'AUTH-LINE', weldingJournalNote: 'до' }).returning()
    await tx.update(schema.weldJoints).set({ weldingJournalNote: 'после' }).where(eq(schema.weldJoints.id, created.id))
  }))
  const joint = (await db.select().from(schema.weldJoints))[0]
  const history = await db.select().from(schema.auditChanges).where(eq(schema.auditChanges.jointId, joint.id))
  assert.equal(history.length, 1); assert.equal(history[0].kind, 'create'); assert.equal(history[0].changes.weldingJournalNote.after, 'после')
  const count = (await db.select().from(schema.auditChanges)).length
  await assert.rejects(() => runWithAccess(owner, 'updateWeldJoint', ['welding.edit'], () => db.transaction(async tx => {
    await tx.update(schema.weldJoints).set({ weldingJournalNote: 'rollback' }).where(eq(schema.weldJoints.id, joint.id))
    throw new Error('simulate failure')
  })))
  assert.equal((await db.select().from(schema.weldJoints))[0].weldingJournalNote, 'после')
  assert.equal((await db.select().from(schema.auditChanges)).length, count)
  await runWithAccess(owner, 'updateWeldJoint', ['welding.edit'], () => db.transaction(async tx => {
    await tx.update(schema.weldJoints).set({ updatedAt: new Date() }).where(eq(schema.weldJoints.id, joint.id))
  }))
  assert.equal((await db.select().from(schema.auditChanges)).length, count)
  await runWithAccess(owner, 'changeAccount', [], () => management.changeAccount({ id: engineer.id, revision: engineer.revision, role: 'user', permissions: ['welding.view'] }))
  await assert.rejects(() => runWithAccess(engineer, 'updateWeldJoint', ['welding.edit'], () => db.transaction(tx => tx.update(schema.weldJoints).set({ weldingJournalNote: 'forbidden' }).where(eq(schema.weldJoints.id, joint.id)))))
  // Both orderings of a permissions change versus a working transaction,
  // including a repeatable-read snapshot taken before the revocation.
  const grantEngineer = async (permissions: string[]) => {
    const [current] = await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, engineer.id))
    await runWithAccess(owner, 'changeAccount', [], () => management.changeAccount({ id: current.id, revision: current.revision, role: 'user', permissions }))
    return toAccessIdentity((await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, engineer.id)))[0])
  }
  const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
  let activeEngineer = await grantEngineer(['welding.view', 'welding.edit'])
  const oldSnapshot = deferred(), resumeSnapshot = deferred()
  const staleWrite = runWithAccess(activeEngineer, 'racedSave', ['welding.edit'], () => db.transaction(async tx => {
    await tx.select().from(schema.weldJoints).where(eq(schema.weldJoints.id, joint.id))
    oldSnapshot.resolve(); await resumeSnapshot.promise
    await tx.update(schema.weldJoints).set({ weldingJournalNote: 'revocation must win' }).where(eq(schema.weldJoints.id, joint.id))
  }, { isolationLevel: 'repeatable read' }))
  const staleResult = assert.rejects(() => staleWrite)
  await oldSnapshot.promise; await grantEngineer(['welding.view']); resumeSnapshot.resolve(); await staleResult
  assert.equal((await db.select().from(schema.weldJoints))[0].weldingJournalNote, 'после')
  activeEngineer = await grantEngineer(['welding.view', 'welding.edit'])
  const writeHeld = deferred(), commitWrite = deferred()
  const firstWrite = runWithAccess(activeEngineer, 'racedSave', ['welding.edit'], () => db.transaction(async tx => {
    await tx.update(schema.weldJoints).set({ weldingJournalNote: 'allowed before revocation' }).where(eq(schema.weldJoints.id, joint.id))
    writeHeld.resolve(); await commitWrite.promise
  }))
  await writeHeld.promise
  let revoked = false
  const revocation = grantEngineer(['welding.view']).then(() => { revoked = true })
  await new Promise(done => setTimeout(done, 150)); assert.equal(revoked, false)
  commitWrite.resolve(); await firstWrite; await revocation
  await assert.rejects(() => runWithAccess(activeEngineer, 'racedSave', ['welding.edit'], () => db.transaction(tx => tx.update(schema.weldJoints).set({ weldingJournalNote: 'too late' }).where(eq(schema.weldJoints.id, joint.id)))))
  assert.equal((await db.select().from(schema.weldJoints))[0].weldingJournalNote, 'allowed before revocation')
  // Credential changes, token expiry, account identity and history visibility.
  const freshUser = async (id: string) => (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, id)))[0]
  const freshEngineer = () => freshUser(engineer.id)
  const sessionCookie = cookie!.split(';')[0]
  const session = await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie }) })
  assert.equal(session?.user.id, owner.id)
  await db.update(schema.authSessions).set({ updatedAt: new Date(Date.now() - 7200000), expiresAt: new Date(Date.now() + 3600000) }).where(eq(schema.authSessions.userId, owner.id))
  const refreshed = await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie }), returnHeaders: true })
  assert.ok(refreshed.headers.get('set-cookie'), 'Sliding session must refresh the browser cookie')
  assert.ok((await db.select().from(schema.authSessions))[0].expiresAt.getTime() > Date.now() + 23 * 3600000)
  await runWithAccess(owner, 'sendManagedLink', [], () => management.sendManagedLink({ id: engineer.id, revision: 0, kind: 'recovery' })).then(() => assert.fail('Stale account revision must fail'), () => {})
  await runWithAccess(owner, 'sendManagedLink', [], async () => management.sendManagedLink({ id: engineer.id, revision: (await freshEngineer()).revision, kind: 'recovery' }))
  const expiredToken = await link()
  const verification = (await db.select().from(schema.authVerifications))[0]
  assert.ok(verification.expiresAt.getTime() <= Date.now() + 3600000)
  await db.update(schema.authVerifications).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.authVerifications.id, verification.id))
  await assert.rejects(() => management.completeAccountLink({ token: expiredToken, kind: 'recovery', password: 'secret2' }))
  await runWithAccess(owner, 'sendManagedLink', [], async () => management.sendManagedLink({ id: engineer.id, revision: (await freshEngineer()).revision, kind: 'recovery' }))
  const recovery = await link()
  await management.completeAccountLink({ token: recovery, kind: 'recovery', password: 'secret2' })
  await assert.rejects(() => management.completeAccountLink({ token: recovery, kind: 'recovery', password: 'secret2' }))
  await assert.rejects(() => runWithAccess(owner, 'updateOwnProfile', [], () => management.updateOwnProfile({ name: owner.name, title: '', revision: owner.revision, email: 'attacker@example.test' } as any)))
  const { assertSubmittedWeldFields } = await import('../src/server/access-payload')
  assert.throws(() => runWithAccess(owner, 'updateWeldJoint', ['welding.edit'], () => assertSubmittedWeldFields({ weldingJournalNote: 'allowed', pstoResult: 'forbidden' }, joint, 'welding')))
  const { auditSql, auditInsertedSql } = await import('../src/server/audited-database')
  await runWithAccess(owner, 'massFillWeldJoints', ['welding.import'], () => db.transaction(async tx => {
    await auditSql(tx, [{ table: schema.weldJoints, where: eq(schema.weldJoints.id, joint.id) }], () => tx.execute(sql`update ${schema.weldJoints} set welding_journal_note = 'SQL audit' where id = ${joint.id}`))
    await assert.rejects(() => tx.transaction(async nested => { await nested.update(schema.weldJoints).set({ weldingJournalNote: 'nested rollback' }).where(eq(schema.weldJoints.id, joint.id)); throw new Error('savepoint rollback') }))
  }))
  assert.equal((await db.select().from(schema.weldJoints))[0].weldingJournalNote, 'SQL audit')
  assert.ok(!(await db.select().from(schema.auditChanges)).some(change => JSON.stringify(change.changes).includes('nested rollback')))
  let documentId = 0
  await runWithAccess(owner, 'generateAuditFixture', ['documents.generate'], () => db.transaction(async tx => {
    const result = await auditInsertedSql(tx, schema.generatedDocuments, () => tx.execute(sql`insert into generated_documents(type,title,file_name,mime_type) values('jsr','Audit document','audit.xlsx','application/test') returning id`))
    documentId = Number(result.rows[0].id)
    await tx.insert(schema.generatedDocumentWeldJoints).values({ documentId, weldJointId: joint.id })
  }))
  assert.ok((await db.select().from(schema.auditChanges)).some(change => change.entity === 'generated_documents' && change.entityId === String(documentId) && change.kind === 'create'))
  await runWithAccess(owner, 'deleteAuditFixture', ['documents.delete'], () => db.transaction(tx => tx.delete(schema.generatedDocuments).where(eq(schema.generatedDocuments.id, documentId))))
  assert.ok((await db.select().from(schema.auditChanges)).some(change => change.entity === 'generated_document_weld_joints' && change.jointId === joint.id && change.kind === 'delete'))
  // A failure of the event write must roll back the actual business mutation.
  await db.execute(sql`create function auth_test_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'audit deliberately unavailable'; end $$`)
  await db.execute(sql`create trigger auth_test_reject_audit before insert on audit_changes for each row execute function auth_test_reject_audit()`)
  try {
    await assert.rejects(() => runWithAccess(owner, 'auditFailure', ['welding.edit'], () => db.transaction(tx => tx.update(schema.weldJoints).set({ weldingJournalNote: 'must rollback' }).where(eq(schema.weldJoints.id, joint.id)))))
    assert.equal((await db.select().from(schema.weldJoints).where(eq(schema.weldJoints.id, joint.id)))[0].weldingJournalNote, 'SQL audit')
  } finally {
    await db.execute(sql`drop trigger auth_test_reject_audit on audit_changes`)
    await db.execute(sql`drop function auth_test_reject_audit()`)
  }
  // Failure in the SECOND history batch must also roll back the first batch
  // and every business row. A retry records the complete operation once.
  await db.execute(sql`insert into weld_joints(project_title,joint,welding_journal_note)
    select 'AUTH-AUDIT-BATCH','BATCH-' || n::text,'original' from generate_series(1,600) n`)
  const batchScope = eq(schema.weldJoints.projectTitle, 'AUTH-AUDIT-BATCH')
  const historyCount = Number((await db.execute(sql`select count(*) from audit_changes`)).rows[0].count)
  await db.execute(sql`create function auth_test_reject_second_batch() returns trigger language plpgsql as $$ begin
    if (select count(*) from audit_changes where operation_id=new.operation_id) >= 500 then
      raise exception 'second audit batch deliberately unavailable'; end if; return new; end $$`)
  await db.execute(sql`create trigger auth_test_reject_second_batch before insert on audit_changes for each row execute function auth_test_reject_second_batch()`)
  const batchWrite = () => runWithAccess(owner, 'auditBatchRetry', ['welding.edit'], () => db.transaction(tx => tx.update(schema.weldJoints).set({ weldingJournalNote: 'changed' }).where(batchScope)))
  try {
    await assert.rejects(batchWrite)
    assert.equal(Number((await db.execute(sql`select count(*) from audit_changes`)).rows[0].count), historyCount)
    assert.equal((await db.select().from(schema.auditOperations).where(eq(schema.auditOperations.action, 'auditBatchRetry'))).length, 0)
    assert.ok((await db.select().from(schema.weldJoints).where(batchScope)).every(row => row.weldingJournalNote === 'original'))
  } finally {
    await db.execute(sql`drop trigger auth_test_reject_second_batch on audit_changes`)
    await db.execute(sql`drop function auth_test_reject_second_batch()`)
  }
  await batchWrite()
  await batchWrite() // Exact repeated save does not produce another event.
  assert.equal(Number((await db.execute(sql`select count(*) from audit_changes`)).rows[0].count) - historyCount, 600)
  assert.equal((await db.select().from(schema.auditOperations).where(eq(schema.auditOperations.action, 'auditBatchRetry'))).length, 1)
  assert.ok((await db.select().from(schema.weldJoints).where(batchScope)).every(row => row.weldingJournalNote === 'changed'))
  await db.delete(schema.weldJoints).where(batchScope)
  const [adminFixture, otherAdmin] = await db.insert(schema.authUsers).values([0, 1].map(n => ({ id: `test-admin-${n}`, email: `admin-${n}@example.test`, name: 'Администратор', role: 'admin' as const, status: 'active' as const, emailVerified: true }))).returning()
  const administrator = toAccessIdentity(adminFixture)
  for (const target of [owner, toAccessIdentity(otherAdmin)]) {
    await assert.rejects(() => runWithAccess(administrator, 'deleteAccount', [], () => management.deleteAccount({ id: target.id, revision: target.revision, confirmed: true })))
    await assert.rejects(() => runWithAccess(administrator, 'changeAccount', [], () => management.changeAccount({ id: target.id, revision: target.revision, role: 'user', permissions: [] })))
    await assert.rejects(() => runWithAccess(administrator, 'sendManagedLink', [], () => management.sendManagedLink({ id: target.id, revision: target.revision, kind: 'recovery' })))
  }
  await assert.rejects(() => runWithAccess(administrator, 'inviteAccount', [], () => management.inviteAccount({ name: 'Недопустимый администратор', email: 'forbidden-admin@example.test', title: '', role: 'admin', permissions: [] })))
  await runWithAccess(owner, 'changeAccount', [], () => management.changeAccount({ id: otherAdmin.id, revision: otherAdmin.revision, role: 'user', permissions: [] }))
  await runWithAccess(administrator, 'deleteAccount', [], () => management.deleteAccount({ id: otherAdmin.id, revision: otherAdmin.revision + 1, confirmed: true }))
  const previousMailMode = process.env.AUTH_MAIL_MODE
  process.env.AUTH_MAIL_MODE = 'invalid-test-mode'
  try {
    const delivery = await runWithAccess(owner, 'inviteAccount', [], () => management.inviteAccount({ name: 'Сбой почты', email: 'mail-failure@example.test', title: '', role: 'user', permissions: [] }))
    assert.equal(delivery.sent, false)
    const [pending] = await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, 'mail-failure@example.test'))
    assert.equal(pending.status, 'pending'); assert.equal(pending.emailVerified, false)
    process.env.AUTH_MAIL_MODE = previousMailMode
    assert.equal((await runWithAccess(owner, 'sendManagedLink', [], () => management.sendManagedLink({ id: pending.id, revision: pending.revision, kind: 'invite' }))).sent, true)
  } finally { process.env.AUTH_MAIL_MODE = previousMailMode }
  const { listActivityHistory, getActivityDetails, getActivityFilters } = await import('../src/server/activity-history')
  const reader = { ...owner, id: engineer.id, role: 'user' as const, permissions: ['welding.view', 'history.view'] as const }
  await runWithAccess(owner, 'lnkEdit', ['lnk.edit'], () => db.transaction(tx => tx.update(schema.weldJoints).set({ lnkNote: 'private LNK' }).where(eq(schema.weldJoints.id, joint.id))))
  const visible = await runWithAccess(reader as any, 'history', [], () => listActivityHistory({}))
  assert.ok(!visible.rows.some(row => row.action === 'lnkEdit'))
  const hiddenOperation = (await db.select().from(schema.auditOperations).where(eq(schema.auditOperations.action, 'lnkEdit')))[0]
  const hiddenDetails = await runWithAccess(reader as any, 'details', [], () => getActivityDetails({ operationId: hiddenOperation.id }))
  assert.equal(hiddenDetails.rows.length, 0)
  const visibleAuthors = await runWithAccess(reader as any, 'history', [], () => getActivityFilters({}))
  assert.ok(visibleAuthors.authors.some(author => author.id === owner.id), 'An older visible event must keep its author available')
  assert.ok(!visibleAuthors.authors.some(author => author.id === administrator.id), 'An author with only inaccessible account events must remain hidden')
  const historyActor = toAccessIdentity((await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, administrator.id)))[0])
  await runWithAccess(historyActor, 'updateOwnProfile', [], () => management.updateOwnProfile({ name: 'Другое ФИО администратора', title: '', revision: historyActor.revision }))
  const authors = await runWithAccess(owner, 'history', [], () => getActivityFilters({}))
  assert.equal(new Set(authors.authors.map(author => author.id)).size, authors.authors.length)
  const operatorEvents = await runWithAccess(owner, 'history', [], () => listActivityHistory({ actorId: '@operator' }))
  assert.ok(operatorEvents.rows.length > 0 && operatorEvents.rows.every(row => row.actorId === null))
  const renamedAdmin = toAccessIdentity(await freshUser(administrator.id))
  await runWithAccess(renamedAdmin, 'updateOwnProfile', [], () => management.updateOwnProfile({ name: engineer.name, title: '', revision: renamedAdmin.revision }))
  const namesake = toAccessIdentity(await freshUser(administrator.id))
  const beforeNoop = (await db.select().from(schema.auditOperations)).length
  await runWithAccess(namesake, 'updateOwnProfile', [], () => management.updateOwnProfile({ name: namesake.name, title: namesake.title, revision: namesake.revision }))
  assert.equal((await db.select().from(schema.auditOperations)).length, beforeNoop)
  assert.equal((await freshUser(namesake.id)).revision, namesake.revision)
  await runWithAccess(namesake, 'updateWeldJoint', ['welding.edit'], () => db.transaction(tx => tx.update(schema.weldJoints).set({ weldingJournalNote: 'namesake history' }).where(eq(schema.weldJoints.id, joint.id))))
  const sameNames = await runWithAccess(owner, 'history', [], () => getActivityFilters({ search: engineer.name }))
  assert.ok(sameNames.authors.some(author => author.id === namesake.id && author.name === engineer.name))
  assert.ok(sameNames.authors.some(author => author.id === engineer.id && author.name === engineer.name))
  // Full database precision must survive the page cursor. All sixty events
  // deliberately share a timestamp with microseconds, beyond JS Date precision.
  await db.execute(sql`insert into audit_operations(id,actor_id,actor_name,action,area,source,created_at)
    select 'pagination-' || lpad(n::text,3,'0'), ${owner.id}, ${owner.name}, 'paginationFixture', 'welding', 'application',
      '2026-10-29T00:00:00.123456Z'::timestamptz from generate_series(1,60) n`)
  await db.execute(sql`insert into audit_changes(operation_id,entity,entity_id,joint_id,label,area,kind,changes)
    select id,'weld_joints',${String(joint.id)},${joint.id},'Pagination fixture','welding','update',
      '{"weldingJournalNote":{"before":"before","after":"after"}}'::jsonb from audit_operations where action='paginationFixture'`)
  const pagination = { jointId: joint.id, from: '2026-10-29T00:00:00Z', action: 'paginationFixture', actorId: owner.id }
  const firstPage = await runWithAccess(owner, 'history', [], () => listActivityHistory(pagination))
  assert.equal(firstPage.rows.length, 50); assert.ok(firstPage.nextCursor)
  await db.execute(sql`insert into audit_operations(id,actor_id,actor_name,action,area,source,created_at)
    values('pagination-new',${owner.id},${owner.name},'paginationFixture','welding','application',${firstPage.until}::timestamptz + interval '1 second')`)
  await db.execute(sql`insert into audit_changes(operation_id,entity,entity_id,joint_id,label,area,kind,changes)
    values('pagination-new','weld_joints',${String(joint.id)},${joint.id},'New event','welding','update','{"weldingJournalNote":{"after":"new"}}'::jsonb)`)
  const secondPage = await runWithAccess(owner, 'history', [], () => listActivityHistory({ ...pagination, until: firstPage.until, cursor: firstPage.nextCursor! }))
  assert.equal(secondPage.rows.length, 10); assert.equal(secondPage.nextCursor, null)
  assert.equal(new Set([...firstPage.rows, ...secondPage.rows].map(row => row.id)).size, 60)
  assert.ok(![...firstPage.rows, ...secondPage.rows].some(row => row.id === 'pagination-new'))
  await runWithAccess(owner, 'deleteAccount', [], async () => management.deleteAccount({ id: engineer.id, revision: (await freshEngineer()).revision, confirmed: true }))
  assert.equal(await freshEngineer(), undefined)
  assert.equal((await db.select().from(schema.authAccounts).where(eq(schema.authAccounts.userId, engineer.id))).length, 0)
  assert.equal((await db.select().from(schema.weldJoints)).length, 1)
  await runWithAccess(owner, 'inviteAccount', [], () => management.inviteAccount({ name: 'Инженер', email: 'engineer@example.test', title: '', role: 'user', permissions: [] }))
  const replacement = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, 'engineer@example.test')))[0]
  assert.notEqual(replacement.id, engineer.id)
  assert.ok((await db.select().from(schema.auditOperations).where(eq(schema.auditOperations.actorId, engineer.id))).length > 0)
  const throttled = await Promise.allSettled(Array.from({ length: 15 }, () => management.accountRateLimit('integration-concurrent', 10)))
  assert.equal(throttled.filter(result => result.status === 'fulfilled').length, 10)
  assert.equal(throttled.filter(result => result.status === 'rejected').length, 5)
  await db.update(schema.authRateLimits).set({ lastRequest: Date.now() - 61000 }).where(eq(schema.authRateLimits.key, 'integration-concurrent'))
  await management.accountRateLimit('integration-concurrent', 10)
  assert.equal((await db.select().from(schema.authRateLimits).where(eq(schema.authRateLimits.key, 'integration-concurrent')))[0].count, 1)
  // Exercise the public handler too: eight failed credentials, then a bounded
  // rejection, including the response header. A full path bucket must reject
  // before creating a bucket for another arbitrary email address.
  process.env.AUTH_TRUST_PROXY = 'false'
  const failedLogin = (email: string) => handleAuthRequest(new Request('http://127.0.0.1:3000/api/auth/sign-in/email', { method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3000' }, body: JSON.stringify({ email, password: 'incorrect' }) }))
  for (let index = 0; index < 8; index++) assert.equal((await failedLogin('throttle@example.test')).status, 401)
  const deniedLogin = await failedLogin('throttle@example.test')
  assert.equal(deniedLogin.status, 429); assert.equal(deniedLogin.headers.get('retry-after'), '60')
  await db.update(schema.authRateLimits).set({ count: 60, lastRequest: Date.now() }).where(eq(schema.authRateLimits.key, 'signin-path:shared'))
  const buckets = (await db.select().from(schema.authRateLimits)).length
  assert.equal((await failedLogin('never-stored-throttle@example.test')).status, 429)
  assert.equal((await db.select().from(schema.authRateLimits)).length, buckets)
  console.log('PASS: atomic concurrent rate limiting, window expiry, HTTP credential throttling and bounded anonymous bucket creation.')
  console.log('PASS: isolated migration, owner protection, single-use/raced/replaced/expired links, recovery, sliding cookies, immutable email, deleted/reinvited identity, mixed payload rejection, raw SQL audit, nested rollback, redacted history, revoked rights.')
  if (process.env.AUTH_SCALE === '1') await (await import('./authentication-load')).measureAuthenticationLoad(db, owner)
  if (process.env.AUTH_BULK_AUDIT === '1') await (await import('./authentication-bulk-audit-load')).measureBulkAuditLoad(db, owner)
  await db.execute(sql`select 1`)
} finally {
  await closeDatabase?.()
  if (oid !== undefined) {
    const current = (await admin.query('select oid from pg_database where datname=$1', [name])).rows[0]?.oid
    if (current === oid) await admin.query(`drop database ${name} with (force)`)
    else if (current !== undefined) throw new Error('Test database was replaced; preserving it.')
  }
  await admin.end(); await rm(output, { recursive: true, force: true })
}
