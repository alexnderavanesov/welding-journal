import { isChunkLoadError } from './chunk-load-recovery'

export const PSTO_PROGRAM_DIAGNOSTICS_KEY = 'welding-psto-program-diagnostics-v1'
const LIMIT = 60
const EVENTS = ['open', 'close', 'group-loading', 'group-ready', 'group-error',
  'dialog-loading', 'dialog-ready', 'dialog-error', 'mounted', 'query-start', 'query-ready', 'query-error', 'render-error'] as const
type Event = typeof EVENTS[number]
type Entry = { at: string; event: Event; failure?: 'chunk' | 'other' }

/** Per-tab, bounded and best effort. Never persist errors, URLs, filters,
 * joint/line data or names; never send diagnostics to a server. */
export function readPstoProgramDiagnostics(): Entry[] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(PSTO_PROGRAM_DIAGNOSTICS_KEY) ?? '[]')
    if (!Array.isArray(stored)) return []
    return stored.slice(-LIMIT).flatMap(entry => {
      if (!entry || !EVENTS.includes(entry.event) || typeof entry.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(entry.at)) return []
      return [{ at: entry.at, event: entry.event,
        ...(entry.failure === 'chunk' || entry.failure === 'other' ? { failure: entry.failure } : {}) }]
    })
  } catch { return [] }
}

export function tracePstoProgram(event: Event, error?: unknown) {
  try {
    const entries = readPstoProgramDiagnostics()
    entries.push({ at: new Date().toISOString(), event,
      ...(error === undefined ? {} : { failure: isChunkLoadError(error) ? 'chunk' as const : 'other' as const }) })
    sessionStorage.setItem(PSTO_PROGRAM_DIAGNOSTICS_KEY, JSON.stringify(entries.slice(-LIMIT)))
  } catch { /* Private mode/full storage must not break opening or saving. */ }
}

export async function tracePstoProgramModule<T>(stage: 'group' | 'dialog', load: () => Promise<T>) {
  tracePstoProgram(`${stage}-loading`)
  try {
    const result = await load()
    tracePstoProgram(`${stage}-ready`)
    return result
  } catch (error) { tracePstoProgram(`${stage}-error`, error); throw error }
}
