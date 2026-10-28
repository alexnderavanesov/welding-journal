// @ts-check
/**
 * Also embedded verbatim before React starts. Keep this JavaScript self-contained
 * so server/client transforms cannot change the inline script's text.
 * @param {string[]} extraUrls
 * @param {() => void} reload
 */
export async function retryAppModules(extraUrls = [], reload = () => window.location.reload()) {
  /** @type {Set<string>} */
  const urls = new Set()
  const candidates = [...extraUrls,
    ...Array.from(document.querySelectorAll('script[type="module"][src]'), node => /** @type {HTMLScriptElement} */ (node).src),
    ...Array.from(document.querySelectorAll('link[rel="modulepreload"][href]'), node => /** @type {HTMLLinkElement} */ (node).href),
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
