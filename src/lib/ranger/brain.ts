import OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  executeRangerAgentTool,
  RANGER_AGENT_TOOLS,
  type RangerAgentToolContext,
} from './agent-tools'
import { appendRangerCommandMessage, loadRangerThreadMemory } from './memory'
import { rangerBrainModel, rangerModelSummary } from './models'
import type { RangerCommandThread } from './types'

type RangerContextApplicant = {
  id: string
  status: string
  full_name: string | null
  email: string | null
  phone: string | null
  city_area: string | null
  missing_fields: string[]
  hard_requirement_misses: string[]
  next_action: string | null
  created_at: string
}

type RangerContextReport = {
  applicant_id: string
  overall_recommendation: string
  overall_fit: string
  summary: string | null
  concerns: string[]
  strengths: string[]
  missing_information: string[]
  suggested_next_step: string | null
  generated_at: string
}

type RangerContextMessage = {
  applicant_id: string | null
  channel: string
  direction: string
  subject: string | null
  body: string
  created_at: string
}

type RangerContextEvidence = {
  applicant_id: string
  evidence_type: string
  source_label: string | null
  source_url: string | null
  finding: string
  confidence: string
  category: string
  sentiment: string
  raw_snippet: string | null
  metadata: Record<string, unknown>
  created_at: string
}

type RangerContext = {
  applicants: RangerContextApplicant[]
  reports: RangerContextReport[]
  evidence: RangerContextEvidence[]
  messages: RangerContextMessage[]
}

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

function applicantName(applicant: RangerContextApplicant) {
  return (
    applicant.full_name ||
    applicant.email ||
    applicant.phone ||
    'Unknown applicant'
  )
}

async function loadRangerContext(
  supabase: SupabaseClient,
): Promise<RangerContext> {
  const [
    { data: applicants, error: applicantsError },
    { data: reports, error: reportsError },
  ] = await Promise.all([
    supabase
      .from('ranger_applicants')
      .select(
        'id, status, full_name, email, phone, city_area, missing_fields, hard_requirement_misses, next_action, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(12),
    supabase
      .from('ranger_candidate_reports')
      .select(
        'applicant_id, overall_recommendation, overall_fit, summary, concerns, strengths, missing_information, suggested_next_step, generated_at',
      )
      .order('generated_at', { ascending: false })
      .limit(12),
  ])

  if (applicantsError) throw applicantsError
  if (reportsError) throw reportsError

  const applicantIds = (applicants || []).map((applicant) => applicant.id)
  const { data: messages, error: messagesError } = applicantIds.length
    ? await supabase
        .from('ranger_messages')
        .select('applicant_id, channel, direction, subject, body, created_at')
        .in('applicant_id', applicantIds)
        .order('created_at', { ascending: false })
        .limit(30)
    : { data: [], error: null }

  if (messagesError) throw messagesError

  const { data: evidence, error: evidenceError } = applicantIds.length
    ? await supabase
        .from('ranger_evidence')
        .select(
          'applicant_id, evidence_type, source_label, source_url, finding, confidence, category, sentiment, raw_snippet, metadata, created_at',
        )
        .in('applicant_id', applicantIds)
        .order('created_at', { ascending: false })
        .limit(40)
    : { data: [], error: null }

  if (evidenceError) throw evidenceError

  return {
    applicants: (applicants || []) as RangerContextApplicant[],
    reports: (reports || []) as RangerContextReport[],
    evidence: (evidence || []) as RangerContextEvidence[],
    messages: (messages || []) as RangerContextMessage[],
  }
}

function formatApplicantSummary(context: RangerContext) {
  if (context.applicants.length === 0) {
    return 'Nothing in the Ranger pipeline yet. Once Gmail pulls applicants in, I’ll start sorting them.'
  }

  const lines = context.applicants
    .slice(0, 8)
    .map((applicant) => {
      const report = context.reports.find(
        (item) => item.applicant_id === applicant.id,
      )
      const misses = applicant.hard_requirement_misses.length
        ? ` Hard misses: ${applicant.hard_requirement_misses.join(', ')}.`
        : ''
      return `- ${applicantName(applicant)}: ${applicant.status}; fit ${report?.overall_fit || 'unknown'}; next ${report?.suggested_next_step || applicant.next_action || 'review'}.${misses}`
    })
    .join('\n')

  return `Here’s the board right now:\n\n${lines}`
}

function buildContextBlock(context: RangerContext) {
  return JSON.stringify(
    {
      applicants: context.applicants,
      reports: context.reports,
      evidence: context.evidence.map((item) => ({
        ...item,
        raw_snippet: item.raw_snippet
          ? item.raw_snippet.length > 700
            ? `${item.raw_snippet.slice(0, 700)}...`
            : item.raw_snippet
          : null,
      })),
      recentMessages: context.messages.map((message) => ({
        ...message,
        body:
          message.body.length > 1000
            ? `${message.body.slice(0, 1000)}...`
            : message.body,
      })),
    },
    null,
    2,
  )
}

function formatThreadMemory(
  memory: Awaited<ReturnType<typeof loadRangerThreadMemory>>,
) {
  if (memory.length === 0)
    return 'No prior Ranger command memory in this thread.'
  return memory
    .map((message) => {
      const body =
        message.body.length > 900
          ? `${message.body.slice(0, 900)}...`
          : message.body
      return `${message.role.toUpperCase()}: ${body}`
    })
    .join('\n')
}

function helpText() {
  return `I’m here. I can watch the hiring pipeline, summarize applicants, and tell you who needs attention.

Commands:
/help - show this menu
/applicants - latest applicant pipeline
/today - same as applicants for now
/status - quick system status
/sms <name> - text screening questions
/sms <name> | <message> - text a custom message
/research <name> - queue deep research
/records <name> - queue public-records check
/recordsall - queue public-records checks for active applicants
/researchall - queue deep research for active applicants
/textmissing - text screening questions to applicants missing info
/top - show top candidates
/stalecleanup - mark stale non-repliers ghosted
/remind <name> - set a follow-up reminder
/schedule <name> | tomorrow 10am - log a phone screen window
/note <name> | <note> - add owner note
/outcome <name> | good_hire - record outcome
/setstatus <name> | phone_call_ready - update status

You can also talk normally:
"who looks promising?"
"what do we know about David?"
"who needs a reply?"`
}

async function answerWithOpenAI(params: {
  question: string
  context: RangerContext
  agentContext: RangerAgentToolContext
  threadMemory: Awaited<ReturnType<typeof loadRangerThreadMemory>>
}) {
  if (!openai) {
    return 'OPENAI_API_KEY is not configured, so Ranger cannot answer with AI yet.'
  }

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are Ranger, Chuck's hiring lieutenant for Sasquatch Carpet Cleaning.

You are talking to Chuck, the owner, in Telegram. You are not a generic chatbot. You are a capable personal assistant who owns the hiring pipeline, follows through, and speaks like a sharp teammate.

Style:
- Be conversational, direct, specific, and a little gritty when needed.
- Lead with the answer or recommendation.
- Use short paragraphs or a few bullets when useful.
- Do not say "Facts:" and "Recommendations:" unless Chuck asks for a formal report.
- Do not sound like HR software, a legal disclaimer, or a corporate report.
- Do not over-explain obvious caveats.
- If you made a move, say exactly what you did.
- It is okay to say "my read is..." when making a judgment from limited data.
- If the data is thin, say what is missing and what you want to ask next.
- If Chuck asks what you found, especially public-records or research concerns, include the actual source labels, snippets, URLs, and confidence from Ranger evidence.

Hiring rules:
- Use only the provided Ranger applicant data.
- Separate confirmed data from your read/opinion.
- Do not claim public research is complete unless the data says so.
- Never hide sourced evidence behind vague phrases like "possible concern." Say what the source says and how confident Ranger is that it matches the applicant.
- Final hire/pass decisions stay with Chuck.
- You may autonomously queue research, run records checks, set reminders, send routine screening SMS/email, inspect evidence, and maintain the pipeline.
- Ask approval before pass/hire decisions or non-routine custom applicant messages.
- The important early filters are transportation, driver's license, nighttime commercial work, Saturday availability, physical work, communication, reliability, and relevant work experience.

Use tools when they help. Do not pretend you used a tool if you did not.`,
    },
    {
      role: 'user',
      content: `Owner question: ${params.question}

Recent command memory:
${formatThreadMemory(params.threadMemory)}

Ranger data:
${buildContextBlock(params.context)}`,
    },
  ]

  let lastText = ''
  for (let round = 0; round < 6; round += 1) {
    const completion = await openai.chat.completions.create({
      model: rangerBrainModel(),
      temperature: 0.55,
      max_tokens: 650,
      messages,
      tools: RANGER_AGENT_TOOLS as unknown as OpenAI.ChatCompletionTool[],
      tool_choice: 'auto',
    })

    const message = completion.choices[0]?.message
    if (!message) break

    if (message.tool_calls && message.tool_calls.length > 0) {
      messages.push(message)
      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== 'function') continue
        let payload: Record<string, unknown> = {}
        try {
          payload = JSON.parse(toolCall.function.arguments || '{}') as Record<
            string,
            unknown
          >
        } catch {
          payload = {}
        }

        const result = await executeRangerAgentTool({
          context: params.agentContext,
          name: toolCall.function.name,
          payload,
        })
        const content = JSON.stringify(result)
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content,
        })
        await appendRangerCommandMessage({
          supabase: params.agentContext.supabase,
          threadId: params.agentContext.thread.id,
          role: 'tool',
          body: `${toolCall.function.name}: ${content}`,
          applicantId:
            'applicantId' in result && typeof result.applicantId === 'string'
              ? result.applicantId
              : null,
          metadata: {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            specialist: 'specialist' in result ? result.specialist : null,
          },
        })
      }
      continue
    }

    lastText = (message.content || '').trim()
    break
  }

  return (
    lastText ||
    'I tried to work that through, but I did not get a usable answer. Try asking it more directly or use a command.'
  )
}

export async function answerRangerTelegramMessage(params: {
  supabase: SupabaseClient
  text: string
  thread: RangerCommandThread
  actor: string
  chatId?: string | number | null
}) {
  const text = params.text.trim()
  const lower = text.toLowerCase()
  const context = await loadRangerContext(params.supabase)
  const threadMemory = await loadRangerThreadMemory({
    supabase: params.supabase,
    threadId: params.thread.id,
    limit: 18,
  })

  if (lower === '/start' || lower === '/help' || lower === 'help') {
    return helpText()
  }

  if (lower === '/applicants' || lower === '/today') {
    return formatApplicantSummary(context)
  }

  if (lower === '/status') {
    return `I’m online.

Applicants in pipeline: ${context.applicants.length}
Brain: ${openai ? 'OpenAI connected' : 'OpenAI missing'}
Models: ${JSON.stringify(rangerModelSummary())}
Latest applicant: ${context.applicants[0] ? applicantName(context.applicants[0]) : 'none'}`
  }

  return answerWithOpenAI({
    question: text,
    context,
    threadMemory,
    agentContext: {
      supabase: params.supabase,
      thread: params.thread,
      actor: params.actor,
      chatId: params.chatId || null,
    },
  })
}
