import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { asE2eOwner } from '../with-owner-access'
import { withE2eDatabase } from '../database'
import { resetE2eAccountFixtureLimits, authenticateE2eSafari, latestE2eToken } from '../authentication'
import { inviteAccount } from '../../src/server/account-management'

test.beforeEach(resetE2eAccountFixtureLimits)

test('installed Safari: invitation, wrong password, login, profile save, tab return and expired session without reload', async ({ baseURL }) => {
  test.skip(process.env.AUTH_SAFARI !== '1', 'Explicit installed Safari acceptance run')
  test.setTimeout(120000)
  const driver = spawn('/usr/bin/safaridriver', ['--port', '4471'], { stdio: 'ignore' })
  let session = ''
  const command = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch('http://127.0.0.1:4471' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw new Error(`Safari WebDriver: ${result.value?.error ?? response.status}`)
    return result.value
  }
  const execute = (script: string, ...args: unknown[]) => command(session + '/execute/sync', { script, args })
  const wait = (text: string) => expect.poll(() => execute('return document.body.innerText.includes(arguments[0])', text), { timeout: 25000, message: `Safari: ожидается «${text}»` }).toBe(true)
  const fill = async (selector: string, value: string) => {
    const element = await command(session + '/element', { using: 'css selector', value: selector })
    const path = session + '/element/' + element['element-6066-11e4-a52e-4f735466cecf']
    await command(path + '/clear', {})
    await command(path + '/value', { text: value })
  }
  const click = async (text: string) => { await execute('const b=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===arguments[0]);if(!b)throw new Error("button unavailable");b.click()', text) }
  const email = `safari-${randomUUID()}@e2e.test`
  try {
    await expect.poll(async () => { try { return !!(await command('/status')) } catch { return false } }, { timeout: 15000 }).toBe(true)
    const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })
    session = '/session/' + created.sessionId
    await command(session + '/window/rect', { x: 0, y: 0, width: 1600, height: 1050 })
    await command(session + '/window', { handle: await command(session + '/window') })
    console.log('AUTH_INSTALLED_SAFARI', JSON.stringify(created.capabilities))
    await asE2eOwner(inviteAccount, 'welding.view')({ name: 'Проверка Safari', email, title: 'Инженер', role: 'user', permissions: [] })
    const token = await latestE2eToken()
    await command(session + '/url', { url: baseURL + '/journal' }); await wait('Вход в систему')
    await command(session + '/url', { url: `${baseURL}/account-link#token=${token}&kind=invite` }); await wait('Активация приглашения')
    await fill('input[type=password]', 'safari123'); await fill('label:nth-of-type(2) input', 'safari123'); await click('Сохранить пароль'); await wait('Пароль сохранён')
    await command(session + '/url', { url: baseURL + '/account' }); await wait('Вход в систему')
    await fill('input[type=email]', email); await fill('input[type=password]', 'incorrect'); await click('Войти'); await wait('Не удалось войти')
    await fill('input[type=password]', 'safari123'); await click('Войти'); await wait('Мой профиль')
    const origin = await execute('return performance.timeOrigin')
    expect(await execute('return [...document.querySelectorAll("input")].find(i=>i.value===arguments[0]).readOnly', email)).toBe(true)
    expect(await execute(`return document.querySelector('form label:nth-of-type(2) input').readOnly`)).toBe(true)
    await fill('form:first-of-type label:nth-of-type(1) input', 'Новое имя Safari'); await click('Сохранить профиль')
    await expect.poll(() => withE2eDatabase(async db => (await db.query('select name from auth_users where email=$1', [email])).rows[0]?.name)).toBe('Новое имя Safari')
    // Wait for the completed profile refresh, not merely the database write.
    // Then verify a genuine visible-tab return before expiring the session.
    await wait('Новое имя Safari')
    await command(session + '/window', { handle: await command(session + '/window') })
    await execute('window.focus()')
    expect(await execute('return document.visibilityState')).toBe('visible')
    const reads = await execute('return performance.getEntriesByType("resource").filter(entry=>entry.name.includes("/_serverFn/")).length')
    await execute('window.dispatchEvent(new Event("focus"))')
    await expect.poll(() => execute('return performance.getEntriesByType("resource").filter(entry=>entry.name.includes("/_serverFn/")).length')).toBeGreaterThan(reads)
    await wait('Мой профиль')
    expect(await execute('return performance.timeOrigin')).toBe(origin)
    await withE2eDatabase(db => db.query('update auth_sessions set expires_at=now()-interval \'1 second\' where user_id=(select id from auth_users where email=$1)', [email]))
    await execute('window.dispatchEvent(new Event("focus"))'); await wait('Вход в систему')
    expect(await execute('return performance.timeOrigin')).toBe(origin)
    await command(session + '/url', { url: `${baseURL}/account-link#token=${token}&kind=invite` }); await wait('Активация приглашения')
    await fill('input[type=password]', 'safari123'); await fill('label:nth-of-type(2) input', 'safari123'); await click('Сохранить пароль'); await wait('Ссылка истекла, отозвана или уже использована.')
    // Existing opt-in Safari measurements use the isolated runner's session,
    // without warming the application's HTML or JavaScript before navigation.
    await authenticateE2eSafari(command, session)
    await command(session + '/url', { url: baseURL + '/account' }); await wait('Пользователи и права')
    await click('Пользователи и права'); await wait('Сотрудники и доступ')
    await wait('Посмотреть права'); await click('Посмотреть права'); await wait('Права доступа:')
    expect(await execute(`const boxes=[...document.querySelectorAll('[role="dialog"] input[type="checkbox"]')]; return boxes.length>0&&boxes.every(i=>i.checked&&i.disabled)`)).toBe(true)
    await execute(`document.querySelector('[aria-label="О разделе «Настройки данных»"]').click()`)
    expect(await execute(`return document.querySelector('[role="tooltip"]')?.textContent.includes('способов сварки')`)).toBe(true)
    await click('Закрыть')
    await command(session + '/url', { url: baseURL + '/activity' }); await wait('Сначала новые события')
    await expect.poll(() => execute(`return document.querySelectorAll('[role="grid"] [role="gridcell"]').length`), { timeout: 25000 }).toBeGreaterThan(0)
    await click('Подробности'); await wait('Было')
    await writeFile('/private/tmp/welding-access-ui-safari.png', Buffer.from(await command(session + '/screenshot'), 'base64'))
  } catch (error) {
    if (session) {
      console.log('AUTH_SAFARI_FAILURE_STATE', JSON.stringify(await execute('return {path:location.pathname,hidden:document.hidden,focused:document.hasFocus(),text:document.body.innerText.slice(0,1800)}').catch(() => null)))
      await writeFile('/private/tmp/welding-access-ui-safari-failure.png', Buffer.from(await command(session + '/screenshot'), 'base64')).catch(() => {})
    }
    throw error
  } finally {
    if (session) await command(session, undefined, 'DELETE').catch(() => undefined)
    driver.kill('SIGTERM')
    await withE2eDatabase(db => db.query('delete from auth_users where email=$1', [email]))
  }
})
