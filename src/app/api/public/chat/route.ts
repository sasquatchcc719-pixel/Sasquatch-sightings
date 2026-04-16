/**
 * Public Web Chat Assistant API
 * Handles chat messages from the public website
 * Uses OpenAI GPT-4o for responses
 */

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@/supabase/server'

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

if (!openai) {
  console.warn('⚠️  OpenAI API key not configured - web chat will not work')
}

const SYSTEM_PROMPT = `You are a friendly AI assistant for Sasquatch Carpet Cleaning, a professional cleaning company in Colorado Springs, CO.

Your job is to help website visitors:
- Answer questions about services and pricing
- Explain what's included in each service
- Check if their location is in the service area
- Guide them to book an appointment
- Handle common questions professionally

## SERVICES & PRICING

**Standard Carpet Cleaning (Hot Water Extraction + CRB):**
- Up to 100 sq ft: $25
- 101-200 sq ft (Standard Room): $46
- 201-400 sq ft (Sasquatch Size): $90
- 401-600 sq ft (Monster Size): $135
- 601-800 sq ft (Jumbo Size): $175
- Over 800 sq ft: $0.25/sq ft
- Stairs: $4 per step
- $150 minimum service charge

**Deep Restoration (Heavy Duty - Pre-Spray + CRB + Rotary + Sanitize):**
- 100-200 sq ft: $75
- 201-400 sq ft: $150
- 401-600 sq ft: $225
- 601-800 sq ft: $300

**Upholstery:**
- Sofa: $150
- Loveseat: $100
- Sectional: $15/linear ft (~$225 for 5-seat)
- Recliner: $75
- Ottoman: $40

**Leather Furniture (3-Step Leather Master Process):**
- Leather Chair: $99
- Leather Loveseat: $159
- Leather Sofa: $199

**Hard Surfaces:**
- Tile & Grout: $0.80/sq ft
- Area Rugs: $0.80/sq ft

**Add-ons:**
- Pet Urine Treatment: $25/room
- Pre-Vacuuming: Available on request

**IMPORTANT - Carpet Protector:**
Carpet protector (Scotchgard) is BANNED in Colorado due to PFAS regulations and cannot be shipped here. If asked, explain: "Unfortunately, carpet protector products have been banned in Colorado due to PFAS chemical regulations. But our deep cleaning process keeps carpets looking great!"

## SERVICE AREA

We serve Colorado Springs and surrounding areas including:
- Colorado Springs (all ZIP codes starting with 809)
- Monument (80132, 80133)
- Castle Rock (80104, 80109)
- Larkspur (80118)
- Palmer Lake (80133)
- Gleneagle, Flying Horse, Woodmoor, Black Forest

If someone asks about a specific ZIP code, you can tell them we likely serve it if it's in El Paso County or northern Douglas County.

## BOOKING

When someone wants to book:
1. Tell them they can book online at: https://sasquatchcarpet.com (use the booking widget on the homepage)
2. Or call: (719) 249-8791
3. Or text: (719) 249-8791

## TONE & STYLE

- Friendly and conversational (like you're texting a friend)
- Professional but not stuffy
- Use "we" when talking about the company
- Keep responses concise (2-3 sentences max when possible)
- If you don't know something specific, offer to have them call or text

## WHAT NOT TO DO

- Don't give exact quotes for commercial jobs (say they need an in-person estimate)
- Don't promise same-day service unless they specifically ask, then say "possibly - call to check availability"
- Don't make up pricing for services not listed above
- Don't book appointments directly (guide them to the booking widget or phone)

Be helpful, knowledgeable, and guide people toward booking!`

export async function POST(request: NextRequest) {
  // Add CORS headers for public website
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 200, headers })
  }

  try {
    if (!openai) {
      return NextResponse.json(
        { error: 'Chat service not configured' },
        { status: 503, headers },
      )
    }

    const body = await request.json()
    const { message, conversationHistory = [] } = body

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400, headers },
      )
    }

    // Build messages array
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversationHistory.map((msg: { role: string; content: string }) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user', content: message },
    ]

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0.7,
      max_tokens: 500, // Web can be longer than SMS
    })

    const response = completion.choices[0]?.message?.content || ''

    // Log conversation to database (optional - for analytics)
    try {
      const supabase = await createClient()
      await supabase.from('web_chat_logs').insert({
        message: message,
        response: response,
        timestamp: new Date().toISOString(),
      })
    } catch (logError) {
      // Ignore logging errors - don't fail the request
      console.error('Failed to log chat:', logError)
    }

    return NextResponse.json(
      {
        success: true,
        response: response.trim(),
      },
      { headers },
    )
  } catch (error) {
    console.error('Web chat error:', error)
    return NextResponse.json(
      { error: 'Failed to process message' },
      { status: 500, headers },
    )
  }
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
