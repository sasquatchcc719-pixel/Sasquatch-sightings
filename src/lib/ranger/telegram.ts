import type { RangerApplicant, RangerCandidateReport } from './types'

const RANGER_TELEGRAM_BOT_TOKEN =
  process.env.RANGER_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
const RANGER_TELEGRAM_CHAT_ID =
  process.env.RANGER_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID

type TelegramInlineKeyboardButton = {
  text: string
  callback_data: string
}

function applicantLabel(
  applicant: Pick<RangerApplicant, 'full_name' | 'phone' | 'email'>,
) {
  return (
    applicant.full_name ||
    applicant.phone ||
    applicant.email ||
    'Unknown applicant'
  )
}

export function buildCandidateReportTelegramMessage(params: {
  applicant: RangerApplicant
  report: RangerCandidateReport
}): string {
  const { applicant, report } = params
  const strengths = report.strengths.length
    ? report.strengths.map((item) => `- ${item}`).join('\n')
    : '- None recorded yet'
  const concerns = report.concerns.length
    ? report.concerns.map((item) => `- ${item}`).join('\n')
    : '- None recorded yet'
  const missing = report.missing_information.length
    ? `\nMissing info:\n${report.missing_information.map((item) => `- ${item}`).join('\n')}`
    : ''

  return `Candidate Report ready: ${applicantLabel(applicant)}

Overall fit: ${report.overall_fit}
Recommendation: ${report.overall_recommendation}
Identity confidence: ${report.identity_confidence}
Research confidence: ${report.research_confidence}

Strengths:
${strengths}

Concerns:
${concerns}${missing}

Suggested next step:
${report.suggested_next_step || 'Owner review'}`
}

export async function sendRangerTelegramMessage(params: {
  text: string
  chatId?: string | number | null
  buttons?: TelegramInlineKeyboardButton[][]
}): Promise<boolean> {
  const chatId = params.chatId || RANGER_TELEGRAM_CHAT_ID
  if (!RANGER_TELEGRAM_BOT_TOKEN || !chatId) {
    console.warn('[ranger/telegram] Credentials not configured, skipping send')
    return false
  }

  const response = await fetch(
    `https://api.telegram.org/bot${RANGER_TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: params.text,
        disable_web_page_preview: true,
        reply_markup: params.buttons
          ? { inline_keyboard: params.buttons }
          : undefined,
      }),
    },
  )

  if (!response.ok) {
    const error = await response.text()
    console.error('[ranger/telegram] Telegram API error:', error)
    return false
  }

  const result = await response.json()
  return Boolean(result.ok)
}

export function candidateReportButtons(
  applicantId: string,
): TelegramInlineKeyboardButton[][] {
  return [
    [
      {
        text: 'Send Screening',
        callback_data: `ranger:followup:${applicantId}`,
      },
      { text: 'Text Screening', callback_data: `ranger:sms:${applicantId}` },
    ],
    [
      { text: 'Deep Research', callback_data: `ranger:deep:${applicantId}` },
      {
        text: 'Public Records',
        callback_data: `ranger:records:${applicantId}`,
      },
    ],
    [
      { text: 'Phone Screen', callback_data: `ranger:late:${applicantId}` },
      { text: 'Pass', callback_data: `ranger:pass:${applicantId}` },
    ],
  ]
}

export function buildNewApplicantTelegramMessage(params: {
  applicant: RangerApplicant
  report: RangerCandidateReport
  sourceSubject?: string | null
}): string {
  const { applicant, report, sourceSubject } = params
  const hardMisses = applicant.hard_requirement_misses.length
    ? applicant.hard_requirement_misses.map((item) => `- ${item}`).join('\n')
    : '- None known'
  const missingFields = applicant.missing_fields.length
    ? applicant.missing_fields.map((item) => `- ${item}`).join('\n')
    : '- None known'

  return `New Ranger applicant: ${applicantLabel(applicant)}

Source: ${applicant.source}
Subject: ${sourceSubject || 'Unknown'}
Status: ${applicant.status}
Overall fit: ${report.overall_fit}
Recommendation: ${report.overall_recommendation}

Contact:
- Email: ${applicant.email || 'unknown'}
- Phone: ${applicant.phone || 'unknown'}
- Area: ${applicant.city_area || 'unknown'}

Hard requirement misses:
${hardMisses}

Missing screening info:
${missingFields}

Next step:
${report.suggested_next_step || applicant.next_action || 'Owner review'}`
}

export function buildApplicantReplyTelegramMessage(params: {
  applicant: RangerApplicant
  subject?: string | null
  body: string
}): string {
  const { applicant, subject, body } = params
  return `Applicant replied: ${applicantLabel(applicant)}

Subject: ${subject || 'No subject'}
Current status: ${applicant.status}

Reply preview:
${body.slice(0, 900)}

Ranger queued this reply for parsing and report updates.`
}
