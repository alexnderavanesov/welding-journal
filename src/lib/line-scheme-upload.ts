import type { SchemeWriteRequest } from '@/server/line-scheme-write'

export class SchemeUploadRejected extends Error {}

/** Raw streaming body: no base64, JSON file copies, or server-function serializer. */
export function uploadSchemePdf(file: File, data: SchemeWriteRequest & { replace: 'archive' | 'delete'; changeNumber?: string }, onProgress: (percent: number) => void, signal: AbortSignal) {
  return new Promise<{ revisionId: string; version: number }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const finish = (error?: Error, result?: { revisionId: string; version: number }) => {
      signal.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(result!)
    }
    xhr.open('POST', '/api/line-scheme-file')
    xhr.timeout = 150_000
    xhr.setRequestHeader('Content-Type', 'application/pdf')
    xhr.setRequestHeader('X-Line-Scheme-Upload', encodeURIComponent(JSON.stringify({ ...data, fileName: file.name })))
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)) }
    xhr.onload = () => {
      try { const result = JSON.parse(xhr.responseText); if (xhr.status < 200 || xhr.status >= 300) throw new (result.retryable === false ? SchemeUploadRejected : Error)(result.error ?? 'Не удалось загрузить PDF.'); finish(undefined, result) }
      catch (error) { finish(error instanceof Error ? error : new Error('Не удалось прочитать ответ сервера.')) }
    }
    xhr.onerror = () => finish(new Error('Связь прервалась. Повторите загрузку: одна операция не создаст две редакции.'))
    xhr.ontimeout = () => finish(new Error('Ответ о загрузке не получен вовремя. Повторите ту же операцию для проверки результата.'))
    xhr.onabort = () => finish(new Error('Загрузка прервана. Проверьте список редакций перед повторной загрузкой.'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { finish(new Error('Загрузка отменена.')); return }
    xhr.send(file)
  })
}
