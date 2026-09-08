export function parseDialCallDuration(
  value: FormDataEntryValue | null,
): number | null {
  const duration = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(duration) && duration >= 0 ? duration : null
}

export function wasForwardedCallHandled(dialCallStatus: string): boolean {
  const status = dialCallStatus.trim().toLowerCase()
  return ['completed', 'answered'].includes(status)
}

export function classifyCallOutcome(
  dialCallStatus: string,
): 'answered' | 'no-answer' {
  // Reaching the greeting does not prove a voicemail was left. The recording
  // callback upgrades a missed call once an actual recording exists.
  return wasForwardedCallHandled(dialCallStatus) ? 'answered' : 'no-answer'
}
