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
  neighborhood: string | null,
): Promise<string> {
  console.log('🧠 [AI] Starting AI generation...')

  try {
    const locationString = neighborhood ? `${neighborhood}, ${city}` : city

    // Rotate through 6 description styles so published job pages don't all sound the same
    const descriptionStyles = [
      `Professional case study tone. Open with the specific cleaning challenge, describe the treatment approach, and close with the result. Emphasize the technical process (pre-spray, CRB agitation, hot water extraction, acid rinse). 120-150 words.`,
      `Storytelling tone. Paint a picture of what the space looked like before, what the homeowner was dealing with, and how it looked after. Make the transformation feel real. 120-150 words.`,
      `Empathy-first tone. Start from the homeowner's perspective — what they were struggling with and why it mattered to them. Then explain how we solved it technically. 120-150 words.`,
      `Educational tone. Use this job as an example to teach the reader something useful about carpet care — why the specific technique matters, what causes this type of problem, or what most people don't know. 120-150 words.`,
      `Local community tone. Ground the post in the specific neighborhood and make it feel like a neighbor helping a neighbor. Reference the area naturally and write with warmth. 120-150 words.`,
      `Results-focused tone. Lead with the outcome — what the space looks, feels, and smells like now. Use sensory language. Then briefly explain the process that got it there. 120-150 words.`,
    ]

    const style =
      descriptionStyles[Math.floor(Math.random() * descriptionStyles.length)]

    const prompt = `You are writing a job completion description for Sasquatch Carpet Cleaning's website. Each published job is a real SEO page — write with enough local and technical detail to be genuinely useful and indexable.

Location: ${locationString}
Service: ${serviceName}
Field notes from technician: ${voiceNote}

Style for this post: ${style}

Rules:
- Always mention the location (${locationString}) naturally
- Include specific technical details from the field notes
- No pricing, no hashtags, no excessive exclamation points
- Write as if a knowledgeable human wrote it, not a template`

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
