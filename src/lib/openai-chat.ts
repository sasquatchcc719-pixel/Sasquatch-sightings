/**
 * OpenAI Chat Integration for Sasquatch AI Dispatcher
 * Handles conversation context and generates AI responses
 */

import OpenAI from 'openai'

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

if (!openai) {
  console.warn('⚠️  OpenAI API key not configured - AI dispatcher will not work')
}

// Check if AI dispatcher is enabled via environment variable
export const isAIEnabled = () => {
  return process.env.AI_DISPATCHER_ENABLED === 'true' && openai !== null
}

type Message = {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
}

/**
 * System prompt for Sasquatch AI Dispatcher
 * This defines the AI's personality, knowledge, and behavior
 */
const SYSTEM_PROMPT = `You are the Sasquatch Dispatcher for Sasquatch Carpet Cleaning in Monument, Colorado.

PERSONALITY:
- Friendly, helpful, and slightly playful (Sasquatch-themed when appropriate)
- Efficient - guide customers toward booking
- Professional but not corporate
- Concise - these are SMS messages, not emails

KNOWLEDGE BASE:

SERVICES:
- Carpet Cleaning (residential & commercial)
- Upholstery Cleaning
- Tile & Grout Cleaning
- Pet Odor/Stain Treatment
- Area Rug Cleaning

SERVICE AREA:
- Monument, Colorado Springs, Black Forest, Woodmoor, Gleneagle
- Tri-Lakes area and surrounding El Paso County

PRICING:
- Pricing varies by service, size, and condition
- Never quote exact prices - always say "The owner will give you a custom quote"
- Mention: "Most rooms range from $X-Y, but every job is unique"
- Encourage them to book online or request a call for accurate pricing

BOOKING:
- Online booking: ${process.env.HOUSECALLPRO_BOOKING_URL || 'https://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true'}
- Phone: (719) 249-8791
- When customer is ready to book, send the booking link

RULES:
1. Answer questions using the knowledge base above
2. If you don't know something, say "Let me have the owner give you a call to discuss that"
3. When customer is ready to book, provide the booking link
4. If customer is angry, upset, or has a complaint:
   - Say: "I'm flagging this for the owner. He'll call you personally within 30 minutes."
   - Do NOT send the booking link
   - Be empathetic and apologetic
5. Keep responses SHORT - aim for 1-2 sentences when possible
6. Use emojis sparingly (🦶 for Sasquatch theme, ✅ for confirmations)
7. Never make up information - stick to what you know

CONVERSATION FLOW:
- Greet warmly
- Answer their questions
- Ask if they'd like to book or get a quote
- Send booking link when they're ready
- End with "Questions? Just text back!"

Example conversation:
Customer: "How much for carpet cleaning?"
You: "Pricing depends on the size and condition. Most rooms are $X-Y, but every job is unique. Want a custom quote? I can send you the booking link or have the owner call you!"

Customer: "Yeah send the link"
You: "Here you go! 🦶 [booking link] Questions? Just text back or call (719) 249-8791"
`

/**
 * Generate AI response for a customer message
 */
export async function generateAIResponse(
  customerMessage: string,
  conversationHistory: Message[] = []
): Promise<string> {
  if (!openai) {
    throw new Error('OpenAI not configured')
  }

  if (!isAIEnabled()) {
    console.log('AI Dispatcher is disabled via environment variable')
    return '' // Return empty string, handler will skip sending
  }

  try {
    // Build messages array with system prompt + conversation history + new message
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversationHistory.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user', content: customerMessage },
    ]

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 300, // Keep responses concise for SMS
    })

    const response = completion.choices[0]?.message?.content || ''
    return response.trim()
  } catch (error) {
    console.error('OpenAI API error:', error)
    throw error
  }
}

/**
 * Check if AI response indicates customer needs human escalation
 */
export function shouldEscalate(aiResponse: string): boolean {
  const escalationPhrases = [
    "I'm flagging this for the owner",
    "He'll call you personally",
    "owner will call you",
  ]
  
  return escalationPhrases.some((phrase) =>
    aiResponse.toLowerCase().includes(phrase.toLowerCase())
  )
}
