/**
 * AI Job Description Generator API
 * Writes the public job-page description (a permanent SEO page, NOT a social
 * post — social copy has its own pipeline). Facts-only: the copy is grounded
 * in the invoice line items and never invents customers, backstories, or
 * circumstances. July 2026 rewrite — the previous prompt asked the model to
 * imagine homeowner situations, which produced 131 near-identical AI-slop
 * pages that Google refused to index.
 */

import OpenAI from 'openai'
import { NextRequest, NextResponse } from 'next/server'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/** Derive the angle from what was actually on the invoice, so structure
 *  varies with the work instead of a random style wheel. */
function pickAngle(notes: string): string {
  const n = notes.toLowerCase()
  if (n.includes('urine'))
    return 'Lead with the odor/urine treatment work and how the treatment process differs from regular cleaning.'
  if (n.includes('step') || n.includes('stair'))
    return 'Lead with the stairs — they take the most wear per square foot in a home and show it first.'
  if (n.includes('rug'))
    return 'Lead with the area rug(s) and what proper rug cleaning involves versus wall-to-wall carpet.'
  if (n.includes('furniture') || n.includes('upholstery'))
    return 'Lead with the upholstery work and how fabric cleaning differs from carpet.'
  if (n.includes('sasquatch size') || n.includes('jumbo'))
    return 'Lead with the size of the job — large rooms and what covering that square footage properly takes.'
  return 'Lead with the scope of the job — what areas were cleaned, plainly stated.'
}

export async function POST(request: NextRequest) {
  try {
    const { serviceType, neighborhood, city, rooms, notes, month, hours } =
      await request.json()

    if (!serviceType || !city) {
      return NextResponse.json(
        { error: 'Service type and city are required' },
        { status: 400 },
      )
    }

    const isRestoration =
      serviceType === 'Flood Restoration' || serviceType === 'Water Restoration'

    const location = neighborhood ? `${neighborhood}, ${city}` : city
    const factLines = [
      `Service: ${serviceType}`,
      `City: ${location}`,
      rooms ? `Rooms/Areas: ${rooms}` : null,
      notes ? `Invoice line items (what was actually done): ${notes}` : null,
      month ? `Month of job: ${month}` : null,
      hours ? `Hours on site: ${hours}` : null,
    ].filter(Boolean)

    const systemPrompt = isRestoration
      ? `You write the description for a completed water-restoration job page on Sasquatch Carpet Cleaning's website. It is a permanent SEO page about one real job.

USE ONLY THE FACTS PROVIDED. Never invent the cause of the water damage, the customer, or their circumstances. Describe the work, not a story.

Real process facts you may draw on: daily moisture readings, LGR dehumidifiers, commercial air movers, structural drying that saves drywall/floors/cabinets from replacement.

- 60-100 words, 1 paragraph
- Mention ${location} once, naturally
- Plain confident prose. No hype, no emoji, no hashtags, no pricing
- Never open with a question`
      : `You write the description for a completed job page on Sasquatch Carpet Cleaning's website. It is a permanent SEO page about one real job in ${location}.

HARD RULES — every violation makes the page worse for SEO:
- USE ONLY THE FACTS PROVIDED (line items, quantities, city, month, hours). NEVER invent the customer, their pets or kids, how a stain happened, what the homeowner felt, or how long dirt "built up". No fictional narrative of any kind.
- BANNED: opening with a question; "Did you know"; "cozy"; "we had the pleasure"; "transformation"; "magic"; "refresh/refreshed"; "nestled"; "vibrant"; "not only... but also"; "look no further"; "whether you"; exclamation points; emoji; hashtags; pricing.
- 60-100 words, 1 paragraph. Shorter is better than padded.
- Mention ${location} once or twice, naturally — never forced.
- State quantities from the line items exactly (e.g. "five rooms, twelve stairs, two hallways").
- ${pickAngle(String(notes ?? rooms ?? ''))}
- You may include real process detail where it fits: pre-spray, CRB (counter-rotating brush) agitation, hot water extraction, acid-side rinse that leaves no detergent residue. One or two process facts, not the whole list every time.
- Month may be used for season context ("late June") — never invent weather.
- Round hours conversationally ("about two hours", "a half-day job") — never decimals.
- Never open with the company name, the date, or "In [month]". Open with the work itself.
- Write like a competent tradesperson summarizing the day's work: concrete, specific, zero marketing voice. No closing summary sentence — end when the facts end.`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 220,
      temperature: 0.6,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: factLines.join('\n') },
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
