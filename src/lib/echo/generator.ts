import OpenAI from 'openai'
import { createAdminClient } from '@/supabase/server'
import { ECHO_STYLES, type EchoStyle, type EchoJobContext } from './types'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const STYLE_INSTRUCTIONS: Record<EchoStyle, string> = {
  before_after: `Write a BEFORE/AFTER storytelling post. Open with a vivid 1-sentence picture of the problem (pet traffic, years of buildup, staining, etc.) then pivot to the result. Make the transformation feel satisfying. Mention the neighborhood naturally.`,
  the_challenge: `Lead with EMPATHY for the homeowner's situation — kids, pets, high traffic, years of neglect, or a specific struggle. Make the reader feel understood before you mention what we did. Mention the neighborhood naturally.`,
  educational: `Open with an EDUCATIONAL hook — something most people don't know about carpet cleaning (e.g. why CRB agitation matters, why pH-balanced rinse prevents re-soiling, why hot water extraction beats dry cleaning). Then tie it naturally to this specific job and location. Teach, don't sell.`,
  local_shoutout: `Write a warm LOCAL COMMUNITY shoutout post. Mention the specific neighborhood prominently and with pride — like you're part of the community, not just passing through. Reference something local or seasonal if possible (Colorado weather, allergen season, school year, etc.).`,
  the_result: `Focus entirely on THE OUTCOME and how the homeowner felt. Write it almost like a near-testimonial — what the space looks and feels like now. Use sensory language (fluffy, bright, fresh). Mention the neighborhood naturally.`,
  myth_buster: `Open with a CONTRARIAN or surprising hook — bust a common myth about carpet cleaning. Then connect it to the job. Make people think.`,
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

FORBIDDEN OPENERS — do NOT start with these or anything that pattern-matches them:
${BANNED_OPENERS.map((o) => `- "${o}..."`).join('\n')}

ALWAYS:
- 2-4 sentences max
- Use the REAL service performed (${lineItems}) — never say "Standard Carpet Cleaning"
- Mention the location naturally (${location})
- Vary the first 5 words from anything you might typically write
- NO hashtags
- NO pricing
- NO phone numbers
- NO excessive exclamation points
- Use the field notes / existing description if provided — don't ignore real specifics

If the field notes contain a specific problem (pet odor, water damage, heavy stains, etc.), weave it in.`

  const userPrompt = `Service performed: ${lineItems}
Location: ${location}
${job.ai_description ? 'Existing description / field notes:\n' + job.ai_description : 'No additional notes'}`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 220,
    temperature: 0.9,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  const body = response.choices[0]?.message?.content?.trim() ?? ''
  if (!body) throw new Error('Empty post body from OpenAI')
  return { body, style }
}
