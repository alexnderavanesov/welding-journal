export function toggleNumberSetValue(current: ReadonlySet<number>, value: number) {
  const next = new Set(current)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return next
}

export function setNumberSetValues(current: ReadonlySet<number>, values: Iterable<number>, selected: boolean) {
  const next = new Set(current)
  for (const value of values) {
    if (selected) {
      next.add(value)
    } else {
      next.delete(value)
    }
  }
  return next
}

export function toggleNumberSetValues(current: ReadonlySet<number>, values: Iterable<number>) {
  const valueSet = new Set(values)
  if (valueSet.size === 0) return new Set(current)
  const allSelected = [...valueSet].every((value) => current.has(value))
  return allSelected
    ? new Set([...current].filter((value) => !valueSet.has(value)))
    : new Set([...current, ...valueSet])
}
