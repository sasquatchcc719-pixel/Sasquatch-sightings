function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return value.toLowerCase() === 'true'
}

export function isAnalystFeatureEnabled(): boolean {
  return flag(process.env.HARRY_ANALYST_ENABLED, false)
}

export function isAnalystHistoryReadonlyEnabled(): boolean {
  return flag(process.env.HARRY_ANALYST_HISTORY_READONLY, true)
}
