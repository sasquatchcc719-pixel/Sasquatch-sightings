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
    const { serviceType, neighborhood, city, rooms, notes } = await request.json()

    if (!serviceType || !city) {
      return NextResponse.json(
        { error: 'Service type and city are required' },
        { status: 400 }
      )
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      temperature: 0.7, // Balanced creativity
      messages: [
        {
          role: 'system',
          content: `You write SEO-optimized social media descriptions for Sasquatch Carpet Cleaning job completion posts.

CRITICAL SEO RULES:
- ALWAYS mention the neighborhood/area in the first sentence (e.g., "Kings Deer", "Briargate", "Monument")
- Use natural, conversational language that includes location keywords
- 2-4 sentences max
- End with 🦶 emoji (Sasquatch footprint brand element)

If the user provides existing text in Notes:
- Use it as a foundation and enhance it
- Keep their key details and voice
- Add missing process details or polish as needed
- Don't completely rewrite unless it's too short

Process details to weave in naturally:
- Pre-spray to break down grime
- CRB (counter-rotating brush) agitation to lift dirt from fibers
- Hot water extraction
- Acid rinse for pH neutral outcome (soft, residue-free results)

Style:
- Friendly, professional tone
- Subtle call to action or tagline
- NO excessive exclamation points
- NO sales language or pricing
- NO hashtags (added separately)`,
        },
        {
          role: 'user',
          content: `Service: ${serviceType}
Location: ${neighborhood ? neighborhood + ', ' : ''}${city}
${rooms ? 'Rooms/Areas: ' + rooms : ''}
${notes ? 'User\'s existing text to enhance:\n' + notes : 'No existing text - create from scratch'}`,
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
      { status: 500 }
    )
  }
}
