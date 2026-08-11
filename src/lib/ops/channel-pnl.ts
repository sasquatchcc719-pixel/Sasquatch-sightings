export type CampaignWindow = {
  starts_on: string
  ends_on: string | null
}

export type CanvassSessionInput = {
  id: string
  user_id: string
  started_at: string
  ended_at: string | null
  status: string
}

export type CanvasserInput = {
  user_id: string | null
  display_name: string
  hourly_rate: number | null
}

export type CanvassLaborSummary = {
  cost: number
  hours: number
  sessions: number
  hourlyRate: number | null
  people: string[]
}

const round2 = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100

function dateInWindows(dateKey: string, windows: CampaignWindow[]) {
  return windows.some(
    (window) =>
      dateKey >= window.starts_on &&
      (!window.ends_on || dateKey <= window.ends_on),
  )
}

/**
 * Prices completed canvassing directly from the recorded session durations.
 *
 * Sessions are de-duplicated by id and the total is rounded once at the end.
 * Rounding every tiny walk separately made the live Door Hangers tally one cent
 * too high. Staff without an hourly rate are owner time and remain visible in
 * the source tool without becoming a business expense here.
 */
export function summarizeCanvassLabor(
  sessions: CanvassSessionInput[],
  staff: CanvasserInput[],
  windows: CampaignWindow[],
): CanvassLaborSummary {
  const staffByUserId = new Map(
    staff
      .filter((person) => person.user_id)
      .map((person) => [person.user_id as string, person]),
  )
  const uniqueSessions = new Map(
    sessions.map((session) => [session.id, session]),
  )
  const rates = new Set<number>()
  const people = new Set<string>()
  let totalHours = 0
  let totalCost = 0
  let paidSessions = 0

  for (const session of uniqueSessions.values()) {
    if (
      session.status !== 'completed' ||
      !session.ended_at ||
      !dateInWindows(session.started_at.slice(0, 10), windows)
    ) {
      continue
    }

    const person = staffByUserId.get(session.user_id)
    const hourlyRate = Number(person?.hourly_rate || 0)
    if (!person || hourlyRate <= 0) continue

    const hours =
      (new Date(session.ended_at).getTime() -
        new Date(session.started_at).getTime()) /
      3_600_000
    if (!Number.isFinite(hours) || hours <= 0) continue

    totalHours += hours
    totalCost += hours * hourlyRate
    paidSessions += 1
    rates.add(hourlyRate)
    people.add(person.display_name)
  }

  return {
    cost: round2(totalCost),
    hours: round2(totalHours),
    sessions: paidSessions,
    hourlyRate: rates.size === 1 ? [...rates][0] : null,
    people: [...people].sort(),
  }
}
