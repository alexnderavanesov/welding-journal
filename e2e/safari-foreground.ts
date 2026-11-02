import { expect } from '@playwright/test'
import { authenticateE2eSafari } from './authentication'

type DriverCommand = (path: string, body?: unknown, method?: string) => Promise<any>

/** Establish visibility before the timed navigation without warming app assets. */
export async function prepareSafariMeasurementWindow(command: DriverCommand, session: string, timeout = 120_000) {
  // The explicit run setting also applies to adapters with a custom default.
  timeout = Number(process.env.SAFARI_FOREGROUND_TIMEOUT_MS ?? timeout)
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 600_000) {
    throw new Error('Safari foreground wait must be between 1000 and 600000 ms')
  }
  const label = new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const title = `Локальный аудит Safari — проверка ${label}`
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>${title}</title><body style="font:22px sans-serif;padding:60px"><h1>${title}</h1><p>Оставьте это окно на переднем плане. Проверка продолжится автоматически.</p></body></html>`
  await command(session + '/url', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) })
  // Select only this driver's automation window before checking visibility;
  // creating a session alone can leave it behind another application.
  await command(session + '/window', { handle: await command(session + '/window') })
  console.log('SAFARI_WAITING_FOR_FOREGROUND: own automation window, before measurements', { title })
  await expect.poll(() => command(session + '/execute/sync', {
    script: 'return !document.hidden && document.hasFocus()', args: [],
  }), { timeout, message: 'Bring the local Safari audit window to the foreground before measuring' }).toBe(true)
  await authenticateE2eSafari(command, session)
  console.log('SAFARI_FOREGROUND_CONFIRMED: timed measurements may start')
}
