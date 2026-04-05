/**
 * AI Job Description Generator API
 * Generates unique, SEO-friendly job completion descriptions
 */

import OpenAI from 'openai'
import { NextRequest, NextResponse } from 'next/server'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(request: NextRequest) {
  try {
    const { serviceType, neighborhood, city, rooms, notes } =
      await request.json()

    if (!serviceType || !city) {
      return NextResponse.json(
        { error: 'Service type and city are required' },
        { status: 400 },
      )
    }

    const isRestoration =
      serviceType === 'Flood Restoration' || serviceType === 'Water Restoration'

    // 6 rotating post styles for carpet cleaning — picked randomly so posts never sound the same
    const carpetStyles = [
      {
        name: 'before_after',
        instruction: `Write a BEFORE/AFTER storytelling post. Open with a vivid 1-sentence picture of the problem (pet traffic, years of buildup, staining, etc.) then pivot to the result. Make the transformation feel satisfying. Mention the neighborhood naturally.`,
      },
      {
        name: 'the_challenge',
        instruction: `Lead with EMPATHY for the homeowner's situation — kids, pets, high traffic, years of neglect, or a specific struggle. Make the reader feel understood before you mention what we did. Mention the neighborhood naturally.`,
      },
      {
        name: 'educational',
        instruction: `Open with an EDUCATIONAL hook — something most people don't know about carpet cleaning (e.g. why CRB agitation matters, why pH-balanced rinse prevents re-soiling, why hot water extraction beats dry cleaning). Then tie it naturally to this specific job and location. Teach, don't sell.`,
      },
      {
        name: 'local_shoutout',
        instruction: `Write a warm LOCAL COMMUNITY shoutout post. Mention the specific neighborhood prominently and with pride — like you're part of the community, not just passing through. Reference something local or seasonal if possible (Colorado weather, allergen season, school year, etc.).`,
      },
      {
        name: 'the_result',
        instruction: `Focus entirely on THE OUTCOME and how the homeowner felt. Write it almost like a near-testimonial — what the space looks and feels like now. Use sensory language (fluffy, bright, fresh). Mention the neighborhood naturally.`,
      },
      {
        name: 'myth_buster',
        instruction: `Open with a CONTRARIAN or surprising hook — bust a common myth about carpet cleaning (e.g. "waiting until it looks dirty costs you more," "store-bought cleaners make it worse long-term," "not all steam cleaning is the same"). Then connect it to the job. Make people think.`,
      },
    ]

    const selectedStyle = isRestoration
      ? null
      : carpetStyles[Math.floor(Math.random() * carpetStyles.length)]

    const systemPrompt = isRestoration
      ? `You write SEO-optimized social media descriptions for Sasquatch Water Restoration job completion posts.

CRITICAL SEO RULES:
- ALWAYS mention the neighborhood/area in the first sentence (e.g., "Kings Deer", "Briargate", "Monument")
- Use Urgent, Professional, and Reassuring language
- 2-4 sentences max
- End with 🦶 emoji (Sasquatch footprint brand element)

Process details to weave in naturally (Focus on the SCIENCE of drying):
- Daily monitoring: we return EVERY DAY to take moisture readings and adjust equipment.
- Equipment: LGR Dehumidifiers and Commercial Air Movers.
- Efficiency: Structural Drying — saving drywall/floors/cabinets so they don't need replacement.
- Speed: Rapid response to stop secondary damage.
- The Goal: "We dry it faster so you can get your home back sooner."

Style:
- Specialized and Technical (show we are experts, not just cleaners)
- Reassuring but serious about the process
- NO generic "we cleaned it" language. We RESTORED and SAVED it.
- NO hashtags (added separately)`
      : `You write social media posts for Sasquatch Carpet Cleaning job completions. Posts go to Google Business and Facebook.

TODAY'S POST STYLE: ${selectedStyle!.name.toUpperCase().replace('_', ' ')}
${selectedStyle!.instruction}

ALWAYS:
- 2-4 sentences max
- Mention the neighborhood/area naturally (not forced)
- End with 🦶 emoji (Sasquatch footprint brand element)
- Include location name for SEO (${neighborhood ? neighborhood + ', ' : ''}${city})
- NO hashtags (added separately)
- NO pricing
- NO excessive exclamation points

Process details to weave in when relevant:
- Pre-spray to break down grime
- CRB (counter-rotating brush) agitation to lift dirt from fibers
- Hot water extraction
- Acid rinse for soft, residue-free results

If the user provides existing notes, use them as context for the story — don't ignore details they gave you.`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      temperature: 0.85,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: `Service: ${serviceType}
Location: ${neighborhood ? neighborhood + ', ' : ''}${city}
${rooms ? 'Rooms/Areas: ' + rooms : ''}
${notes ? 'Job notes:\n' + notes : 'No additional notes'}`,
        },
      ],
    })

    const description = response.choices[0]?.message?.content?.trim()

    if (!description) {
      throw new Error('No description generated')
    }

    return NextResponse.json({ description })
  } catch (error) {
    console.error('AI description generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate description' },
      { status: 500 },
    )
  }
}
