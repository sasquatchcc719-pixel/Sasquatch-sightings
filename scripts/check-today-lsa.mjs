import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Get all conversations from today
const todayStart = new Date()
todayStart.setHours(0, 0, 0, 0)

const { data: conversations } = await supabase
  .from('conversations')
  .select('*')
  .gte('created_at', todayStart.toISOString())
  .order('updated_at', { ascending: false })

console.log('\n📱 ALL CONVERSATIONS TODAY:\n')
console.log('='.repeat(70))

conversations?.forEach(convo => {
  const isLsa = JSON.stringify(convo.messages).toLowerCase().includes('google local services')
  const messageCount = convo.messages?.length || 0
  const lastMsg = convo.messages?.[messageCount - 1]
  
  console.log(`\n${isLsa ? '🚨 GOOGLE LSA' : '📞'} ${convo.phone_number}`)
  console.log(`   Status: ${convo.status} | AI: ${convo.ai_enabled ? 'ON' : 'OFF'}`)
  console.log(`   Created: ${new Date(convo.created_at).toLocaleTimeString()}`)
  console.log(`   Updated: ${new Date(convo.updated_at).toLocaleTimeString()}`)  
  console.log(`   Messages: ${messageCount}`)
  
  if (isLsa) {
    console.log('\n   📋 LSA CONVERSATION DETAILS:')
    convo.messages?.forEach((msg, idx) => {
      console.log(`\n   ${idx + 1}. [${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.role.toUpperCase()}`)
      console.log(`   ${msg.content}`)
    })
    console.log('\n   ' + '-'.repeat(60))
  }
})

// Check for any appointments booked today
const { data: appointments } = await supabase
  .from('ops_appointments')
  .select('*, customer:ops_customers!customer_id(*)')
  .eq('appointment_date', '2026-04-16')
  .gte('created_at', todayStart.toISOString())

console.log('\n\n📅 APPOINTMENTS BOOKED TODAY:')
console.log('='.repeat(70))
if (appointments?.length === 0) {
  console.log('None')
} else {
  appointments?.forEach(appt => {
    console.log(`\n- ${appt.customer.full_name}`)
    console.log(`  Time: ${appt.start_time}`)
    console.log(`  Cost: $${appt.quoted_total}`)
    console.log(`  Source: ${appt.source} / ${appt.lead_source}`)
  })
}
