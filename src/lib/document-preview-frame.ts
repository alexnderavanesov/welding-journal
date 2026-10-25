// WebKit suppresses native wheel events in script-disabled frames, even for
// listeners installed by the parent. CSP blocks document scripts and network
// access while allowing our parent-owned keyboard/zoom listeners to run.
export const PREVIEW_FRAME_SANDBOX = 'allow-same-origin allow-modals allow-scripts'

export function buildPreviewFrameHtml(html: string) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'">`
  return /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, head => head + policy)
    : `<!doctype html><html><head>${policy}</head><body>${html}</body></html>`
}
