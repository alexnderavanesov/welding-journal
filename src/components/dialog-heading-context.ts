import { createContext } from 'react'

/** Each modal owns its heading identity, including headers rendered later by
 * Suspense and nested dialogs rendered through portals. */
export const DialogHeadingIdContext = createContext<string | undefined>(undefined)
