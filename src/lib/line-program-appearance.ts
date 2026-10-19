export type ProgramAppearance = {
  theme: 'quartz' | 'alpine' | 'balham'
  density: 'compact' | 'comfortable' | 'spacious'
  verticalBorders: boolean
}
export const PROGRAM_APPEARANCE_KEY = 'welding:line-program:appearance:v1'
export const DEFAULT_PROGRAM_APPEARANCE: ProgramAppearance = { theme: 'quartz', density: 'comfortable', verticalBorders: false }
export function readProgramAppearance(): ProgramAppearance {
  try {
    const value = JSON.parse(localStorage.getItem(PROGRAM_APPEARANCE_KEY) ?? 'null')
    return {
      theme: ['quartz', 'alpine', 'balham'].includes(value?.theme) ? value.theme : 'quartz',
      density: ['compact', 'comfortable', 'spacious'].includes(value?.density) ? value.density : 'comfortable',
      verticalBorders: value?.verticalBorders === true,
    }
  } catch { return { ...DEFAULT_PROGRAM_APPEARANCE } }
}
export function writeProgramAppearance(value: ProgramAppearance) {
  try { localStorage.setItem(PROGRAM_APPEARANCE_KEY, JSON.stringify(value)) } catch { /* Private/blocked storage: keep the current page usable. */ }
}
