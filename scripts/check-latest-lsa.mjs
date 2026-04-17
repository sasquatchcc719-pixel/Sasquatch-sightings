import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Get conversations from last 2 hours
const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

const { data: conversations, error } = await supabase
  .from('conversations')
  .select('*')
  .gte('created_at', twoHoursAgo)
  .order('created_at', { ascending: false })

if (error) {
  console.error('Error:', error)
  process.exit(1)
}

console.log('\n📱 RECENT CONVERSATIONS (last 2 hours):\n')
console.log('='.repeat(70))

conversations.forEach(convo => {
  const isLsa = convo.messages?.some(m => 
    m.content?.toLowerCase().includes('google local services') ||
    m.content?.toLowerCase().includes('lsa')
  )
  
  const messageCount = convo.messages?.length || 0
  const lastMessage = convo.messages?.[messageCount - 1]
  
  console.log(`\n${isLsa ? '🚨 LSA' : '📞'} ${convo.phone_number}`)
  console.log(`   Status: ${convo.status}`)
  console.log(`   Created: ${new Date(convo.created_at).toLocaleString()}`)
  console.log(`   Messages: ${messageCount}`)
  
  if (lastMessage) {
    console.log(`   Last (${lastMessage.role}): ${lastMessage.content.substring(0, 80)}...`)
  }
  
  // Show full conversation for LSA
  if (isLsa) {
    console.log('\n   FULL CONVERSATION:')
    convo.messages?.forEach((msg, idx) => {
      const time = new Date(msg.timestamp).toLocaleTimeString()
      console.log(`   ${idx + 1}. [${time}] ${msg.role.toUpperCase()}:`)
      console.log(`      ${msg.content}`)
    })
  }
})

console.log('\n' + '='.repeat(70))
console.log(`Total: ${conversations.length} conversations`)
