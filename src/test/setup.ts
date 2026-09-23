import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Browsers implement this API, but JSDOM only logs "Not implemented".
window.scrollTo = vi.fn()
