/**
 * AI Description Generator API Route
 * Uses Google Gemini to generate professional job descriptions
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

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
    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not configured')
      return NextResponse.json(
        { error: 'AI service not configured' },
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

    // Initialize Gemini with Google Cloud key
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    // Use gemini-1.5-pro model (available with Google Cloud billing)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' })

    // Build prompt
    const prompt = `Write a short, professional job description for a carpet cleaning company.
Service: ${serviceType}
Location: ${city}, Colorado
${notes ? `Additional notes: ${notes}` : ''}

Keep it 2-3 sentences. Mention the location. Sound professional but friendly. Include relevant keywords for local SEO. No hashtags. No emojis.`

    // Generate description
    console.log('🤖 Calling Gemini API with prompt:', prompt.substring(0, 100) + '...')
    const result = await model.generateContent(prompt)
    const response = await result.response
    const description = response.text().trim()

    // Log for debugging
    console.log('✅ Generated description:', description.substring(0, 100) + '...')

    return NextResponse.json({
      success: true,
      description,
    })
  } catch (error) {
    console.error('❌ Gemini API error:', error)
    
    if (error instanceof Error) {
      console.error('Error message:', error.message)
    }
    
    return NextResponse.json(
      { error: 'Failed to generate description. Check Vercel logs.' },
      { status: 500 }
    )
  }
}
