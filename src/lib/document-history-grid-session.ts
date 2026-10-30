import { userSessionStorage } from '@/lib/user-storage'
export type DocumentGridBreadcrumb = { id: string; route: string[]; index: number }
export type DocumentGridSession = {
  scope: string
  search: string
  firstRow: number
  rowId: string | null
  top: number
  left: number
  expandedPaths: string[][]
  breadcrumbs?: DocumentGridBreadcrumb[]
  offset?: number
  frameTop?: number
}
const prefix = 'welding-journal:documents:grid-session:v1:'
export const EMPTY_DOCUMENT_GRID_SESSION: DocumentGridSession = { scope: '', search: '', firstRow: 0, rowId: null, top: 0, left: 0, expandedPaths: [] }
export function readDocumentGridSession(viewId: string): DocumentGridSession {
  try {
    const raw = JSON.parse(userSessionStorage.getItem(prefix + viewId) ?? 'null')
    if (!raw || typeof raw !== 'object') return { ...EMPTY_DOCUMENT_GRID_SESSION }
    return {
      scope: typeof raw.scope === 'string' ? raw.scope : '', search: typeof raw.search === 'string' ? raw.search : '',
      firstRow: Number.isSafeInteger(raw.firstRow) && raw.firstRow >= 0 ? raw.firstRow : 0,
      rowId: typeof raw.rowId === 'string' ? raw.rowId : null,
      top: Number.isFinite(raw.top) && raw.top >= 0 ? raw.top : 0,
      left: Number.isFinite(raw.left) && raw.left >= 0 ? raw.left : 0,
      offset: Number.isFinite(raw.offset) ? raw.offset : undefined,
      frameTop: Number.isFinite(raw.frameTop) ? raw.frameTop : undefined,
      breadcrumbs: Array.isArray(raw.breadcrumbs) ? raw.breadcrumbs.slice(0, 8).filter((item: unknown): item is DocumentGridBreadcrumb => {
        if (!item || typeof item !== 'object') return false
        const value = item as Partial<DocumentGridBreadcrumb>
        return typeof value.id === 'string' && Number.isSafeInteger(value.index) && value.index! >= 0 && Array.isArray(value.route) && value.route.length <= 7 && value.route.every(key => typeof key === 'string')
      }) : [],
      // A saved view never means "expand all". Preserve every explicitly opened valid path.
      expandedPaths: Array.isArray(raw.expandedPaths) ? raw.expandedPaths.filter((path: unknown): path is string[] => Array.isArray(path) && path.length > 0 && path.length <= 7 && path.every(key => typeof key === 'string')) : [],
    }
  } catch { return { ...EMPTY_DOCUMENT_GRID_SESSION } }
}
export function writeDocumentGridSession(viewId: string, session: DocumentGridSession) {
  try { userSessionStorage.setItem(prefix + viewId, JSON.stringify(session)) } catch { /* Working state stays in the grid. */ }
}
export function documentGridPathKey(path: readonly string[]) { return JSON.stringify(path) }
export function documentGridErrorMessage(failure: unknown) {
  const message = failure instanceof Error ? failure.message.trim() : ''
  return message && !/failed query:|\bselect\s.+\bfrom\s|\binsert\s+into\b/i.test(message)
    ? message.slice(0, 500)
    : 'Не удалось загрузить реестр документов. Повторите попытку.'
}
