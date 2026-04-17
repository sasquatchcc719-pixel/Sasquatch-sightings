import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Get recent conversations from last 24 hours
const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

const { data: conversations, error } = await supabase
  .from('conversations')
  .select('*')
  .gte('created_at', oneDayAgo)
  .order('created_at', { ascending: false })

if (error) {
  console.error('Error:', error)
  process.exit(1)
}

console.log('\n📞 Recent Conversations (last 24 hours):\n')

conversations.forEach(convo => {
  const messageCount = convo.messages?.length || 0
  const lastMessage = convo.messages?.[messageCount - 1]
  const source = convo.source || 'unknown'
  
  console.log(`\n🔹 Phone: ${convo.phone_number}`)
  console.log(`   Source: ${source}${source === 'lsa' ? ' 🚨 GOOGLE LSA' : ''}`)
  console.log(`   Status: ${convo.status}`)
  console.log(`   Created: ${new Date(convo.created_at).toLocaleString()}`)
  console.log(`   Messages: ${messageCount}`)
  
  if (lastMessage) {
    console.log(`   Last message (${lastMessage.role}): ${lastMessage.content.substring(0, 100)}${lastMessage.content.length > 100 ? '...' : ''}`)
  }
  
  // Show all messages for LSA leads
  if (source === 'lsa') {
    console.log('\n   Full conversation:')
    convo.messages?.forEach((msg, idx) => {
      console.log(`   ${idx + 1}. [${msg.role}] ${msg.content}`)
    })
  }
})

console.log(`\n\nTotal conversations: ${conversations.length}`)
const lsaCount = conversations.filter(c => c.source === 'lsa').length
if (lsaCount > 0) {
  console.log(`🚨 Google LSA leads: ${lsaCount}`)
}
