export async function copyTextToClipboard(value: string) {
  const text = String(value ?? '').trim()
  if (!text) return false

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Some embedded browsers expose Clipboard API but deny writes.
    }
  }

  if (typeof document.execCommand !== 'function') return false
  const input = document.createElement('textarea')
  input.value = text
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.appendChild(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  return copied
}
