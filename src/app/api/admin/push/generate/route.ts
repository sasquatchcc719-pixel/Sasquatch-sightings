/**
 * Generate push notification title and body from a ramble (like jobs description).
 * POST /api/admin/push/generate
 */

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { getUserWithRole } from '@/lib/auth'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(request: NextRequest) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || (role !== 'admin' && role !== 'owner')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { ramble } = await request.json()
    if (typeof ramble !== 'string') {
      return NextResponse.json(
        { error: 'ramble string is required' },
        { status: 400 },
      )
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 150,
      temperature: 0.6,
      messages: [
        {
          role: 'system',
          content: `You write short push notification copy for Sasquatch Carpet Cleaning (Colorado Springs area).

Rules:
- Output a SHORT title (headline) and a SHORT body (1-2 sentences). Keep total length suitable for a push notification.
- Preserve the user's intent and key details; polish tone and clarity.
- Optional: include a gentle CTA (e.g. book, use code) if it fits.
- Friendly, professional. No excessive punctuation or hashtags.
- Respond with exactly two lines: first line "TITLE: " then the title text; second line "BODY: " then the body text.`,
        },
        {
          role: 'user',
          content:
            ramble.trim() ||
            'Remind people about $20 off carpet cleaning and to book at sasquatchcarpet.com.',
        },
      ],
    })

    const raw = response.choices[0]?.message?.content?.trim()
    if (!raw) {
      return NextResponse.json(
        { error: 'No content generated' },
        { status: 500 },
      )
    }

    let title = ''
    let body = ''
    const titleMatch = raw.match(/TITLE:\s*([\s\S]+?)(?=\n|BODY:|$)/i)
    const bodyMatch = raw.match(/BODY:\s*([\s\S]+?)$/i)
    if (titleMatch) title = titleMatch[1].trim()
    if (bodyMatch) body = bodyMatch[1].trim()
    if (!title)
      title = raw.split('\n')[0]?.trim() || 'Sasquatch Carpet Cleaning'
    if (!body)
      body =
        raw.replace(/TITLE:.*/i, '').trim() ||
        'Book at sasquatchcarpet.com for $20 off.'

    return NextResponse.json({ title, body })
  } catch (error) {
    console.error('[Push generate] Error:', error)
    return NextResponse.json(
      { error: 'Failed to generate push copy' },
      { status: 500 },
    )
  }
}
