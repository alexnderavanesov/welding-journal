/** Also embedded before React starts. Keep this function self-contained. */
export async function retryAppModules(extraUrls: string[] = [], reload = () => window.location.reload()) {
  const urls = new Set<string>()
  const candidates = [...extraUrls,
    ...Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'), node => node.src),
    ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"][href]'), node => node.href),
    ...performance.getEntriesByType('resource').map(entry => entry.name),
  ]
  for (const value of candidates) {
    try {
      const url = new URL(value, location.href)
      if (url.origin === location.origin && url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js')) urls.add(url.href)
    } catch { /* An unrelated malformed resource must not prevent a retry. */ }
  }
  // WebKit can retain failed module resources across an ordinary reload.
  // Refresh the same URLs (not cache-busting aliases) before one navigation.
  // This runs only on recovery, never on successful startup or normal visits.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    await Promise.allSettled([...urls].map(async url => {
      const response = await fetch(url, { cache: 'reload', signal: controller.signal })
      await response.arrayBuffer() // A reload must not interrupt the replacement body mid-download.
    }))
  } finally { clearTimeout(timeout); reload() }
}
