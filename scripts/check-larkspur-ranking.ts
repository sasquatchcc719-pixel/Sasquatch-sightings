import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkLarkspurRanking() {
  console.log('🔍 Checking Larkspur ranking data...\n')

  // Get all keywords to find Larkspur
  const { data: allKeywords } = await supabase
    .from('radar_keywords')
    .select('id, keyword, location')
    .eq('active', true)

  console.log('All keywords:', allKeywords)

  // Get keywords with "larkspur" in them
  const { data: keywords } = await supabase
    .from('radar_keywords')
    .select('id, keyword, location')
    .ilike('keyword', '%larkspur%')

  if (!keywords || keywords.length === 0) {
    console.log('\n❌ No keywords found with "larkspur" in them')
    return
  }

  console.log('\n📍 Larkspur keywords found:', keywords)

  // Get Charles's domain
  const { data: myDomain } = await supabase
    .from('radar_domains')
    .select('id, domain, display_name, is_my_domain')
    .eq('is_my_domain', true)
    .maybeSingle()

  if (!myDomain) {
    console.log('\n❌ No primary domain found')
    return
  }

  console.log('\n🏢 Your domain:', myDomain)

  // Get latest rankings for each Larkspur keyword
  for (const kw of keywords) {
    console.log(`\n📊 Rankings for "${kw.keyword}" (${kw.location}):`)

    const { data: ranking } = await supabase
      .from('radar_rankings')
      .select('rank_position, map_rank, created_at')
      .eq('keyword_id', kw.id)
      .eq('domain_id', myDomain.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (ranking) {
      console.log('   Latest ranking:', {
        organic_position: ranking.rank_position,
        map_position: ranking.map_rank,
        date: new Date(ranking.created_at).toLocaleString(),
      })
    } else {
      console.log('   ❌ No ranking data found')
    }
  }
}

checkLarkspurRanking()
