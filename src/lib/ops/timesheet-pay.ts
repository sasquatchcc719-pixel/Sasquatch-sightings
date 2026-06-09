export function parseHourlyRate(value: unknown): number | null {
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) return null
  return Math.round((rate + Number.EPSILON) * 100) / 100
}
