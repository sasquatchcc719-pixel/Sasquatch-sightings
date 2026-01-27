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
      temperature: 0.8, // More creative variation
      messages: [
        {
          role: 'system',
          content: `You write short social media descriptions for Sasquatch Carpet Cleaning job completion posts.

Style guidelines:
- 2-4 sentences max
- Friendly, professional tone
- Mention the neighborhood/area naturally
- End with a subtle call to action or tagline
- Use 🦶 emoji at the end (Sasquatch footprint brand element)

Process details to incorporate when relevant:
- Pre-spray to break down grime
- CRB (counter-rotating brush) agitation to lift dirt from fibers
- Hot water extraction
- Acid rinse for pH neutral outcome (soft, residue-free results)

Do NOT:
- Use excessive exclamation points
- Sound salesy or pushy
- Use hashtags (those are added separately)
- Mention pricing or discounts`,
        },
        {
          role: 'user',
          content: `Service: ${serviceType}
Location: ${neighborhood ? neighborhood + ', ' : ''}${city}
${rooms ? 'Rooms/Areas: ' + rooms : ''}
${notes ? 'Notes: ' + notes : ''}`,
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
