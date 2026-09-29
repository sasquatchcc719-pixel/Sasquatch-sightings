export type FillOpening = {
  staffUserId: string
  staffName: string
  startTime: string
  endTime: string
}

export type FillContact = {
  sentAt: string | null
  repliedAt: string | null
  bookedAt: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

export function normalizeFillPhone(value: string | null | undefined) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

export function normalizeFillZip(value: string | null | undefined) {
  const match = String(value || '').match(/\b(\d{5})(?:-\d{4})?\b/)
  return match?.[1] || null
}

export function tomorrowFillWaveLimit(openingCount: number) {
  if (!Number.isFinite(openingCount) || openingCount < 1) return 0
  return Math.min(15, Math.floor(openingCount) * 5)
}

export function normalizeHouseholdKey(params: {
  street: string | null | undefined
  zip: string | null | undefined
}) {
  const street = String(params.street || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  const zip = normalizeFillZip(params.zip) || ''
  return street && zip ? `${street}:${zip}` : null
}

export function addCalendarMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1 + months, day || 1, 12))
  return next.toISOString().slice(0, 10)
}

export function daysBetween(earlier: string, later: string) {
  const start = Date.parse(`${earlier.slice(0, 10)}T12:00:00Z`)
  const end = Date.parse(`${later.slice(0, 10)}T12:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.floor((end - start) / DAY_MS)
}

export function contactEligibility(params: {
  history: FillContact[]
  asOfDate: string
  cooldownDays: number
  unansweredLimit: number
  restDays: number
}): {
  eligible: boolean
  reason: 'cooldown' | 'resting' | null
  lastContactedAt: string | null
  unanswered: number
} {
  const sent = params.history
    .filter((row) => row.sentAt)
    .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))
  const latest = sent[0]?.sentAt || null

  if (latest && daysBetween(latest, params.asOfDate) < params.cooldownDays) {
    return {
      eligible: false,
      reason: 'cooldown',
      lastContactedAt: latest,
      unanswered: 0,
    }
  }

  let unanswered = 0
  let newerContactAt: string | null = null
  for (const row of sent) {
    if (row.repliedAt || row.bookedAt) break
    // A completed rest window starts a new outreach cycle. Without this
    // boundary, the first text after a 60-day rest would immediately count as
    // attempt five and incorrectly trigger another 60-day rest.
    if (
      newerContactAt &&
      row.sentAt &&
      daysBetween(row.sentAt, newerContactAt) >= params.restDays
    ) {
      break
    }
    unanswered++
    newerContactAt = row.sentAt
  }
  if (
    latest &&
    unanswered >= params.unansweredLimit &&
    daysBetween(latest, params.asOfDate) < params.restDays
  ) {
    return {
      eligible: false,
      reason: 'resting',
      lastContactedAt: latest,
      unanswered,
    }
  }

  return {
    eligible: true,
    reason: null,
    lastContactedAt: latest,
    unanswered,
  }
}

function timeMinutes(value: string) {
  const [hours, minutes] = value.slice(0, 5).split(':').map(Number)
  return hours * 60 + minutes
}

/**
 * The availability service returns alternatives that can overlap (for example
 * 10–12 and 11–1). Keep the maximum non-overlapping set for honest capacity.
 */
export function selectNonOverlappingOpenings(openings: FillOpening[]) {
  const byStaff = new Map<string, FillOpening[]>()
  for (const opening of openings) {
    const rows = byStaff.get(opening.staffUserId) || []
    rows.push(opening)
    byStaff.set(opening.staffUserId, rows)
  }

  const selected: FillOpening[] = []
  for (const rows of byStaff.values()) {
    rows.sort(
      (a, b) =>
        timeMinutes(a.endTime) - timeMinutes(b.endTime) ||
        timeMinutes(a.startTime) - timeMinutes(b.startTime),
    )
    let previousEnd = -1
    for (const row of rows) {
      const start = timeMinutes(row.startTime)
      if (start < previousEnd) continue
      selected.push(row)
      previousEnd = timeMinutes(row.endTime)
    }
  }
  return selected.sort(
    (a, b) =>
      timeMinutes(a.startTime) - timeMinutes(b.startTime) ||
      a.staffName.localeCompare(b.staffName),
  )
}

export function renderFillMessage(
  template: string,
  values: Record<string, string>,
) {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_, key: string) => values[key] || '',
  )
}
