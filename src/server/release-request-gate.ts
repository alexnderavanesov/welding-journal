/** One shared probe per process, not one SQL query for every RPC or table row. */
export function createReleaseRequestGate(probe: () => Promise<boolean>, now = Date.now) {
  let checkedAt = -Infinity
  let ready = false
  let pending: Promise<boolean> | undefined
  async function check() {
    if (now() - checkedAt < 5_000) return ready
    if (!pending) pending = Promise.resolve().then(probe).catch(() => false).then(value => {
      ready = value
      checkedAt = now()
      return value
    }).finally(() => { pending = undefined })
    return pending
  }
  return async (request: Request): Promise<Response | null> => {
    const path = new URL(request.url).pathname
    // Liveness deliberately does not mean the database or the release is ready.
    // This lets the new maintenance-only container replace the old writer.
    if (path === '/health/live') return Response.json({ alive: true }, { headers: { 'Cache-Control': 'no-store' } })
    const available = await check()
    if (path === '/health/ready') return Response.json({ ready: available }, {
      status: available ? 200 : 503, headers: { 'Cache-Control': 'no-store' },
    })
    if (available) return null
    const headers = { 'Cache-Control': 'no-store', 'Retry-After': '5' }
    if (request.method !== 'GET' || !request.headers.get('accept')?.includes('text/html')) {
      return Response.json({ error: 'Обновление системы не завершено. Запрос не выполнен. Повторите после сообщения администратора.' }, { status: 503, headers })
    }
    return new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Обновление системы</title><style>body{font:18px/1.6 system-ui,sans-serif;color:#334155;background:#f8fafc;margin:0;padding:12vh 24px}main{max-width:660px;margin:auto}a{color:#0369a1}</style>
      <main><h1>Идёт обновление системы</h1><p>Рабочие разделы временно закрыты: база данных ещё не подготовлена или недоступна.</p>
      <p>Дождитесь сообщения администратора. Этот запрос ничего не изменил. Сохранение из ранее открытых вкладок также временно недоступно.</p>
      <a href="/">Проверить готовность</a></main></html>`, {
      status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}
