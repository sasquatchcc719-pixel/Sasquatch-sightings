import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function checkRadarStatus() {
  console.log('\n🎯 RADAR STATUS CHECK\n')

  // Check keywords
  const { data: keywords } = await supabase
    .from('radar_keywords')
    .select('id, keyword, location, active')
    .eq('active', true)

  console.log(`📊 Active Keywords: ${keywords?.length || 0}`)
  keywords?.forEach((k, i) => {
    console.log(`   ${i + 1}. "${k.keyword}" (${k.location})`)
  })

  // Check domains
  const { data: domains } = await supabase
    .from('radar_domains')
    .select('id, domain, display_name, is_my_domain')

  console.log(`\n🏢 Tracked Domains: ${domains?.length || 0}`)
  domains?.forEach((d, i) => {
    const label = d.display_name || d.domain
    const you = d.is_my_domain ? ' (YOU)' : ''
    console.log(`   ${i + 1}. ${label}${you}`)
  })

  // Check recent rankings
  const { data: rankings } = await supabase
    .from('radar_rankings')
    .select('created_at, rank_position, keyword_id, domain_id')
    .order('created_at', { ascending: false })
    .limit(10)

  console.log(`\n📈 Recent Rankings: ${rankings?.length || 0} found`)
  if (rankings && rankings.length > 0) {
    console.log(
      `   Most recent: ${new Date(rankings[0].created_at).toLocaleString()}`,
    )
    console.log(
      `   Oldest shown: ${new Date(rankings[rankings.length - 1].created_at).toLocaleString()}`,
    )
  } else {
    console.log('   ⚠️  No rankings found - need to run refresh!')
  }

  // Check if any rankings for "your" domain
  const myDomain = domains?.find((d) => d.is_my_domain)
  if (myDomain) {
    const { data: myRankings } = await supabase
      .from('radar_rankings')
      .select('rank_position, created_at, keyword_id')
      .eq('domain_id', myDomain.id)
      .order('created_at', { ascending: false })
      .limit(5)

    console.log(
      `\n🎯 Your Domain (${myDomain.display_name || myDomain.domain}):`,
    )
    if (myRankings && myRankings.length > 0) {
      console.log(`   Recent rankings:`)
      myRankings.forEach((r) => {
        const kw = keywords?.find((k) => k.id === r.keyword_id)
        console.log(
          `     #${r.rank_position} for "${kw?.keyword || 'unknown'}" (${new Date(r.created_at).toLocaleDateString()})`,
        )
      })
    } else {
      console.log(`   ⚠️  No rankings found for your domain!`)
    }
  }

  console.log('\n')
}

checkRadarStatus()
