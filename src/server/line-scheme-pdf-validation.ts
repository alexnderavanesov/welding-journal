import { PublicRequestError } from '@/lib/public-request-error'
import { runFileValidation } from './file-validation-process'

const RESOURCE_ERROR = 'Не удалось безопасно проверить PDF. Файл слишком сложный или повреждён.'
const VALIDATION_ERROR = 'Не удалось проверить PDF. Повторите загрузку.'
const errors: Record<string, string> = {
  size: 'Загрузите исправный PDF размером до 100 МБ.',
  invalid: 'Не удалось прочитать PDF: файл повреждён или защищён паролем.',
  encrypted: 'Файл защищён паролем. Загрузите PDF без пароля.',
  tree: 'Не удалось прочитать PDF: повреждён список страниц.',
  pages: 'PDF должен содержать от 1 до 100 страниц.',
  box: 'Не удалось прочитать PDF: повреждена страница.',
}

export async function validateSchemePdf(path: string, maxBytes: number, maxPages: number, signal?: AbortSignal): Promise<number> {
  const { pdfValidationWorkerUrl } = await import('./line-scheme-pdf-worker.mjs')
  return runFileValidation(new URL(pdfValidationWorkerUrl), 'LINE_SCHEME_PDF_WORKER', { path, maxBytes, maxPages },
    VALIDATION_ERROR, RESOURCE_ERROR, result => {
      if (result.ok !== true) throw new PublicRequestError(typeof result.reason === 'string' && Object.hasOwn(errors, result.reason) ? errors[result.reason]! : VALIDATION_ERROR)
      if (!Number.isSafeInteger(result.pages) || (result.pages as number) < 1 || (result.pages as number) > maxPages) throw new PublicRequestError(VALIDATION_ERROR)
      return result.pages as number
    }, signal)
}
