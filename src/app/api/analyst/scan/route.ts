import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { searchGoogle, readWebpage, researchCompetitor } from '@/lib/web-search'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Run a full competitor scan
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { competitorName, deepScan = false } = body

    const supabase = createAdminClient()

    // If specific competitor, research just them
    if (competitorName) {
      return await scanSingleCompetitor(supabase, competitorName, deepScan)
    }

    // Otherwise, scan all competitors
    const { data: competitors, error } = await supabase
      .from('competitors')
      .select('*')
      .order('name')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!competitors || competitors.length === 0) {
      return NextResponse.json(
        {
          error: 'No competitors configured. Add some first.',
          hint: 'Run the add_competitors_table.sql migration',
        },
        { status: 400 },
      )
    }

    const results = []

    for (const competitor of competitors) {
      try {
        const research = await researchCompetitor(
          competitor.name,
          competitor.website,
        )

        // Have Claude analyze the findings
        const analysis = await analyzeCompetitor(competitor.name, research)

        // Update competitor record
        await supabase
          .from('competitors')
          .update({
            google_rating: analysis.googleRating,
            google_review_count: analysis.googleReviewCount,
            pricing_notes: analysis.pricingNotes,
            strengths: analysis.strengths,
            weaknesses: analysis.weaknesses,
            recent_promos: analysis.promos,
            last_researched: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', competitor.id)

        // Save to market_intel
        if (analysis.keyFindings) {
          await supabase.from('market_intel').insert({
            source: 'competitor_scan',
            competitor: competitor.name,
            content: analysis.keyFindings,
            sentiment: analysis.sentiment,
          })
        }

        results.push({
          competitor: competitor.name,
          success: true,
          analysis,
        })
      } catch (err) {
        console.error(`Failed to scan ${competitor.name}:`, err)
        results.push({
          competitor: competitor.name,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    return NextResponse.json({
      message: `Scanned ${results.filter((r) => r.success).length}/${competitors.length} competitors`,
      results,
    })
  } catch (error) {
    console.error('Scan error:', error)
    return NextResponse.json({ error: 'Scan failed' }, { status: 500 })
  }
}

async function scanSingleCompetitor(
  supabase: ReturnType<typeof createAdminClient>,
  name: string,
  deepScan: boolean,
) {
  // Get competitor record
  const { data: competitor } = await supabase
    .from('competitors')
    .select('*')
    .eq('name', name)
    .single()

  const research = await researchCompetitor(name, competitor?.website)
  const analysis = await analyzeCompetitor(name, research)

  // Update or insert competitor
  if (competitor) {
    await supabase
      .from('competitors')
      .update({
        google_rating: analysis.googleRating,
        google_review_count: analysis.googleReviewCount,
        pricing_notes: analysis.pricingNotes,
        strengths: analysis.strengths,
        weaknesses: analysis.weaknesses,
        recent_promos: analysis.promos,
        last_researched: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', competitor.id)
  }

  // Save intel
  await supabase.from('market_intel').insert({
    source: 'competitor_scan',
    competitor: name,
    content: analysis.keyFindings,
    sentiment: analysis.sentiment,
  })

  return NextResponse.json({
    competitor: name,
    analysis,
    research: deepScan ? research : undefined,
  })
}

async function analyzeCompetitor(
  name: string,
  research: Awaited<ReturnType<typeof researchCompetitor>>,
): Promise<CompetitorAnalysis> {
  const prompt = `Analyze this competitor research for ${name} (carpet cleaning company in Colorado).

SEARCH RESULTS (Reviews):
${research.reviews.map((r) => `- ${r.title}: ${r.snippet} (${r.source}${r.extra?.rating ? `, Rating: ${r.extra.rating}` : ''})`).join('\n')}

SEARCH RESULTS (Pricing):
${research.pricing.map((r) => `- ${r.title}: ${r.snippet}`).join('\n')}

${research.websiteContent ? `WEBSITE CONTENT:\n${research.websiteContent.substring(0, 3000)}` : ''}

Extract and return a JSON object with:
{
  "googleRating": number or null,
  "googleReviewCount": number or null,
  "pricingNotes": "What they charge, any specials",
  "strengths": "What they're good at based on reviews",
  "weaknesses": "Customer complaints, problems",
  "promos": "Current promotions or specials",
  "keyFindings": "2-3 sentence summary of most important findings",
  "sentiment": "positive" | "negative" | "neutral" - overall market position
}

Return ONLY the JSON object, no other text.`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const text =
    response.content[0].type === 'text' ? response.content[0].text : '{}'

  try {
    return JSON.parse(text)
  } catch {
    return {
      googleRating: null,
      googleReviewCount: null,
      pricingNotes: 'Unable to parse',
      strengths: '',
      weaknesses: '',
      promos: '',
      keyFindings: text,
      sentiment: 'neutral',
    }
  }
}

interface CompetitorAnalysis {
  googleRating: number | null
  googleReviewCount: number | null
  pricingNotes: string
  strengths: string
  weaknesses: string
  promos: string
  keyFindings: string
  sentiment: 'positive' | 'negative' | 'neutral'
}

// GET - Check scan status or get last scan results
export async function GET() {
  const supabase = createAdminClient()

  const { data: competitors } = await supabase
    .from('competitors')
    .select('name, google_rating, last_researched')
    .order('name')

  const { data: recentIntel } = await supabase
    .from('market_intel')
    .select('*')
    .eq('source', 'competitor_scan')
    .order('captured_at', { ascending: false })
    .limit(10)

  return NextResponse.json({
    competitors,
    recentIntel,
  })
}
