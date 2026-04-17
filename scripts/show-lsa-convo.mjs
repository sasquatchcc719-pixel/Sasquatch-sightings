import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const { data: convo, error } = await supabase
  .from('conversations')
  .select('*')
  .eq('phone_number', '+19497710382')
  .single()

if (error) {
  console.error('Error:', error)
  process.exit(1)
}

console.log('\n🚨 GOOGLE LSA CONVERSATION')
console.log('=' .repeat(60))
console.log(`Phone: ${convo.phone_number}`)
console.log(`Source: ${convo.source}`)
console.log(`Status: ${convo.status}`)
console.log(`AI Enabled: ${convo.ai_enabled}`)
console.log(`Created: ${new Date(convo.created_at).toLocaleString()}`)
console.log(`Messages: ${convo.messages.length}`)
console.log('=' .repeat(60))

convo.messages.forEach((msg, idx) => {
  const time = new Date(msg.timestamp).toLocaleTimeString()
  const role = msg.role.toUpperCase().padEnd(10)
  console.log(`\n[${idx + 1}] ${time} - ${role}`)
  console.log(`${msg.content}`)
  console.log('-'.repeat(60))
})
