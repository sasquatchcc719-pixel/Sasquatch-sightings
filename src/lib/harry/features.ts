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

export function isGeorgeFeatureEnabled(): boolean {
  return flag(process.env.GEORGE_HENDERSON_ENABLED, true)
}

export type GeorgeRolloutMode = 'read_only' | 'confirm_actions'

export function getGeorgeRolloutMode(): GeorgeRolloutMode {
  const value = String(process.env.GEORGE_HENDERSON_ROLLOUT_MODE || '')
    .trim()
    .toLowerCase()
  if (value === 'confirm_actions') return 'confirm_actions'
  return 'read_only'
}
