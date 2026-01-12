/**
 * AI utilities using Anthropic Claude via Vercel AI SDK
 * Per .cursorrules: Using Anthropic Claude 3.5 Sonnet for job description generation
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'

/**
 * Generate a professional job description from field notes
 * Uses Claude 3.5 Sonnet via Vercel AI SDK
 * @param voiceNote - Raw field notes from technician
 * @param serviceName - Type of service performed
 * @param city - City where job was performed
 * @param neighborhood - Neighborhood (optional)
 */
export async function generateJobDescription(
  voiceNote: string,
  serviceName: string,
  city: string,
  neighborhood: string | null
): Promise<string> {
  console.log('🧠 [AI] Starting AI generation...')
  
  try {
    const locationString = neighborhood
      ? `${neighborhood}, ${city}`
      : city

    const prompt = `You are writing a professional technician log for a carpet cleaning company website. Convert this field note into a 150-word description emphasizing the specific cleaning challenge and treatment used. Tone: Professional case study. Location: ${locationString}. Service: ${serviceName}. Field note: ${voiceNote}`

    console.log('📝 [AI] Prompt prepared:', {
      location: locationString,
      service: serviceName,
      voiceNoteLength: voiceNote.length,
    })

    console.log('🔑 [AI] Checking API key...')
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error('❌ [AI] ANTHROPIC_API_KEY not found in environment')
      throw new Error('ANTHROPIC_API_KEY not configured')
    }
    console.log('✅ [AI] API key found:', apiKey.substring(0, 20) + '...')

    console.log('🤖 [AI] Creating Anthropic client...')
    // Create Anthropic instance with API key
    const anthropic = createAnthropic({
      apiKey: apiKey,
    })

    console.log('🤖 [AI] Calling Anthropic API...')
    // Generate text using Vercel AI SDK with Anthropic
    const { text } = await generateText({
      model: anthropic('claude-3-5-sonnet-20241022'),
      prompt,
      temperature: 0.7,
    })

    console.log('✅ [AI] AI generation successful!')
    console.log('📊 [AI] Generated text length:', text.length)

    return text
  } catch (error) {
    console.error('❌ [AI] Error generating job description:', error)
    console.error('❌ [AI] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : 'No stack trace',
    })
    throw new Error('Failed to generate description')
  }
}
