import { expect, type Page, type TestInfo } from '@playwright/test'
import { prepareSafariMeasurementWindow } from './safari-foreground'

export type PopupBrowser = {
  kind: 'chrome' | 'installed-safari'
  execute: (script: string, ...args: unknown[]) => Promise<any>
  navigate: (path: string) => Promise<unknown>
  click: (selector: string, label?: string, context?: boolean) => Promise<void>
  fill: (selector: string, value: string) => Promise<void>
  key: (key: 'Escape' | 'Enter' | 'Space') => Promise<void>
  frames: () => Promise<unknown>
  close: () => Promise<void>
}

export async function popupWait(browser: PopupBrowser, script: string, ...args: unknown[]) {
  await expect.poll(() => browser.execute(script, ...args), { timeout: 240_000, intervals: [20, 40, 75, 100], message: script }).toBe(true)
}

export function chromePopupBrowser(page: Page): PopupBrowser {
  const browser: PopupBrowser = {
    kind: 'chrome', execute: (script, ...args) => page.evaluate(({ script, args }) => new Function(script).apply(null, args), { script, args }),
    navigate: path => page.goto(path),
    click: async (selector, label, context = false) => {
      const target = page.locator(selector)
      const index = await target.evaluateAll((elements, label) => elements.findIndex(element => element.getClientRects().length &&
        !(element as HTMLButtonElement).disabled && (label === null || element.textContent?.trim() === label || element.getAttribute('aria-label') === label)), label ?? null)
      expect(index, `Visible enabled target ${selector} / ${label ?? ''}`).toBeGreaterThanOrEqual(0)
      await target.nth(index).click({ button: context ? 'right' : 'left' })
    },
    fill: (selector, value) => page.locator(selector).fill(value),
    key: async key => { await page.keyboard.press(key) },
    frames: () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))),
    close: async () => {},
  }
  return browser
}

/** The caller owns /usr/bin/safaridriver --port 4445; this owns one new session only. */
export async function safariPopupBrowser(info: TestInfo): Promise<PopupBrowser> {
  const origin = new URL(String(info.project.use.baseURL))
  expect([origin.hostname, origin.port]).toEqual(['127.0.0.1', '3100'])
  const command = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<any> => {
    const response = await fetch('http://127.0.0.1:4445' + path, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000) })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw new Error(`${path}: ${JSON.stringify(result.value)}`)
    return result.value
  }
  const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari', pageLoadStrategy: 'eager' } } })
  const session = '/session/' + created.sessionId
  const execute = (script: string, ...args: unknown[]) => command(session + '/execute/sync', { script, args })
  const browser: PopupBrowser = {
    kind: 'installed-safari', execute, navigate: path => command(session + '/url', { url: origin.origin + path }),
    // Honest DOM activation through native Safari, not a claim of OS pointer input.
    click: async (selector, label, context = false) => {
      await popupWait(browser, `return [...document.querySelectorAll(arguments[0])].some(e=>e.getClientRects().length&&!e.disabled&&
        (arguments[1]===null||e.textContent.trim()===arguments[1]||e.getAttribute('aria-label')===arguments[1]))`, selector, label ?? null)
      await execute(`const e=[...document.querySelectorAll(arguments[0])].find(e=>e.getClientRects().length&&!e.disabled&&
        (arguments[1]===null||e.textContent.trim()===arguments[1]||e.getAttribute('aria-label')===arguments[1]));
        if(arguments[2]){const b=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:b.x+b.width/2,clientY:b.y+b.height/2}))}else e.click()`, selector, label ?? null, context)
    },
    fill: async (selector, value) => {
      const element = await command(session + '/element', { using: 'css selector', value: selector })
      await execute('const e=document.querySelector(arguments[0]);e.focus();e.select()', selector)
      // Element Send Keys exercises the real React input path. Backspace also
      // clears an empty replacement; an empty text command alone is a no-op.
      await command(session + '/element/' + element['element-6066-11e4-a52e-4f735466cecf'] + '/value', { text: value || '\uE003' })
      await popupWait(browser, 'return document.querySelector(arguments[0])?.value===arguments[1]', selector, value)
    },
    key: async key => {
      const active = await command(session + '/element/active')
      await command(session + '/element/' + active['element-6066-11e4-a52e-4f735466cecf'] + '/value', { text: { Escape: '\uE00C', Enter: '\uE007', Space: ' ' }[key] })
    },
    frames: () => command(session + '/execute/async', { script: 'const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(()=>done(null)))', args: [] }),
    close: async () => { await command(session, undefined, 'DELETE') },
  }
  try {
    await command(session + '/window/rect', { x: 0, y: 0, width: 1600, height: 1050 })
    await prepareSafariMeasurementWindow(command, session, 300_000)
    return browser
  } catch (error) { await browser.close(); throw error }
}

export type PopupProbeTarget = {
  root: string; kind: 'popup' | 'search' | 'grid' | 'groups' | 'leaves'; trigger: string; event: 'click' | 'input' | 'contextmenu'
  count?: number; text?: string; options?: Array<{ value: string; count: number }>; date?: boolean; dateCollapsed?: boolean
  gridRpcPath?: string; requireGridRpc?: boolean
}

/** Serialized into either browser. No fetch replacement, CDP, app API or server import. */
export function installPopupProbe(target: PopupProbeTarget) {
  const win = window as unknown as { deepPopupProbe: any }
  win.deepPopupProbe?.stop()
  const state = win.deepPopupProbe = { target, started: null as number | null, lastInput: null as number | null,
    ready: null as number | null, frames: [] as number[], visible: true, focused: true, active: true, stable: 0,
    busySeen: false, maxRows: 0, maxNodes: 0, stop: () => {} }
  const begin = (event: Event) => {
    if (!(event.target instanceof Element) || !event.target.closest(target.trigger)) return
    state.started ??= performance.now()
    if (event.type === 'input') state.lastInput = performance.now()
  }
  document.addEventListener(target.event, begin, true)
  let handle = 0
  state.stop = () => { state.active = false; cancelAnimationFrame(handle); document.removeEventListener(target.event, begin, true) }
  const tick = () => {
    if (!state.active) return
    state.visible &&= !document.hidden; state.focused &&= document.hasFocus()
    if (state.started !== null) {
      state.frames.push(performance.now() - state.started)
      const root = document.querySelector(target.root)
      const frame = root?.querySelector('.journal-grid-frame')
      const busy = frame?.getAttribute('aria-busy') === 'true' || frame?.hasAttribute('data-journal-updating')
      state.busySeen ||= Boolean(busy)
      state.maxRows = Math.max(state.maxRows, root?.querySelectorAll('.ag-row').length ?? 0)
      let ready = false
      if (target.kind === 'popup' || target.kind === 'search') {
        const dialog = document.querySelector('.journal-filter')
        const input = dialog?.querySelector<HTMLInputElement>('input[aria-label="Найти значение фильтра"]')
        const list = dialog?.querySelector('.journal-filter-values')
        ready = Boolean(input && list && list.getAttribute('aria-busy') !== 'true' && !dialog?.querySelector('[role="alert"]'))
        if (target.text !== undefined) ready &&= input?.value === target.text
        if (target.options) {
          const values = [...(dialog?.querySelectorAll('.journal-filter-option') ?? [])].filter(option => !target.date ||
            (option.querySelector('input')?.getAttribute('aria-label') ?? '').startsWith(target.dateCollapsed ? 'Год ' : 'День ')).map(option => ({
            value: option.querySelector('span[title]')?.getAttribute('title') ?? '', count: Number(option.querySelector('.journal-count')?.textContent),
          }))
          const sorted = (items: Array<{ value: string; count: number }>) => items.slice().sort((a, b) => a.value.localeCompare(b.value))
          ready &&= JSON.stringify(sorted(values)) === JSON.stringify(sorted(target.options))
        }
      } else {
        const count = [...(root?.querySelectorAll('[data-journal-footer] span') ?? [])].find(e => e.textContent?.trim() === `Найдено: ${target.count}`)
        const row = target.kind === 'groups' ? '.ag-row-group:not(.ag-opacity-zero)' : '.ag-row[row-id]:not(.ag-row-group):not(.ag-row-loading):not(.ag-opacity-zero)'
        ready = Boolean(root && frame && !busy && count && root.querySelector(row) && !root.querySelector('.ag-row-loading'))
        if (target.requireGridRpc) ready &&= performance.getEntriesByType('resource').some(entry =>
          entry.startTime >= state.started! && new URL(entry.name).pathname === target.gridRpcPath && (entry as PerformanceResourceTiming).responseEnd > 0)
      }
      state.stable = ready ? state.stable + 1 : 0
      if (state.stable >= 2) { state.ready = performance.now() - state.started; state.stop(); return }
    }
    handle = requestAnimationFrame(tick)
  }
  handle = requestAnimationFrame(tick)
}
