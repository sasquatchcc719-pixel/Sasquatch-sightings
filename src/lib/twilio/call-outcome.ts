export const MIN_HANDLED_DIAL_SECONDS = 15

export function parseDialCallDuration(value: FormDataEntryValue | null): number | null {
  const duration = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(duration) && duration >= 0 ? duration : null
}

export function wasForwardedCallHandled(
  dialCallStatus: string,
  dialCallDurationSeconds: number | null,
): boolean {
  const status = dialCallStatus.trim().toLowerCase()
  if (!['completed', 'answered'].includes(status)) return false

  // Preserve the conservative behavior when Twilio omits duration.
  return (
    dialCallDurationSeconds === null ||
    dialCallDurationSeconds >= MIN_HANDLED_DIAL_SECONDS
  )
}

export function classifyCallOutcome(
  dialCallStatus: string,
  dialCallDurationSeconds: number | null,
): 'answered' | 'no-answer' | 'voicemail' {
  const status = dialCallStatus.trim().toLowerCase()

  if (wasForwardedCallHandled(status, dialCallDurationSeconds)) {
    return 'answered'
  }

  if (
    ['no-answer', 'busy', 'canceled'].includes(status) ||
    (['completed', 'answered'].includes(status) &&
      dialCallDurationSeconds !== null)
  ) {
    return 'no-answer'
  }

  return 'voicemail'
}
