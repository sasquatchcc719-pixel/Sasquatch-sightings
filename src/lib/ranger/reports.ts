import {
  buildInitialScorecard,
  getHardRequirementMisses,
  getMissingFields,
  recommendNextStep,
} from './playbook'
import type {
  RangerApplicant,
  RangerCandidateReport,
  RangerEvidence,
  RangerFit,
  RangerRecommendation,
  RangerScoreCategory,
} from './types'

function determineFit(recommendation: RangerRecommendation): RangerFit {
  if (recommendation === 'pass_hard_miss') return 'low'
  if (recommendation === 'needs_more_info') return 'medium'
  if (recommendation === 'continue_screening') return 'medium_high'
  if (recommendation === 'late_stage_contact') return 'high'
  if (recommendation === 'ready_for_phone_call') return 'high'
  return 'medium'
}

function buildStrengths(applicant: Partial<RangerApplicant>): string[] {
  const strengths: string[] = []
  if (
    applicant.has_reliable_transportation &&
    applicant.has_valid_driver_license
  ) {
    strengths.push('Has reliable transportation and a valid driver’s license.')
  }
  if (applicant.can_work_nights && applicant.can_work_saturdays) {
    strengths.push('Can work nighttime commercial jobs and Saturdays.')
  }
  if (applicant.can_do_physical_work) {
    strengths.push('Confirmed comfort with hard physical carpet-cleaning work.')
  }
  if (applicant.relevant_experience) {
    strengths.push(
      'Provided relevant labor, cleaning, delivery, or customer-service experience.',
    )
  }
  return strengths
}

function buildConcerns(applicant: Partial<RangerApplicant>): string[] {
  const hardMisses = getHardRequirementMisses(applicant)
  if (hardMisses.length > 0) return hardMisses
  return []
}

export function buildInitialCandidateReport(
  applicant: RangerApplicant,
): Omit<
  RangerCandidateReport,
  'id' | 'created_at' | 'updated_at' | 'generated_at'
> {
  const recommendation = recommendNextStep(applicant)
  const missingFields = getMissingFields(applicant)
  const concerns = buildConcerns(applicant)
  const strengths = buildStrengths(applicant)

  return {
    applicant_id: applicant.id,
    research_depth: 'standard',
    overall_recommendation: recommendation,
    overall_fit: determineFit(recommendation),
    identity_confidence:
      applicant.email || applicant.phone ? 'medium' : 'unknown',
    research_confidence: 'unknown',
    summary:
      recommendation === 'pass_hard_miss'
        ? 'Applicant misses one or more hard requirements for Ranger v1.'
        : recommendation === 'needs_more_info'
          ? 'Applicant needs structured screening answers before deeper research.'
          : 'Applicant meets known hard requirements and should continue through screening/research.',
    strengths,
    concerns,
    missing_information: missingFields,
    suggested_questions:
      missingFields.length > 0
        ? missingFields.map((field) => `Please clarify: ${field}`)
        : [
            'Confirm relevant work experience details.',
            'Confirm availability for night commercial jobs and Saturdays.',
          ],
    suggested_next_step:
      recommendation === 'pass_hard_miss'
        ? 'Draft pass recommendation for owner review.'
        : recommendation === 'needs_more_info'
          ? 'Send structured screening questions.'
          : 'Run standard public research and continue text/email screening.',
    category_scores: buildInitialScorecard(applicant),
    report_payload: {
      generated_by: 'ranger_foundation',
      mode: 'initial_report',
    },
  }
}

function evidenceForCategory(
  evidence: RangerEvidence[],
  category: RangerScoreCategory,
) {
  return evidence.filter((item) => item.category === category)
}

function scoreFromEvidence(
  evidence: RangerEvidence[],
  fallbackReasons: string[],
) {
  const redFlags = evidence.filter((item) => item.sentiment === 'red_flag')
  const concerns = evidence.filter((item) => item.sentiment === 'concern')
  const positives = evidence.filter((item) => item.sentiment === 'positive')
  const reasons = evidence.length
    ? evidence.slice(0, 3).map((item) => item.finding)
    : fallbackReasons

  if (redFlags.length > 0) return { score: 20, label: 'weak' as const, reasons }
  if (concerns.length > 0)
    return { score: 45, label: 'mixed' as const, reasons }
  if (positives.length > 1)
    return { score: 80, label: 'solid' as const, reasons }
  if (positives.length === 1)
    return { score: 70, label: 'solid' as const, reasons }
  return { score: 0, label: 'unknown' as const, reasons }
}

function confidenceFromEvidence(evidence: RangerEvidence[]) {
  if (evidence.some((item) => item.confidence === 'high')) return 'high'
  if (evidence.some((item) => item.confidence === 'medium')) return 'medium'
  if (evidence.length > 0) return 'low'
  return 'unknown'
}

function describeEvidence(item: RangerEvidence) {
  const snippet = item.raw_snippet?.replace(/\s+/g, ' ').trim().slice(0, 220)
  const source = item.source_label || item.source_url || item.evidence_type
  return snippet
    ? `${item.finding} Source: ${source}. Snippet: ${snippet}`
    : item.finding
}

export function buildCandidateReportFromEvidence(params: {
  applicant: RangerApplicant
  evidence: RangerEvidence[]
}): Omit<
  RangerCandidateReport,
  'id' | 'created_at' | 'updated_at' | 'generated_at'
> {
  const { applicant, evidence } = params
  const base = buildInitialCandidateReport(applicant)
  const scorecard = { ...base.category_scores }
  const categories: RangerScoreCategory[] = [
    'reliability',
    'judgment',
    'professionalism',
    'honesty',
    'safety',
    'experience',
    'communication',
  ]

  for (const category of categories) {
    scorecard[category] = scoreFromEvidence(
      evidenceForCategory(evidence, category),
      scorecard[category].reasons,
    )
  }

  const concerns = [
    ...base.concerns,
    ...evidence
      .filter(
        (item) => item.sentiment === 'concern' || item.sentiment === 'red_flag',
      )
      .slice(0, 5)
      .map((item) => describeEvidence(item)),
  ]
  const strengths = [
    ...base.strengths,
    ...evidence
      .filter((item) => item.sentiment === 'positive')
      .slice(0, 5)
      .map((item) => describeEvidence(item)),
  ]
  const hasRedFlag = evidence.some((item) => item.sentiment === 'red_flag')
  const hasConcern = concerns.length > base.concerns.length
  const missingInformation = base.missing_information
  const recommendation: RangerRecommendation = hasRedFlag
    ? 'owner_review'
    : base.overall_recommendation === 'needs_more_info'
      ? 'needs_more_info'
      : hasConcern
        ? 'owner_review'
        : missingInformation.length === 0 && evidence.length > 0
          ? 'ready_for_phone_call'
          : base.overall_recommendation

  return {
    ...base,
    overall_recommendation: recommendation,
    overall_fit: hasRedFlag
      ? 'low'
      : hasConcern
        ? 'medium'
        : determineFit(recommendation),
    research_confidence: confidenceFromEvidence(evidence),
    summary:
      evidence.length > 0
        ? `Ranger reviewed ${evidence.length} sourced public/reply evidence item${evidence.length === 1 ? '' : 's'} for job-relevant fit.`
        : base.summary,
    strengths: Array.from(new Set(strengths)),
    concerns: Array.from(new Set(concerns)),
    suggested_questions:
      missingInformation.length > 0
        ? missingInformation.map((field) => `Please clarify: ${field}`)
        : hasConcern
          ? [
              'Ask the applicant to clarify the sourced concern before scheduling.',
            ]
          : [
              'Ask for two phone-screen windows.',
              'Confirm punctuality expectations for customer-home jobs.',
              'Ask for one prior supervisor or customer reference.',
            ],
    suggested_next_step:
      recommendation === 'ready_for_phone_call'
        ? 'Schedule a phone screen or ask for two available call windows.'
        : recommendation === 'owner_review'
          ? 'Owner review before contacting applicant again.'
          : base.suggested_next_step,
    category_scores: scorecard,
    report_payload: {
      generated_by: 'ranger_tool_belt',
      mode: 'evidence_report',
      evidence_count: evidence.length,
    },
  }
}

export async function rebuildCandidateReport(params: {
  supabase: import('@supabase/supabase-js').SupabaseClient
  applicant: RangerApplicant
}) {
  const { supabase, applicant } = params
  const { data: evidence, error: evidenceError } = await supabase
    .from('ranger_evidence')
    .select('*')
    .eq('applicant_id', applicant.id)
    .order('created_at', { ascending: false })

  if (evidenceError) throw evidenceError

  const reportPayload = buildCandidateReportFromEvidence({
    applicant,
    evidence: (evidence || []) as RangerEvidence[],
  })
  const { data: latestReport, error: latestReportError } = await supabase
    .from('ranger_candidate_reports')
    .select('id')
    .eq('applicant_id', applicant.id)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestReportError) throw latestReportError

  if (latestReport?.id) {
    const { data: report, error: reportError } = await supabase
      .from('ranger_candidate_reports')
      .update({
        ...reportPayload,
        generated_at: new Date().toISOString(),
      })
      .eq('id', latestReport.id)
      .select('*')
      .single()

    if (reportError) throw reportError
    return report as RangerCandidateReport
  }

  const { data: report, error: reportError } = await supabase
    .from('ranger_candidate_reports')
    .insert(reportPayload)
    .select('*')
    .single()

  if (reportError) throw reportError
  return report as RangerCandidateReport
}
