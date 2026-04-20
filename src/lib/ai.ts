/**
 * AI utilities using Anthropic Claude via Vercel AI SDK
 * Per .cursorrules: Using Anthropic Claude 3.5 Sonnet for job description generation
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'

export type SocialDraftType =
  | 'educational'
  | 'milestone'
  | 'seasonal_tip'
  | 'local_seo'
  | 'behind_scenes'

export type SocialDraftContext = {
  city?: string
  service?: string
  milestoneCount?: number
  milestoneLabel?: string
  month?: number
  recentCities?: string[]
}

const DRAFT_PROMPTS: Record<
  SocialDraftType,
  (ctx: SocialDraftContext) => string
> = {
  educational: (
    ctx,
  ) => `Write a Google Business Profile / social media post for Sasquatch Carpet Cleaning in Monument, Colorado.

Type: Educational tip — teach the reader something genuinely useful about carpet or upholstery care.

Topics to choose from (pick whichever feels freshest):
- How often carpets should actually be cleaned (most people don't know)
- Why hot water extraction beats dry cleaning for deep soil
- What carpet protector does and when it's worth it
- How pet urine damage works at the fiber level and why enzyme treatment matters
- Why vacuuming direction matters
- The difference between a portable unit and a truck-mount

Service area: Monument, Palmer Lake, Castle Rock, Colorado Springs, Black Forest, Woodmoor, Gleneagle, Larkspur${ctx.service ? `\nRecent service focus: ${ctx.service}` : ''}

Rules:
- 2-3 short paragraphs, 120-150 words total
- Warm and conversational, like a neighbor who happens to know a lot about carpet
- No hashtags, no excessive punctuation
- End with a soft call to action: "Book online or call (719) 249-8791"
- Include a short punchy title (max 60 chars)

Return plain text in this format:
TITLE: <title here>
BODY: <body here>`,

  milestone: (
    ctx,
  ) => `Write a Google Business Profile / social media post for Sasquatch Carpet Cleaning in Monument, Colorado.

Type: Milestone celebration — we hit a meaningful number.

Milestone: ${ctx.milestoneLabel ?? `${ctx.milestoneCount} jobs completed${ctx.city ? ` in ${ctx.city}` : ''}`}

Rules:
- Warm, genuine, not braggy — thank the community, not yourself
- 2 short paragraphs, 100-130 words
- Reference the specific area if provided
- End with: "Thank you for trusting us in your home. Book at sasquatchcarpet.com or call (719) 249-8791"
- No hashtags
- Include a short punchy title (max 60 chars)

Return plain text in this format:
TITLE: <title here>
BODY: <body here>`,

  seasonal_tip: (ctx) => {
    const month = ctx.month ?? new Date().getMonth() + 1
    const seasonHints: Record<number, string> = {
      1: 'New Year, fresh start. Salt and sand tracked in all winter. Great time to reset.',
      2: 'Still deep winter in Colorado. Mud and slush season is coming. Now is the time to prep.',
      3: 'Mud season is starting. Snow melt, pet paws, kids in and out. Carpets take a beating.',
      4: 'Spring cleaning season. Allergens are up, windows are opening, carpets need a refresh.',
      5: 'Late spring. Pollen and outdoor traffic at a peak. Great time for a deep clean.',
      6: 'Summer starts. Kids home all day. BBQ season. Outdoor traffic in and out constantly.',
      7: 'Peak summer. Heat means carpets dry faster after cleaning — great timing.',
      8: 'Late summer. Back to school incoming. Get ahead of the school-year traffic.',
      9: 'Fall is here. Holiday prep season. Get carpets done before guests arrive.',
      10: 'Pre-holiday season. Thanksgiving is coming. Now is the time.',
      11: 'Holiday season. Last chance to get carpets clean before Christmas gatherings.',
      12: 'Winter. Colorado salt and sand season. New Year is a great fresh start.',
    }
    return `Write a Google Business Profile / social media post for Sasquatch Carpet Cleaning in Monument, Colorado.

Type: Seasonal tip — timely advice tied to the current time of year.

Current month context: ${seasonHints[month] ?? 'Seasonal carpet care tip.'}
Service area: Monument, Palmer Lake, Castle Rock, Colorado Springs, Black Forest${ctx.city ? `, ${ctx.city}` : ''}

Rules:
- 2 short paragraphs, 100-130 words
- Feels timely and relevant to right now, not generic
- Reference Colorado weather or lifestyle naturally
- End with: "Book online at sasquatchcarpet.com or call (719) 249-8791"
- No hashtags
- Include a short punchy title (max 60 chars)

Return plain text in this format:
TITLE: <title here>
BODY: <body here>`
  },

  local_seo: (ctx) => {
    const city = ctx.city ?? ctx.recentCities?.[0] ?? 'Castle Rock'
    return `Write a Google Business Profile / social media post for Sasquatch Carpet Cleaning in Monument, Colorado.

Type: Local SEO post — targets a specific city we serve. Should feel natural, not keyword-stuffed.

Target city: ${city}
Service: ${ctx.service ?? 'carpet cleaning'}

Rules:
- Mention the city naturally 1-2 times
- 2-3 short paragraphs, 120-150 words
- Reference something real about the area (elevation, lifestyle, weather, neighborhoods) if you can
- Position us as the local experts who know that area
- End with: "Serving ${city} and the surrounding area — book at sasquatchcarpet.com or call (719) 249-8791"
- No hashtags
- Include a short punchy title (max 60 chars)

Return plain text in this format:
TITLE: <title here>
BODY: <body here>`
  },

  behind_scenes:
    () => `Write a Google Business Profile / social media post for Sasquatch Carpet Cleaning in Monument, Colorado.

Type: Behind the scenes — a glimpse into the real work, the early mornings, the prep, the craft.

Topics to choose from:
- Prepping the truck and equipment before a big job day
- The ritual of mixing the right solution for different carpet types
- What it actually takes to clean a badly soiled carpet vs a maintenance clean
- Driving out to a job in the Colorado mountains early in the morning
- The satisfaction of packing up after a job that went really well

Rules:
- Personal and genuine — first-person is fine ("We start every morning...")
- 2 paragraphs, 100-130 words
- No hashtags, no excessive punctuation
- End with: "Book us at sasquatchcarpet.com or call (719) 249-8791"
- Include a short punchy title (max 60 chars)

Return plain text in this format:
TITLE: <title here>
BODY: <body here>`,
}

function parseDraftResponse(text: string): { title: string; body: string } {
  const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|$)/i)
  const bodyMatch = text.match(/BODY:\s*([\s\S]+)/i)
  return {
    title: titleMatch?.[1]?.trim() ?? '',
    body: bodyMatch?.[1]?.trim() ?? text.trim(),
  }
}

export async function generateSocialDraft(
  type: SocialDraftType,
  context: SocialDraftContext = {},
): Promise<{ title: string; body: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const anthropic = createAnthropic({ apiKey })
  const prompt = DRAFT_PROMPTS[type](context)

  const { text } = await generateText({
    model: anthropic('claude-3-5-sonnet-20241022'),
    prompt,
    temperature: 0.8,
  })

  return parseDraftResponse(text)
}

/**
 * Generate a professional job description from field notes
 * Uses Claude 3.5 Sonnet via Vercel AI SDK
 * @param voiceNote - Raw field notes from technician
 * @param serviceName - Type of service performed
 * @param city - City where job was performed
 * @param neighborhood - Neighborhood (optional)
 */
export async function generateJobDescription(
  voiceNote: string,
  serviceName: string,
  city: string,
  neighborhood: string | null,
): Promise<string> {
  console.log('🧠 [AI] Starting AI generation...')

  try {
    const locationString = neighborhood ? `${neighborhood}, ${city}` : city

    // Rotate through 6 description styles so published job pages don't all sound the same
    const descriptionStyles = [
      `Professional case study tone. Open with the specific cleaning challenge, describe the treatment approach, and close with the result. Emphasize the technical process (pre-spray, CRB agitation, hot water extraction, acid rinse). 120-150 words.`,
      `Storytelling tone. Paint a picture of what the space looked like before, what the homeowner was dealing with, and how it looked after. Make the transformation feel real. 120-150 words.`,
      `Empathy-first tone. Start from the homeowner's perspective — what they were struggling with and why it mattered to them. Then explain how we solved it technically. 120-150 words.`,
      `Educational tone. Use this job as an example to teach the reader something useful about carpet care — why the specific technique matters, what causes this type of problem, or what most people don't know. 120-150 words.`,
      `Local community tone. Ground the post in the specific neighborhood and make it feel like a neighbor helping a neighbor. Reference the area naturally and write with warmth. 120-150 words.`,
      `Results-focused tone. Lead with the outcome — what the space looks, feels, and smells like now. Use sensory language. Then briefly explain the process that got it there. 120-150 words.`,
    ]

    const style =
      descriptionStyles[Math.floor(Math.random() * descriptionStyles.length)]

    const prompt = `You are writing a job completion description for Sasquatch Carpet Cleaning's website. Each published job is a real SEO page — write with enough local and technical detail to be genuinely useful and indexable.

Location: ${locationString}
Service: ${serviceName}
Field notes from technician: ${voiceNote}

Style for this post: ${style}

Rules:
- Always mention the location (${locationString}) naturally
- Include specific technical details from the field notes
- No pricing, no hashtags, no excessive exclamation points
- Write as if a knowledgeable human wrote it, not a template`

    console.log('📝 [AI] Prompt prepared:', {
      location: locationString,
      service: serviceName,
      voiceNoteLength: voiceNote.length,
    })

    console.log('🔑 [AI] Checking API key...')
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error('❌ [AI] ANTHROPIC_API_KEY not found in environment')
      throw new Error('ANTHROPIC_API_KEY not configured')
    }
    console.log('✅ [AI] API key found:', apiKey.substring(0, 20) + '...')

    console.log('🤖 [AI] Creating Anthropic client...')
    // Create Anthropic instance with API key
    const anthropic = createAnthropic({
      apiKey: apiKey,
    })

    console.log('🤖 [AI] Calling Anthropic API...')
    // Generate text using Vercel AI SDK with Anthropic
    const { text } = await generateText({
      model: anthropic('claude-3-5-sonnet-20241022'),
      prompt,
      temperature: 0.7,
    })

    console.log('✅ [AI] AI generation successful!')
    console.log('📊 [AI] Generated text length:', text.length)

    return text
  } catch (error) {
    console.error('❌ [AI] Error generating job description:', error)
    console.error('❌ [AI] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : 'No stack trace',
    })
    throw new Error('Failed to generate description')
  }
}
