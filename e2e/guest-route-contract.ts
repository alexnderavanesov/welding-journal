// Each server route is classified here before release. Public authentication
// endpoints have their own allowlist inside the framework's catch-all route.
export const guestRoutes = {
  '/api/report-excel': { POST: 'private' },
  '/api/document-history-report': { POST: 'private' },
  '/api/line-scheme-file': { GET: 'private', HEAD: 'private', POST: 'private' },
  '/api/maintenance/dispatcher-refresh': { POST: 'maintenance' },
  '/api/maintenance/dispatcher-prewarm': { POST: 'maintenance' },
  '/api/auth/$': { GET: 'authentication', POST: 'authentication' },
} as const
