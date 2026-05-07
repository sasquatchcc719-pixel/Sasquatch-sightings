import {
  buildScreeningMessage,
  getHardRequirementMisses,
  getMissingFields,
} from './playbook'
import type { RangerApplicant } from './types'

export type RangerApplicantIntake = {
  source?: string
  sourceThreadId?: string
  subject?: string
  body: string
  fromEmail?: string
  fromName?: string
  phone?: string
}

function extractEmail(value?: string): string | null {
  if (!value) return null
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match?.[0]?.toLowerCase() || null
}

function extractPhone(value: string): string | null {
  const match = value.match(
    /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/,
  )
  return match?.[0] || null
}

function detectBoolean(
  text: string,
  positivePatterns: RegExp[],
  negativePatterns: RegExp[],
) {
  if (negativePatterns.some((pattern) => pattern.test(text))) return false
  if (positivePatterns.some((pattern) => pattern.test(text))) return true
  return null
}

export function parseApplicantIntake(
  intake: RangerApplicantIntake,
): Partial<RangerApplicant> {
  const text = `${intake.subject || ''}\n${intake.body}`.toLowerCase()
  const email = extractEmail(intake.fromEmail) || extractEmail(intake.body)
  const phone = intake.phone || extractPhone(intake.body)
  const fullName = intake.fromName?.trim() || null

  const partial: Partial<RangerApplicant> = {
    source: intake.source || 'craigslist',
    source_thread_id: intake.sourceThreadId || null,
    full_name: fullName,
    email,
    phone,
    has_reliable_transportation: detectBoolean(
      text,
      [/\breliable transportation\b/, /\bown (a )?car\b/, /\bhave (a )?car\b/],
      [/\bno (car|transportation)\b/, /\bno reliable transportation\b/],
    ),
    has_valid_driver_license: detectBoolean(
      text,
      [/\bvalid (driver'?s )?license\b/, /\bdriver'?s license\b/],
      [/\bno (driver'?s )?license\b/, /\blicense suspended\b/],
    ),
    can_work_nights: detectBoolean(
      text,
      [/\b(can|able|available).{0,30}\b(nights?|nighttime|evenings?)\b/],
      [
        /\b(can'?t|cannot|not available).{0,30}\b(nights?|nighttime|evenings?)\b/,
      ],
    ),
    can_work_saturdays: detectBoolean(
      text,
      [/\b(can|able|available).{0,30}\bsaturdays?\b/],
      [/\b(can'?t|cannot|not available).{0,30}\bsaturdays?\b/],
    ),
    can_do_physical_work: detectBoolean(
      text,
      [
        /\bphysical\b/,
        /\blabor\b/,
        /\blift\b/,
        /\bconstruction\b/,
        /\bmoving\b/,
      ],
      [/\b(can'?t|cannot).{0,30}\b(lift|physical|labor)\b/],
    ),
    relevant_experience:
      /(cleaning|carpet|moving|construction|labor|delivery|customer service)/i.test(
        intake.body,
      )
        ? intake.body.slice(0, 1200)
        : null,
  }

  partial.missing_fields = getMissingFields(partial)
  partial.hard_requirement_misses = getHardRequirementMisses(partial)
  partial.status =
    partial.hard_requirement_misses.length > 0
      ? 'owner_review'
      : partial.missing_fields.length > 0
        ? 'needs_screening'
        : 'awaiting_reply'
  partial.next_action =
    partial.hard_requirement_misses.length > 0
      ? 'Owner review for objective hard requirement miss.'
      : partial.missing_fields.length > 0
        ? 'Send structured screening questions.'
        : 'Run standard research and continue screening.'

  return partial
}

export function buildRangerScreeningDraft(): string {
  return buildScreeningMessage()
}
