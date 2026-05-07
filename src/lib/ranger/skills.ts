import { buildRangerScreeningDraft } from './intake'
import type {
  RangerApplicant,
  RangerCandidateReport,
  RangerOutcome,
} from './types'

export function buildRangerSmsScreeningDraft(
  applicant: RangerApplicant,
): string {
  const name = applicant.preferred_name || applicant.full_name?.split(/\s+/)[0]
  const greeting = name ? `Hi ${name}, ` : 'Hi, '

  return `${greeting}this is Ranger with Sasquatch Carpet Cleaning. Thanks for applying. Quick check before we move forward: do you have reliable transportation, a valid driver's license, can you work nights and every Saturday, and are you comfortable with hard physical carpet-cleaning work? Please reply with clear answers.`
}

export function buildRangerEmailScreeningDraft(): string {
  return buildRangerScreeningDraft()
}

export function buildRangerReminderText(applicant: RangerApplicant): string {
  return `Follow-up due for ${applicant.full_name || applicant.email || applicant.phone || 'applicant'}.

Status: ${applicant.status}
Next: ${applicant.next_action || 'Review applicant and decide next step.'}`
}

export function buildRangerOutcomeInsight(params: {
  applicant: RangerApplicant
  outcomes: RangerOutcome[]
  report: RangerCandidateReport | null
}) {
  const { applicant, outcomes, report } = params
  const latest = outcomes[0]
  const fit = report?.overall_fit || 'unknown'
  const recommendation = report?.overall_recommendation || 'unknown'

  return {
    applicantId: applicant.id,
    outcome:
      latest?.outcome_label || applicant.final_decision || applicant.status,
    fit,
    recommendation,
    lesson:
      latest?.outcome_label === 'good_hire'
        ? 'Preserve the early signals that predicted this hire.'
        : latest?.outcome_label === 'bad_hire'
          ? 'Review which early signals missed the later problem.'
          : 'Keep tracking until the hiring result is clear.',
  }
}

export function parseRangerNameAndValue(input: string): {
  query: string
  value: string
} | null {
  const trimmed = input.trim()
  const firstSpace = trimmed.indexOf(' ')
  if (firstSpace === -1) return null

  const body = trimmed.slice(firstSpace + 1)
  const separator = body.includes('|') ? '|' : body.includes(':') ? ':' : null
  if (!separator) return null

  const [query, ...valueParts] = body.split(separator)
  const value = valueParts.join(separator).trim()
  if (!query.trim() || !value) return null
  return { query: query.trim(), value }
}
