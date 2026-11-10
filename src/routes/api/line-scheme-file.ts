import { createFileRoute } from '@tanstack/react-router'
import { handleSchemeFile } from '@/server/line-scheme-http'

export const Route = createFileRoute('/api/line-scheme-file')({ server: { handlers: {
  GET: ({ request }) => handleSchemeFile(request),
  HEAD: ({ request }) => handleSchemeFile(request),
  POST: ({ request }) => handleSchemeFile(request),
} } })
