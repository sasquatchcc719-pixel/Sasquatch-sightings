import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Get database schema dynamically
async function getSchema(supabase: ReturnType<typeof createAdminClient>) {
  const { data, error } = await supabase.rpc('get_table_info')

  if (error) {
    // Fallback: manually list known tables
    return `
Known Tables:
- jobs (id, slug, city, status, published_at, gps_fuzzy_lat, gps_fuzzy_lng, service_id, image_url, etc.)
- sightings (id, image_url, gps_lat, gps_lng, created_at, full_name, phone_number, email, etc.)
- leads (id, name, phone, email, source, status, created_at, etc.)
- nfc_taps (id, card_id, tapped_at, location, converted, etc.)
- partners (id, name, email, credit_balance, backlink_verified, etc.)
- location_partners (id, business_name, city, station_health, taps_count, etc.)
- market_intel_targets (id, type, value, source, url, is_active, notes)
- market_intel (id, target_id, source, competitor, content, sentiment, captured_at)
- revenue_entries (id, amount, date, source, notes)
`
  }

  return data
}

// Get recent market intel
async function getRecentIntel(supabase: ReturnType<typeof createAdminClient>) {
  const { data, error } = await supabase
    .from('market_intel')
    .select('*, target:market_intel_targets(value, type)')
    .order('captured_at', { ascending: false })
    .limit(20)

  if (error) {
    return 'No market intel available yet.'
  }

  if (!data || data.length === 0) {
    return 'No market intel has been gathered yet. Set up targets to start collecting data.'
  }

  return data
    .map(
      (intel) =>
        `[${intel.captured_at}] ${intel.source}: ${intel.content}${intel.competitor ? ` (re: ${intel.competitor})` : ''}`,
    )
    .join('\n')
}

// Get business summary stats
async function getBusinessStats(
  supabase: ReturnType<typeof createAdminClient>,
) {
  const now = new Date()
  const startOfMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
  ).toISOString()
  const startOfLastMonth = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1,
  ).toISOString()
  const endOfLastMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    0,
  ).toISOString()

  // Jobs this month
  const { count: jobsThisMonth } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .gte('published_at', startOfMonth)

  // Jobs last month
  const { count: jobsLastMonth } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .gte('published_at', startOfLastMonth)
    .lt('published_at', startOfMonth)

  // Sightings this month
  const { count: sightingsThisMonth } = await supabase
    .from('sightings')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfMonth)

  // NFC taps this month (if table exists)
  let tapsThisMonth = 0
  try {
    const { count } = await supabase
      .from('nfc_taps')
      .select('*', { count: 'exact', head: true })
      .gte('tapped_at', startOfMonth)
    tapsThisMonth = count || 0
  } catch {
    // Table might not exist
  }

  // Active leads
  const { count: activeLeads } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .in('status', ['new', 'contacted', 'quoted'])

  return `
CURRENT BUSINESS STATS:
- Jobs this month: ${jobsThisMonth || 0}
- Jobs last month: ${jobsLastMonth || 0}
- Sightings this month: ${sightingsThisMonth || 0}
- NFC taps this month: ${tapsThisMonth || 0}
- Active leads: ${activeLeads || 0}
`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message, conversationHistory = [] } = body

    if (!message) {
      return NextResponse.json({ error: 'Missing message' }, { status: 400 })
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured' },
        { status: 500 },
      )
    }

    const supabase = createAdminClient()

    // Gather context
    const [schema, recentIntel, businessStats] = await Promise.all([
      getSchema(supabase),
      getRecentIntel(supabase),
      getBusinessStats(supabase),
    ])

    const systemPrompt = `You are Harry, the Sasquatch Analyst. You work for Sasquatch Carpet Cleaning in Monument, Colorado. You're named after Harry from Harry and the Hendersons.

You have access to the entire business database and market intelligence. You speak plainly, give hard numbers, and tell Charles what's actually happening - no fluff, no corporate speak.

${businessStats}

DATABASE SCHEMA:
${schema}

RECENT MARKET INTEL:
${recentIntel}

RULES:
- Always use real numbers from the database when available
- Compare to previous periods when relevant
- Flag problems without being asked
- Be direct - Charles is busy
- When you don't have data, say so clearly
- Suggest what data would help if it's missing
- Lead with the number/answer, then explain
- Don't say "Based on my analysis" or "According to the data" - just state facts
- Call out problems: "Your tag at Mario's has 40 taps and zero conversions. Something's wrong there."
- Be encouraging when things are good: "That's your best week since October."

You're not just answering questions - you're watching the business. If you see something concerning in the data, mention it.`

    // Build messages array
    const messages: Anthropic.MessageParam[] = [
      ...conversationHistory.map((msg: { role: string; content: string }) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user', content: message },
    ]

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    })

    const assistantMessage =
      response.content[0].type === 'text'
        ? response.content[0].text
        : 'I had trouble processing that. Try asking again.'

    return NextResponse.json({
      message: assistantMessage,
      usage: response.usage,
    })
  } catch (error) {
    console.error('Chat API error:', error)
    return NextResponse.json(
      { error: 'Failed to get response from Harry' },
      { status: 500 },
    )
  }
}
