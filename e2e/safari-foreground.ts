import { expect } from '@playwright/test'

type DriverCommand = (path: string, body?: unknown, method?: string) => Promise<any>

/** Establish visibility before the timed navigation without warming app assets. */
export async function prepareSafariMeasurementWindow(command: DriverCommand, session: string, timeout = 120_000) {
  const html = '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Локальный аудит Safari</title><body style="font:22px sans-serif;padding:60px"><h1>Локальный аудит Safari</h1><p>Оставьте это окно на переднем плане. Проверка продолжится автоматически.</p></body></html>'
  await command(session + '/url', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) })
  console.log('SAFARI_WAITING_FOR_FOREGROUND: own automation window, before measurements')
  await expect.poll(() => command(session + '/execute/sync', {
    script: 'return !document.hidden && document.hasFocus()', args: [],
  }), { timeout, message: 'Bring the local Safari audit window to the foreground before measuring' }).toBe(true)
  console.log('SAFARI_FOREGROUND_CONFIRMED: timed measurements may start')
}
