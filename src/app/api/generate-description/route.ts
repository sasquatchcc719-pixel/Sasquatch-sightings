/**
 * AI Description Generator API Route
 * Uses Anthropic Claude via Vercel AI SDK
 * Per .cursorrules: Using Anthropic Claude 3.5 Sonnet
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'

export async function POST(request: NextRequest) {
  try {
    // Check authentication (admin only)
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY not configured')
      return NextResponse.json(
        { error: 'AI service not configured. Add ANTHROPIC_API_KEY to Vercel.' },
        { status: 500 }
      )
    }

    // Parse request body
    const { serviceType, city, notes } = await request.json()

    // Validate required fields
    if (!serviceType || !city) {
      return NextResponse.json(
        { error: 'Service type and city are required' },
        { status: 400 }
      )
    }

    // Build prompt
    const prompt = `Write a short, professional job description for a carpet cleaning company.
Service: ${serviceType}
Location: ${city}, Colorado
${notes ? `Additional notes: ${notes}` : ''}

Keep it 2-3 sentences. Mention the location. Sound professional but friendly. Include relevant keywords for local SEO. No hashtags. No emojis.`

    console.log('🤖 Calling Claude API with prompt:', prompt.substring(0, 100) + '...')

    // Create Anthropic client
    const anthropic = createAnthropic({ apiKey })

    // Generate description using Claude
    const { text } = await generateText({
      model: anthropic('claude-3-5-sonnet-20241022'),
      prompt,
      temperature: 0.7,
    })

    const description = text.trim()

    // Log for debugging
    console.log('✅ Generated description:', description.substring(0, 100) + '...')

    return NextResponse.json({
      success: true,
      description,
    })
  } catch (error) {
    console.error('❌ Claude API error:', error)
    
    // Log full error details for debugging
    if (error instanceof Error) {
      console.error('Error name:', error.name)
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
    }
    
    return NextResponse.json(
      { error: 'Failed to generate description. Check Vercel logs for details.' },
      { status: 500 }
    )
  }
}
