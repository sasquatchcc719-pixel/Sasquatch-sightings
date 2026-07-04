import OpenAI from 'openai'
import { createAdminClient } from '@/supabase/server'
import { ECHO_STYLES, type EchoStyle, type EchoJobContext } from './types'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Styles are STRUCTURAL variations only — every one is bound by the same
// facts-only rule in the system prompt. The old style wheel instructed the
// model to invent homeowner situations, which produced the same AI slop the
// July 2026 job-page rewrite purged. Keys are stored in the DB; do not rename.
const STYLE_INSTRUCTIONS: Record<EchoStyle, string> = {
  before_after: `Open with what the carpet looked like before ONLY if the field notes state it; otherwise open with the scope of work (areas and quantities), then the result visible in the photo. Never invent the "before" condition.`,
  the_challenge: `Open with the specific cleaning problem THE FIELD NOTES mention (e.g. urine treatment on the invoice = pet odor job). If the notes name no problem, open with the scope of work instead. Never invent a problem or a customer situation.`,
  educational: `Open with one real process fact relevant to this job (why CRB agitation matters, why an acid-side rinse prevents re-soiling, why enzyme treatment must reach the pad) and tie it to what was actually done here. Teach, don't sell.`,
  local_shoutout: `Mention the city prominently and plainly — matter-of-fact local presence. Use ONLY location facts provided. No invented weather, seasons, or community events.`,
  the_result: `Describe the visible outcome — what the carpet in the photo looks like now (clean pile, brightened traffic lanes, uniform color). Physical observations only; never describe how the homeowner felt.`,
  myth_buster: `State one common carpet-cleaning misconception and correct it with a real process fact, tied to what was done on this job. No rhetorical questions as the opener.`,
}

const BANNED_OPENERS = [
  'Just wrapped up',
  'Today we',
  'We just finished',
  'Did another',
  'Hey there',
  'Hello',
  'Another satisfied',
  'Looking at',
]

export async function pickStyle(): Promise<EchoStyle> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('social_post_drafts')
    .select('style')
    .not('style', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3)

  const recent = new Set<string>(
    (data ?? [])
      .map((r) => (r as { style: string | null }).style)
      .filter((s): s is string => Boolean(s)),
  )
  const eligible = ECHO_STYLES.filter((s) => !recent.has(s))
  const pool: readonly EchoStyle[] =
    eligible.length > 0 ? eligible : ECHO_STYLES
  const idx = Math.floor(Math.random() * pool.length)
  return pool[idx]!
}

export async function generatePostBody(
  job: EchoJobContext,
  style: EchoStyle,
): Promise<{ body: string; style: EchoStyle }> {
  const lineItems =
    job.line_item_names.filter(Boolean).join(', ') || job.service_name
  const location = job.neighborhood
    ? `${job.neighborhood}, ${job.city ?? ''}`
    : (job.city ?? '')

  const systemPrompt = `You write Google Business Profile + Facebook posts for Sasquatch Carpet Cleaning job completions.

TODAY'S STYLE: ${style.toUpperCase().replace(/_/g, ' ')}
${STYLE_INSTRUCTIONS[style]}

HARD RULE — FACTS ONLY: use only the service items, location, and field notes provided. NEVER invent the customer, their pets or kids, how a stain happened, what the homeowner felt, years of buildup, weather, or seasons. If the notes don't say it, it doesn't go in the post.

FORBIDDEN OPENERS — do NOT start with these or anything that pattern-matches them:
${BANNED_OPENERS.map((o) => `- "${o}..."`).join('\n')}
Also never open with a question.

BANNED WORDS/PHRASES: "cozy", "transformation", "magic", "refresh"/"refreshed", "nestled", "vibrant", "Did you know", "Think again", "we had the pleasure".

ALWAYS:
- 2-3 sentences max. Shorter beats padded.
- Use the REAL service performed (${lineItems}) — never say "Standard Carpet Cleaning"
- Mention the location naturally (${location})
- Vary the first 5 words from anything you might typically write
- NO hashtags, NO pricing, NO phone numbers, NO exclamation points
- The field notes are factual — use their specifics, add nothing beyond them
- Voice: a competent tradesperson noting the day's work. Concrete and plain.`

  const userPrompt = `Service performed: ${lineItems}
Location: ${location}
${job.ai_description ? 'Existing description / field notes:\n' + job.ai_description : 'No additional notes'}`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 220,
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  const body = response.choices[0]?.message?.content?.trim() ?? ''
  if (!body) throw new Error('Empty post body from OpenAI')
  return { body, style }
}
