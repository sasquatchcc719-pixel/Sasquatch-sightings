/**
 * AI Description Generator API Route
 * Uses Google Gemini REST API directly
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'

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
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
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

    // Build prompt
    const prompt = `Write a short, professional job description for a carpet cleaning company.
Service: ${serviceType}
Location: ${city}, Colorado
${notes ? `Additional notes: ${notes}` : ''}

Keep it 2-3 sentences. Mention the location. Sound professional but friendly. Include relevant keywords for local SEO. No hashtags. No emojis.`

    console.log('🤖 Calling Gemini REST API...')

    // Try multiple model names
    const models = [
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-pro',
    ]

    let description = null
    let lastError = null

    for (const modelName of models) {
      try {
        console.log(`Trying model: ${modelName}...`)
        
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: prompt
                }]
              }]
            })
          }
        )

        if (response.ok) {
          const data = await response.json()
          description = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
          if (description) {
            console.log(`✅ Success with model: ${modelName}`)
            break
          }
        } else {
          const errorData = await response.text()
          console.log(`❌ Model ${modelName} failed:`, response.status, errorData.substring(0, 200))
          lastError = errorData
        }
      } catch (err) {
        console.log(`❌ Model ${modelName} error:`, err)
        lastError = err
      }
    }

    if (!description) {
      console.error('All models failed. Last error:', lastError)
      return NextResponse.json(
        { error: 'Failed to generate description. No available models.' },
        { status: 500 }
      )
    }

    console.log('✅ Generated description:', description.substring(0, 100) + '...')

    return NextResponse.json({
      success: true,
      description,
    })
  } catch (error) {
    console.error('❌ API error:', error)
    return NextResponse.json(
      { error: 'Failed to generate description.' },
      { status: 500 }
    )
  }
}
