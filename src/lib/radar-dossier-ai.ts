/**
 * AI-generated competitor dossier from deep-dive context.
 * Uses Anthropic Claude via Vercel AI SDK (same pattern as ai.ts).
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'

export type DossierProfile = {
  threat_level: string | null
  business_model: string | null
  primary_strength: string | null
  core_weakness: string | null
  sasquatch_counter_attack: string | null
  threat_archetype: string | null
}

const THREAT_LEVELS = ['High', 'Medium', 'Low', 'Paper Tiger']
const ARCHETYPES = [
  'Franchise Cartel',
  'Legacy Heavyweight',
  'Jack of All Trades',
  'Niche Sniper',
]

function extractJson(text: string): string {
  const trimmed = text.trim()
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) return codeBlock[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start)
    return trimmed.slice(start, end + 1)
  return trimmed
}

/**
 * Generate a competitor dossier from gathered context. Returns structured profile for DB insert.
 */
export async function generateDossierFromContext(
  domain: string,
  displayName: string | null,
  combinedContext: string,
): Promise<DossierProfile> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  const name = displayName || domain
  const prompt = `You are a competitive intelligence analyst for Sasquatch Carpet Cleaning (Colorado Springs area). We have gathered the following information about a competitor. Based ONLY on this research, output a JSON object with these exact keys (use null for any you cannot infer):

- threat_level: one of "High", "Medium", "Low", "Paper Tiger" (or null)
- business_model: e.g. "National Franchise", "Local Legacy", "Eco-Sniper", "Jack of All Trades" (or null)
- primary_strength: 1-2 sentences on their main strength (reviews, brand, pricing, etc.)
- core_weakness: 1-2 sentences on their main weakness (methods, staffing, positioning, etc.)
- sasquatch_counter_attack: 1-2 sentences on how Sasquatch should pitch against them (our differentiators: owner on site, Rotovac/CRB extraction, commercial-grade, local focus)
- threat_archetype: one of "Franchise Cartel", "Legacy Heavyweight", "Jack of All Trades", "Niche Sniper" (or null)

Competitor: ${name} (${domain})

--- Gathered research ---
${combinedContext.slice(0, 28000)}
--- End research ---

Respond with ONLY a valid JSON object, no other text.`

  const anthropic = createAnthropic({ apiKey })
  const { text } = await generateText({
    model: anthropic('claude-3-5-sonnet-20241022'),
    prompt,
    temperature: 0.3,
  })

  const jsonStr = extractJson(text)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>
  } catch {
    throw new Error(
      `Dossier AI did not return valid JSON: ${text.slice(0, 200)}`,
    )
  }

  const threat_level =
    typeof parsed.threat_level === 'string' &&
    THREAT_LEVELS.includes(parsed.threat_level)
      ? parsed.threat_level
      : typeof parsed.threat_level === 'string'
        ? parsed.threat_level
        : null
  const business_model =
    typeof parsed.business_model === 'string' ? parsed.business_model : null
  const primary_strength =
    typeof parsed.primary_strength === 'string' ? parsed.primary_strength : null
  const core_weakness =
    typeof parsed.core_weakness === 'string' ? parsed.core_weakness : null
  const sasquatch_counter_attack =
    typeof parsed.sasquatch_counter_attack === 'string'
      ? parsed.sasquatch_counter_attack
      : null
  const threat_archetype =
    typeof parsed.threat_archetype === 'string' &&
    ARCHETYPES.includes(parsed.threat_archetype)
      ? parsed.threat_archetype
      : typeof parsed.threat_archetype === 'string'
        ? parsed.threat_archetype
        : null

  return {
    threat_level,
    business_model,
    primary_strength,
    core_weakness,
    sasquatch_counter_attack,
    threat_archetype,
  }
}
