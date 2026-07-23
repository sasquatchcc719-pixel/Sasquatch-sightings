/**
 * Foreman spec scraper: given a chemical product name/brand, search the web
 * for the manufacturer label + SDS and extract structured usage specs.
 *
 * Output is a DRAFT — it lands on the product row as scrape_status 'scraped'
 * and is not trusted by the field assistant until Charles reviews and
 * approves it ('reviewed'). Dilution chemistry is safety-relevant; never
 * skip the human review step.
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import { searchGoogle, readWebpage } from '@/lib/web-search'
import { CHEMICAL_SCENARIOS, type ScrapedSpecs } from './types'

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MAX_PAGES = 3
const PAGE_CHAR_LIMIT = 8000

const EXTRACTION_PROMPT = `You are extracting product data for a professional carpet cleaning chemical from manufacturer pages and SDS sheets.

Return ONLY a JSON object (no markdown fences, no commentary) with exactly these keys:
{
  "ph_range": string | null,              // e.g. "9.5-10.5 (concentrate)"
  "dilution_hydroforce": string | null,   // in-line injection / Hydro-Force metering tip ratio, e.g. "1:8 metering tip"
  "dilution_pump_sprayer": string | null, // pump-up sprayer mix, e.g. "2 oz per gallon"
  "label_instructions": string | null,    // condensed directions for use, max ~120 words
  "sds_warnings": string | null,          // key hazards/PPE from the SDS, max ~80 words
  "scenarios": string[],                  // subset of: ${CHEMICAL_SCENARIOS.join(', ')}
  "incompatible_with": string[]           // e.g. ["chlorine bleach", "acids"]
}

Rules:
- Only state dilutions and pH actually found in the provided pages. If a value is not in the text, use null. NEVER guess numbers.
- If pages give dilution only one way (e.g. oz/gal), leave the other format null.
- scenarios: pick every listed value that the product is explicitly marketed or directed for.
- incompatible_with: from SDS "incompatible materials" or label warnings; empty array if none found.`

export async function scrapeProductSpecs(
  name: string,
  brand: string | null,
): Promise<ScrapedSpecs> {
  const label = [brand, name].filter(Boolean).join(' ')

  const [labelResults, sdsResults] = await Promise.all([
    searchGoogle(`${label} carpet cleaning dilution directions for use`, 4),
    searchGoogle(`${label} SDS safety data sheet`, 3),
  ])

  // Prefer manufacturer/SDS-looking URLs, dedupe, cap at MAX_PAGES.
  const candidates = [...labelResults, ...sdsResults]
    .map((r) => r.url)
    .filter(Boolean)
  const urls = [...new Set(candidates)].slice(0, MAX_PAGES)
  if (urls.length === 0) {
    throw new Error(`No web results found for "${label}"`)
  }

  const pages = await Promise.all(
    urls.map(async (url) => {
      try {
        const content = await readWebpage(url)
        return { url, content: content.slice(0, PAGE_CHAR_LIMIT) }
      } catch {
        return null
      }
    }),
  )
  const readable = pages.filter(
    (p): p is { url: string; content: string } =>
      Boolean(p) && Boolean(p?.content?.trim()),
  )
  if (readable.length === 0) {
    throw new Error(`Found pages for "${label}" but none were readable`)
  }

  const sources = readable
    .map((p, i) => `--- SOURCE ${i + 1}: ${p.url} ---\n${p.content}`)
    .join('\n\n')

  const { text } = await generateText({
    model: anthropic('claude-3-5-sonnet-20241022'),
    system: EXTRACTION_PROMPT,
    prompt: `Product: ${label}\n\n${sources}`,
    maxOutputTokens: 1000,
  })

  const parsed = parseSpecsJson(text)
  return { ...parsed, source_urls: readable.map((p) => p.url) }
}

function parseSpecsJson(raw: string): Omit<ScrapedSpecs, 'source_urls'> {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) {
    throw new Error('Spec extraction returned no JSON')
  }
  const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<
    string,
    unknown
  >

  const str = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null
  const strArray = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      : []

  return {
    ph_range: str(obj.ph_range),
    dilution_hydroforce: str(obj.dilution_hydroforce),
    dilution_pump_sprayer: str(obj.dilution_pump_sprayer),
    label_instructions: str(obj.label_instructions),
    sds_warnings: str(obj.sds_warnings),
    scenarios: strArray(obj.scenarios).filter((s) =>
      (CHEMICAL_SCENARIOS as readonly string[]).includes(s),
    ),
    incompatible_with: strArray(obj.incompatible_with),
  }
}
