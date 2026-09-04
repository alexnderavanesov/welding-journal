export function encodeIdentityKey(parts: readonly unknown[]) {
  return JSON.stringify(parts.map((part) => String(part ?? '')))
}
