export function getNextTimestampVersion(current: Date, candidate = new Date()) {
  return new Date(Math.max(candidate.getTime(), current.getTime() + 1))
}
