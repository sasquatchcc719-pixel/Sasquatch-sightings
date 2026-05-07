import type {
  RangerApplicant,
  RangerCategoryScore,
  RangerRecommendation,
  RangerScorecard,
  RangerScoreCategory,
} from './types'

export const RANGER_HARD_REQUIREMENTS = [
  {
    key: 'has_reliable_transportation',
    label: 'Reliable transportation every workday',
    miss: 'No reliable transportation',
  },
  {
    key: 'has_valid_driver_license',
    label: "Valid driver's license",
    miss: "No valid driver's license",
  },
  {
    key: 'can_work_nights',
    label: 'Can work nighttime commercial jobs',
    miss: 'Cannot work nighttime commercial jobs',
  },
  {
    key: 'can_work_saturdays',
    label: 'Can work Saturdays',
    miss: 'Cannot work Saturdays',
  },
  {
    key: 'can_do_physical_work',
    label: 'Can handle hard physical carpet-cleaning work',
    miss: 'Cannot handle the physical workload',
  },
] as const

export const RANGER_REQUIRED_FIELDS = [
  { key: 'full_name', label: 'Full name' },
  { key: 'phone', label: 'Phone number' },
  { key: 'city_area', label: 'City/area' },
  { key: 'has_reliable_transportation', label: 'Reliable transportation' },
  { key: 'has_valid_driver_license', label: "Driver's license" },
  { key: 'can_work_nights', label: 'Night job availability' },
  { key: 'can_work_saturdays', label: 'Saturday availability' },
  { key: 'can_do_physical_work', label: 'Physical work confirmation' },
  { key: 'relevant_experience', label: 'Relevant experience' },
] as const

export const RANGER_SCREENING_QUESTIONS = [
  'What city/area do you live in?',
  'Do you have reliable transportation every workday and a valid driver’s license?',
  'Can you work nighttime commercial jobs when scheduled?',
  'Can you work Saturdays? We work every Saturday.',
  'This job is hard physical work: equipment, hoses, stairs, long jobs, and being on your feet. Are you comfortable with that?',
  'What relevant work experience do you have? Carpet cleaning is not required, but cleaning, moving, labor, construction, delivery, or customer-facing work helps.',
  'Please answer each question directly so we can keep the process moving.',
] as const

export const RANGER_OUTCOME_LABELS = [
  'applied',
  'hard_miss_pass',
  'ghosted',
  'screened_out',
  'candidate_report_ready',
  'owner_approved_next_step',
  'interviewed',
  'offered',
  'hired',
  'passed',
  'no_show',
  'good_hire',
  'bad_hire',
] as const

export function getMissingFields(
  applicant: Partial<RangerApplicant>,
): string[] {
  return RANGER_REQUIRED_FIELDS.filter(({ key }) => {
    const value = applicant[key as keyof RangerApplicant]
    if (typeof value === 'boolean') return value === null
    if (Array.isArray(value)) return value.length === 0
    return value == null || value === ''
  }).map(({ label }) => label)
}

export function getHardRequirementMisses(
  applicant: Partial<RangerApplicant>,
): string[] {
  return RANGER_HARD_REQUIREMENTS.filter(({ key }) => {
    return applicant[key as keyof RangerApplicant] === false
  }).map(({ miss }) => miss)
}

function categoryScore(score: number, reasons: string[]): RangerCategoryScore {
  const label =
    score >= 85
      ? 'strong'
      : score >= 70
        ? 'solid'
        : score >= 45
          ? 'mixed'
          : score > 0
            ? 'weak'
            : 'unknown'

  return { score, label, reasons }
}

export function buildInitialScorecard(
  applicant: Partial<RangerApplicant>,
): RangerScorecard {
  const hasExperience = Boolean(applicant.relevant_experience?.trim())
  const hardMisses = getHardRequirementMisses(applicant)

  const scores: Record<RangerScoreCategory, RangerCategoryScore> = {
    transportation: categoryScore(
      applicant.has_reliable_transportation &&
        applicant.has_valid_driver_license
        ? 100
        : hardMisses.some((miss) =>
              miss.toLowerCase().includes('transportation'),
            )
          ? 15
          : 0,
      applicant.has_reliable_transportation &&
        applicant.has_valid_driver_license
        ? ['Has reliable transportation and a valid driver’s license.']
        : ['Transportation and license are not fully verified.'],
    ),
    schedule: categoryScore(
      applicant.can_work_nights && applicant.can_work_saturdays ? 100 : 0,
      applicant.can_work_nights && applicant.can_work_saturdays
        ? ['Can work nighttime commercial jobs and Saturdays.']
        : ['Night and Saturday availability are not fully verified.'],
    ),
    physical_work: categoryScore(
      applicant.can_do_physical_work
        ? 90
        : applicant.can_do_physical_work === false
          ? 10
          : 0,
      applicant.can_do_physical_work
        ? ['Confirmed comfort with hard physical work.']
        : ['Physical workload confirmation is missing or negative.'],
    ),
    experience: categoryScore(
      hasExperience ? 75 : 0,
      hasExperience
        ? ['Provided relevant work experience for review.']
        : [
            'Relevant labor, cleaning, delivery, or customer-service experience is missing.',
          ],
    ),
    fit: categoryScore(
      hardMisses.length === 0 ? 70 : 20,
      hardMisses.length === 0
        ? ['No known hard requirement misses.']
        : hardMisses,
    ),
    reliability: categoryScore(0, [
      'Waiting on response pattern and follow-through.',
    ]),
    communication: categoryScore(0, ['Waiting on screening reply quality.']),
    judgment: categoryScore(0, [
      'Waiting on public research and direct communication.',
    ]),
    professionalism: categoryScore(0, [
      'Waiting on public research and direct communication.',
    ]),
    honesty: categoryScore(0, ['Waiting on work-history consistency checks.']),
    safety: categoryScore(0, ['Waiting on sourced public research.']),
  }

  return scores
}

export function recommendNextStep(
  applicant: Partial<RangerApplicant>,
): RangerRecommendation {
  const hardMisses = getHardRequirementMisses(applicant)
  if (hardMisses.length > 0) return 'pass_hard_miss'

  const missingFields = getMissingFields(applicant)
  if (missingFields.length > 0) return 'needs_more_info'

  return 'continue_screening'
}

export function buildScreeningMessage(): string {
  return `Thanks for applying. Before we move forward, please answer these directly:

${RANGER_SCREENING_QUESTIONS.map(
  (question, index) => `${index + 1}. ${question}`,
).join('\n')}

This role includes nighttime commercial jobs, Saturday work, and hard physical carpet-cleaning work. Clear answers help us move faster.`
}
