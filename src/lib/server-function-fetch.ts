/** Validate the HTTP boundary before Start's production transport reduces a
 * missing Content-Type to "Invariant failed". Never replay a mutation: its
 * response may be lost after the database has already committed. */
export async function serverFunctionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(input, { ...init, cache: 'no-store' })
  } catch (error) {
    if (init?.signal?.aborted || error instanceof Error && error.name === 'AbortError') throw error
    throw new Error('Не удалось связаться с сервером. Проверьте соединение. Если вы сохраняли данные, проверьте результат перед повторным сохранением.', { cause: error })
  }
  if (response.headers.get('X-Access-Expired') === 'true' && typeof window !== 'undefined') window.dispatchEvent(new Event('welding-access-expired'))
  const contentType = response.headers.get('content-type') ?? ''
  if (response.headers.get('x-tss-raw') === 'true') return response
  if (!contentType || !/application\/(?:json|x-ndjson|x-tss-framed)/i.test(contentType)) {
    // Status and path diagnose a proxy/obsolete deployment response without
    // logging user payloads, cookies, query strings or returned HTML.
    const url = input instanceof Request ? input.url : String(input)
    console.warn('Unexpected server-function response', {
      path: new URL(url, typeof location === 'undefined' ? 'http://localhost' : location.origin).pathname,
      status: response.status, contentType,
    })
    void response.body?.cancel().catch(() => {})
    throw new Error(`Сервер вернул некорректный ответ (HTTP ${response.status}). Повторите загрузку. Если вы сохраняли данные, сначала проверьте результат сохранения.`)
  }
  return response
}
