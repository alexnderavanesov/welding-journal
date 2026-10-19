import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { DEFAULT_PROGRAM_APPEARANCE, PROGRAM_APPEARANCE_KEY, readProgramAppearance, writeProgramAppearance, type ProgramAppearance } from '@/lib/line-program-appearance'
const Context = createContext<{ appearance: ProgramAppearance; setAppearance: Dispatch<SetStateAction<ProgramAppearance>> }>({ appearance: DEFAULT_PROGRAM_APPEARANCE, setAppearance: () => {} })
export function ProgramAppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState(readProgramAppearance)
  useEffect(() => { writeProgramAppearance(appearance) }, [appearance])
  useEffect(() => {
    const storage = (event: StorageEvent) => { if (event.key === PROGRAM_APPEARANCE_KEY || event.key === null) setAppearance(readProgramAppearance()) }
    // Browser :focus-visible heuristics can retain a keyboard cue when AG Grid
    // moves focus during its first disclosure. Pointer input always clears it.
    const pointer = () => document.documentElement.removeAttribute('data-program-keyboard')
    const keyboard = (event: KeyboardEvent) => {
      if (['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' '].includes(event.key)) document.documentElement.setAttribute('data-program-keyboard', 'true')
    }
    window.addEventListener('storage', storage)
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('keydown', keyboard, true)
    return () => {
      window.removeEventListener('storage', storage)
      document.removeEventListener('pointerdown', pointer, true)
      document.removeEventListener('keydown', keyboard, true)
      pointer()
    }
  }, [])
  const value = useMemo(() => ({ appearance, setAppearance }), [appearance])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useProgramAppearance() { return useContext(Context) }
