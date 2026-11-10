/** Opt-in local measurements. Vite removes this branch in ordinary builds. */
export function profileSchemePdf(name: string) {
  if (import.meta.env.VITE_PROFILE_SCHEME_PDF !== '1') return
  if (name === 'open') {
    for (const mark of performance.getEntriesByType('mark')) if (mark.name.startsWith('scheme-pdf:')) performance.clearMarks(mark.name)
  }
  performance.mark(`scheme-pdf:${name}`)
}
