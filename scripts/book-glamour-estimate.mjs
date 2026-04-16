import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Find recent conversations
const { data: convos, error: convoError } = await supabase
  .from('conversations')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(30)

if (convoError) {
  console.error('Convo search error:', convoError)
} else {
  // Filter for tile mentions
  const tileConvos = convos?.filter(c => 
    JSON.stringify(c).toLowerCase().includes('tile') ||
    JSON.stringify(c).toLowerCase().includes('glamour')
  ) || []
  
  console.log('Conversations about tile/glamour:', JSON.stringify(tileConvos, null, 2))
}

// Search leads
const { data: leads, error: leadError } = await supabase
  .from('leads')
  .select('*')
  .or('name.ilike.%glamour%,business_name.ilike.%glamour%')

if (leadError) {
  console.error('Lead search error:', leadError)
} else {
  console.log('\nLeads matching glamour:', JSON.stringify(leads, null, 2))
}
