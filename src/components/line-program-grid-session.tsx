import { ProgramAppearanceProvider } from './line-program-appearance'
import { createContext, useCallback, useContext, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

const Context = createContext<Map<string, unknown> | null>(null)

/** The lifetime is the current program page, never localStorage or the database. */
export function ProgramGridSessionProvider({ children }: { children: ReactNode }) {
  const values = useRef(new Map<string, unknown>())
  return <Context.Provider value={values.current}><ProgramAppearanceProvider>{children}</ProgramAppearanceProvider></Context.Provider>
}

export function useProgramGridSession() { return useContext(Context) }

export function useProgramSessionState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const session = useProgramGridSession()
  const [value, setValue] = useState<T>(() => session?.has(key) ? session.get(key) as T : typeof initial === 'function' ? (initial as () => T)() : initial)
  const update = useCallback<Dispatch<SetStateAction<T>>>(action => setValue(previous => {
    const next = typeof action === 'function' ? (action as (value: T) => T)(previous) : action
    session?.set(key, next)
    return next
  }), [session, key])
  return [value, update]
}
