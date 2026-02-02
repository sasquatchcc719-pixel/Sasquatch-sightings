import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { searchGoogle } from '@/lib/web-search'
import { getPriceBookSummary } from '@/lib/price-book'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Get recent conversation history from database
async function getConversationHistory(
  supabase: ReturnType<typeof createAdminClient>,
  limit = 20,
) {
  const { data, error } = await supabase
    .from('harry_conversations')
    .select('role, content, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data) {
    return []
  }

  // Reverse to get chronological order
  return data.reverse()
}

// Save a message to conversation history
async function saveMessage(
  supabase: ReturnType<typeof createAdminClient>,
  role: 'user' | 'assistant',
  content: string,
) {
  await supabase.from('harry_conversations').insert({ role, content })
}

// Get important memories
async function getMemories(supabase: ReturnType<typeof createAdminClient>) {
  const { data, error } = await supabase
    .from('harry_memory')
    .select('memory_type, content, created_at')
    .order('importance', { ascending: false })
    .limit(10)

  if (error || !data || data.length === 0) {
    return ''
  }

  return `
IMPORTANT THINGS TO REMEMBER:
${data.map((m) => `- [${m.memory_type}] ${m.content}`).join('\n')}
`
}

// Extract and save important memories from conversation
async function extractMemories(
  supabase: ReturnType<typeof createAdminClient>,
  userMessage: string,
  assistantResponse: string,
) {
  // Look for decision patterns
  const decisionPatterns = [
    /(?:i(?:'ve)? decided|we(?:'re)? going to|let(?:'s)?|i(?:'m)? going to) (.+)/i,
    /(?:the plan is|our goal is|we need to) (.+)/i,
  ]

  for (const pattern of decisionPatterns) {
    const match = userMessage.match(pattern)
    if (match) {
      await supabase.from('harry_memory').insert({
        memory_type: 'decision',
        content: match[1].substring(0, 500),
        importance: 7,
      })
    }
  }
}

// Get competitor profiles
async function getCompetitorProfiles(
  supabase: ReturnType<typeof createAdminClient>,
) {
  const { data, error } = await supabase
    .from('competitors')
    .select('*')
    .order('name')

  if (error || !data || data.length === 0) {
    return 'No competitor profiles yet. Run a scan to gather intel.'
  }

  return data
    .map(
      (c) => `
**${c.name}**
- Website: ${c.website || 'Unknown'}
- Google: ${c.google_rating || '?'}/5 (${c.google_review_count || '?'} reviews)
- Pricing: ${c.pricing_notes || 'Unknown'}
- Strengths: ${c.strengths || 'Unknown'}
- Weaknesses: ${c.weaknesses || 'Unknown'}
- Recent Promos: ${c.recent_promos || 'None known'}
- Last Researched: ${c.last_researched ? new Date(c.last_researched).toLocaleDateString() : 'Never'}
`,
    )
    .join('\n')
}

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
  const dayOfMonth = now.getDate()
  const currentMonthName = now.toLocaleString('en-US', { month: 'long' })

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

  // Last 7 days and last 30 days for fairer comparisons
  const last7Days = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString()
  const last30Days = new Date(
    now.getTime() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString()
  const prev30Days = new Date(
    now.getTime() - 60 * 24 * 60 * 60 * 1000,
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

  // Jobs last 7 days
  const { count: jobsLast7Days } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .gte('published_at', last7Days)

  // Jobs last 30 days
  const { count: jobsLast30Days } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .gte('published_at', last30Days)

  // Jobs previous 30 days (30-60 days ago)
  const { count: jobsPrev30Days } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .gte('published_at', prev30Days)
    .lt('published_at', last30Days)

  // Sightings this month
  const { count: sightingsThisMonth } = await supabase
    .from('sightings')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfMonth)

  // NFC taps this month (if table exists)
  let tapsThisMonth = 0
  let tapsLast30Days = 0
  try {
    const { count } = await supabase
      .from('nfc_taps')
      .select('*', { count: 'exact', head: true })
      .gte('tapped_at', startOfMonth)
    tapsThisMonth = count || 0

    const { count: count30 } = await supabase
      .from('nfc_taps')
      .select('*', { count: 'exact', head: true })
      .gte('tapped_at', last30Days)
    tapsLast30Days = count30 || 0
  } catch {
    // Table might not exist
  }

  // Active leads
  const { count: activeLeads } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .in('status', ['new', 'contacted', 'quoted'])

  // Context about where we are in the month
  const monthContext =
    dayOfMonth <= 5
      ? `NOTE: Today is ${currentMonthName} ${dayOfMonth}. We're only ${dayOfMonth} day(s) into the month, so "this month" stats are incomplete. Use last 7 days or last 30 days for fairer comparisons.`
      : `Today is ${currentMonthName} ${dayOfMonth}.`

  return `
${monthContext}

CURRENT BUSINESS STATS:
- Jobs this month (${currentMonthName}, ${dayOfMonth} days in): ${jobsThisMonth || 0}
- Jobs last 7 days: ${jobsLast7Days || 0}
- Jobs last 30 days: ${jobsLast30Days || 0}
- Jobs previous 30 days (for comparison): ${jobsPrev30Days || 0}
- Jobs last full month: ${jobsLastMonth || 0}
- Sightings this month: ${sightingsThisMonth || 0}
- NFC taps this month: ${tapsThisMonth || 0}
- NFC taps last 30 days: ${tapsLast30Days || 0}
- Active leads: ${activeLeads || 0}
`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message } = body

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

    // Save user message to conversation history
    await saveMessage(supabase, 'user', message)

    // Gather context including conversation history and memories
    const [
      schema,
      recentIntel,
      businessStats,
      competitorProfiles,
      conversationHistory,
      memories,
    ] = await Promise.all([
      getSchema(supabase),
      getRecentIntel(supabase),
      getBusinessStats(supabase),
      getCompetitorProfiles(supabase),
      getConversationHistory(supabase, 30), // Last 30 messages
      getMemories(supabase),
    ])

    // Check if user is asking about something that needs a web search
    const needsSearch =
      /search|look up|find out|check|what('s| is).*charging|current|right now|latest/i.test(
        message,
      )

    let searchResults = ''
    if (needsSearch) {
      try {
        // Extract what to search for
        const searchQuery = message.replace(/^(can you |please |harry,? )/i, '')
        const results = await searchGoogle(
          searchQuery + ' Colorado carpet cleaning',
          5,
        )
        searchResults = `
LIVE SEARCH RESULTS (just searched):
${results.map((r) => `- ${r.title}: ${r.snippet} (${r.url})`).join('\n')}
`
      } catch (err) {
        console.error('Search failed:', err)
        searchResults =
          '\n[Web search attempted but failed - using cached data only]\n'
      }
    }

    // Get price book
    const priceBook = getPriceBookSummary()

    const systemPrompt = `You are Harry, the Sasquatch Analyst. You work for Sasquatch Carpet Cleaning in Monument, Colorado. You're named after Harry from Harry and the Hendersons.

You have access to the entire business database, market intelligence, AND you can search the internet. You speak plainly, give hard numbers, and tell Charles what's actually happening - no fluff, no corporate speak.

You have MEMORY of past conversations with Charles. You remember what you've discussed before and can reference previous conversations.

${memories}

${businessStats}

YOUR PRICE BOOK (ballpark prices - actual quotes may vary):
${priceBook}

COMPETITOR INTELLIGENCE:
${competitorProfiles}

RECENT MARKET INTEL:
${recentIntel}
${searchResults}

DATABASE SCHEMA:
${schema}

CAPABILITIES:
- You have access to business data (jobs, leads, taps, partners)
- You KNOW your prices - use the price book above to answer pricing questions
- You know competitor profiles (pricing, ratings, strengths, weaknesses)
- You can see recent market intel gathered by scans
- When Charles asks about something current, you can search the web
- You remember past conversations and can reference them

RULES:
- Always use real numbers from the database when available
- When asked about pricing, use YOUR price book - you know what things cost
- Compare to previous periods when relevant
- Flag problems without being asked
- Be direct - Charles is busy
- When you don't have data, say so clearly
- If you have competitor intel, USE IT - tell Charles what his competitors are doing
- Lead with the number/answer, then explain
- Don't say "Based on my analysis" or "According to the data" - just state facts
- Call out problems: "Your tag at Mario's has 40 taps and zero conversions. Something's wrong there."
- Be encouraging when things are good: "That's your best week since October."
- If competitor data is stale (last researched > 7 days ago), mention it and suggest running a scan
- Reference past conversations when relevant: "Last time we talked about X..." or "You mentioned before that..."

You're not just answering questions - you're watching the business AND the competition. If you see an opportunity or threat, say it.`

    // Build messages array from database history (excludes current message which was just saved)
    // Filter out the message we just saved to avoid duplication
    const historyWithoutCurrent = conversationHistory.slice(0, -1)
    const messages: Anthropic.MessageParam[] = [
      ...historyWithoutCurrent.map(
        (msg: { role: string; content: string }) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }),
      ),
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

    // Save assistant response to conversation history
    await saveMessage(supabase, 'assistant', assistantMessage)

    // Extract and save any important memories from this exchange
    await extractMemories(supabase, message, assistantMessage)

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
